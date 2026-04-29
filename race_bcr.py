#!/usr/bin/env python3
"""
Bar Chart Race — v1 : bar_chart_race library
Génère data/race_bcr.mp4

pip install bar_chart_race pandas matplotlib
"""

import json
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).parent
STATS_FILE = ROOT / "data" / "stats.json"
OUTPUT = ROOT / "data" / "race_bcr.mp4"

COLORS = {
    "TG": "#ef4444", "GB": "#10b981", "ZA": "#3b82f6",
    "RG": "#f97316", "JD": "#8b5cf6", "RZ": "#ec4899", "EJ": "#eab308",
}
FULL_NAMES = {
    "TG": "TG", "GB": "GB", "ZA": "ZA",
    "RG": "RG", "JD": "JD", "RZ": "RZ", "EJ": "EJ",
}


def main():
    try:
        import bar_chart_race as bcr
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as e:
        print(f"❌ Dépendance manquante : {e}")
        print("   pip install bar_chart_race pandas matplotlib")
        return

    with open(STATS_FILE, encoding="utf-8") as fh:
        stats = json.load(fh)

    cum = stats["cumulative_by_month"]
    months = sorted(cum.keys())
    people = stats["meta"]["people"]

    # DataFrame : lignes = mois, colonnes = personnes (noms complets)
    df = pd.DataFrame(
        {FULL_NAMES[p]: [cum[m].get(p, 0) for m in months] for p in people},
        index=months,
    )
    df.index.name = "Mois"

    bar_colors = [COLORS[p] for p in people]
    cmap_colors = [COLORS[p] for p in people]  # bar_chart_race uses 'cmap'

    OUTPUT.parent.mkdir(exist_ok=True)

    print(f"⬡ Génération race_bcr ({len(months)} frames) ...")

    bcr.bar_chart_race(
        df=df,
        filename=str(OUTPUT),
        orientation="h",
        sort="desc",
        n_bars=len(people),
        fixed_order=False,
        fixed_max=False,
        steps_per_period=30,
        period_length=700,
        interpolate_period=False,
        label_bars=True,
        bar_size=0.82,
        period_label={
            "x": 0.97, "y": 0.05,
            "ha": "right", "va": "bottom",
            "size": 22, "color": "black", "fontweight": "bold",
        },
        period_summary_func=lambda v, r: {
            "x": 0.97, "y": 0.16,
            "ha": "right", "va": "bottom",
            "s": f"Total  {v.sum():,.0f} msgs",
            "size": 11, "color": "#444",
        },
        cmap=cmap_colors,
        title="ECL Data Club — Messages cumulés par membre",
        title_size=14,
        bar_label_size=9,
        tick_label_size=11,
        scale="linear",
        fig=None,
        writer=None,
        bar_kwargs={"alpha": 0.88, "ec": "none"},
        filter_column_colors=False,
    )

    print(f"  ✓ Sauvegardé → {OUTPUT}")


if __name__ == "__main__":
    main()
