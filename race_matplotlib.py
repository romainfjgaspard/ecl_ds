#!/usr/bin/env python3
"""
Bar Chart Race — v2 : custom Matplotlib FuncAnimation (fond sombre, interpolation fluide)
Génère data/race_matplotlib.mp4

pip install matplotlib pandas numpy
ffmpeg doit être installé (conda install ffmpeg ou winget install ffmpeg)
"""

import json
import math
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import matplotlib.patheffects as pe
from matplotlib.animation import FuncAnimation, FFMpegWriter
from pathlib import Path

ROOT = Path(__file__).parent
STATS_FILE = ROOT / "data" / "stats.json"
OUTPUT = ROOT / "data" / "race_matplotlib.mp4"

# ── Palette & style ───────────────────────────────────────
BG        = "#0f172a"
CARD_BG   = "#1e293b"
GRID_COL  = "#334155"
TEXT_COL  = "#e2e8f0"
MUTED     = "#64748b"
ACCENT    = "#38bdf8"

COLORS = {
    "TG": "#ef4444", "GB": "#10b981", "ZA": "#3b82f6",
    "RG": "#f97316", "JD": "#8b5cf6", "RZ": "#ec4899", "EJ": "#eab308",
}
FULL_NAMES = {
    "TG": "TG", "GB": "GB", "ZA": "ZA",
    "RG": "RG", "JD": "JD", "RZ": "RZ", "EJ": "EJ",
}

FPS       = 30
HOLD_FRAMES = 45   # frames to hold on each keyframe
INTERP_N   = 30   # interpolation frames between keyframes
FINAL_HOLD = 90   # extra frames at the end


# ── Interpolation ─────────────────────────────────────────
def build_frames(df: pd.DataFrame):
    """Build list of (label_str, {person: value}) interpolated frames."""
    months = list(df.index)
    frames = []

    for i, month in enumerate(months):
        cur_vals = df.iloc[i].to_dict()

        if i == 0:
            # Hold on first month
            for _ in range(HOLD_FRAMES):
                frames.append((month, dict(cur_vals)))
        else:
            prev_vals = df.iloc[i - 1].to_dict()
            # Ease-in-out interpolation
            for step in range(INTERP_N):
                t = step / INTERP_N
                # Cubic ease-in-out
                t_ease = t * t * (3 - 2 * t)
                interp = {
                    p: prev_vals[p] + t_ease * (cur_vals[p] - prev_vals[p])
                    for p in cur_vals
                }
                frames.append((month, interp))
            # Hold on keyframe
            for _ in range(HOLD_FRAMES):
                frames.append((month, dict(cur_vals)))

    # Final hold
    last_month = months[-1]
    last_vals = df.iloc[-1].to_dict()
    for _ in range(FINAL_HOLD):
        frames.append((last_month, dict(last_vals)))

    return frames


# ── Draw one frame ────────────────────────────────────────
def draw(ax, title_ax, vals: dict, month_label: str, max_val: float):
    ax.clear()
    ax.set_facecolor(BG)

    # Sort ascending (top bar = highest)
    sorted_items = sorted(vals.items(), key=lambda x: x[1])
    people = [x[0] for x in sorted_items]
    values = [x[1] for x in sorted_items]
    n = len(people)
    y_pos = np.arange(n)

    # Draw bars
    for i, (p, v) in enumerate(zip(people, values)):
        color = COLORS.get(p, "#888")
        pct_width = v / max_val if max_val > 0 else 0

        # Shadow / glow effect
        ax.barh(i, v * 1.0, height=0.62, color=color, alpha=0.15, linewidth=0)
        ax.barh(i, v,        height=0.62, color=color, alpha=0.92, linewidth=0)

        # Rank badge
        rank = n - i  # 1 = highest
        ax.text(
            max_val * 0.006, i,
            f"#{rank}",
            va="center", ha="left",
            fontsize=8, color=color,
            fontfamily="monospace", alpha=0.7,
        )

        # Value label
        if v > max_val * 0.03:
            ax.text(
                v - max_val * 0.015, i,
                f"{v:,.0f}",
                va="center", ha="right",
                fontsize=10, fontweight="bold",
                color=BG, fontfamily="monospace",
                path_effects=[pe.withStroke(linewidth=1, foreground=BG)],
            )

        # Name label (left)
        ax.text(
            -max_val * 0.012, i,
            FULL_NAMES.get(p, p),
            va="center", ha="right",
            fontsize=10, color=color,
            fontfamily="monospace", fontweight="bold",
        )

    # Month label (watermark style)
    ax.text(
        0.98, 0.06, month_label,
        transform=ax.transAxes,
        ha="right", va="bottom",
        fontsize=34, fontweight="bold",
        color="white", alpha=0.18,
        fontfamily="monospace",
    )

    # Subtitle (total)
    total = sum(values)
    ax.text(
        0.98, 0.02, f"{total:,} messages",
        transform=ax.transAxes,
        ha="right", va="bottom",
        fontsize=9, color=MUTED,
        fontfamily="monospace",
    )

    # Light grid lines at round numbers
    step = max(100, round(max_val / 8 / 100) * 100)
    xticks = np.arange(0, max_val * 1.05, step)
    for x in xticks:
        ax.axvline(x, color=GRID_COL, linewidth=0.4, zorder=0)

    ax.set_xlim(-max_val * 0.22, max_val * 1.08)
    ax.set_ylim(-0.55, n - 0.45)
    ax.set_yticks([])
    ax.set_xticks([])
    ax.spines[:].set_visible(False)


# ── Main ──────────────────────────────────────────────────
def main():
    with open(STATS_FILE, encoding="utf-8") as fh:
        stats = json.load(fh)

    cum     = stats["cumulative_by_month"]
    months  = sorted(cum.keys())
    people  = stats["meta"]["people"]

    df = pd.DataFrame(
        {p: [cum[m].get(p, 0) for m in months] for p in people},
        index=months,
    )

    frames    = build_frames(df)
    total_f   = len(frames)
    max_val   = df.values.max() * 1.05
    n_people  = len(people)

    # Figure layout
    fig = plt.figure(figsize=(14, 7), facecolor=BG)
    ax_title = fig.add_axes([0.0, 0.88, 1.0, 0.12], facecolor=BG)
    ax_title.axis("off")
    ax_title.text(
        0.02, 0.65,
        "💾  ECL DATA CLUB",
        ha="left", va="center",
        fontsize=18, fontweight="bold", color=TEXT_COL,
        fontfamily="monospace",
    )
    ax_title.text(
        0.02, 0.2,
        "Messages cumulés par membre · Évolution mensuelle",
        ha="left", va="center",
        fontsize=10, color=MUTED,
        fontfamily="monospace",
    )

    ax = fig.add_axes([0.16, 0.04, 0.82, 0.82], facecolor=BG)

    # Progress bar axis
    ax_prog = fig.add_axes([0.0, 0.0, 1.0, 0.018], facecolor=BG)
    ax_prog.set_xlim(0, total_f)
    ax_prog.set_ylim(0, 1)
    ax_prog.axis("off")
    prog_bar = ax_prog.barh(0.5, 0, height=1, color=ACCENT, alpha=0.6)[0]

    def animate(fi):
        month_label, vals = frames[fi]
        draw(ax, ax_title, vals, month_label, max_val)
        # Update progress bar
        prog_bar.set_width(fi + 1)
        return []

    print(f"⬡ Génération race_matplotlib ({total_f} frames @ {FPS} fps) ...")
    duration_s = total_f / FPS
    print(f"  Durée estimée : {duration_s:.1f}s")

    anim = FuncAnimation(fig, animate, frames=total_f, interval=1000 // FPS, blit=False)

    OUTPUT.parent.mkdir(exist_ok=True)

    try:
        writer = FFMpegWriter(fps=FPS, metadata={"title": "ECL Data Club Race"}, bitrate=3000)
        anim.save(str(OUTPUT), writer=writer, dpi=150)
        print(f"  ✓ Sauvegardé → {OUTPUT}")
    except Exception as e:
        print(f"  ⚠ FFMpeg non disponible ({e})")
        # Fallback : save as GIF
        gif_out = OUTPUT.with_suffix(".gif")
        print(f"  → Tentative GIF : {gif_out}")
        anim.save(str(gif_out), writer="pillow", fps=FPS // 2)
        print(f"  ✓ GIF sauvegardé → {gif_out}")

    plt.close()


if __name__ == "__main__":
    main()
