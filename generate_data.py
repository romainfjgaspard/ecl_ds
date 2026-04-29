#!/usr/bin/env python3
"""
Parse WhatsApp group export → generate data/stats.json
ECL Data Club – WhatsApp Dashboard
"""

import re
import json
import unicodedata
from datetime import datetime
from collections import Counter, defaultdict
from pathlib import Path

# ── Config ───────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent
INPUT = ROOT / "groupe.txt"
OUTPUT = ROOT / "data" / "stats.json"

KNOWN_SENDERS = {"TG", "GB", "ZA", "RG", "JD", "RZ", "EJ"}

COLORS = {
    "TG": "#ef4444",
    "GB": "#10b981",
    "ZA": "#3b82f6",
    "RG": "#f97316",
    "JD": "#8b5cf6",
    "RZ": "#ec4899",
    "EJ": "#eab308",
}

FULL_NAMES = {
    "TG": "TG",
    "GB": "GB",
    "ZA": "ZA",
    "RG": "RG",
    "JD": "JD",
    "RZ": "RZ",
    "EJ": "EJ",
}

# ── Stop words (FR + EN + chat) ───────────────────────────────────────────────
STOP_WORDS = {
    # Articles / déterminants
    "le","la","les","un","une","des","du","de","d","ce","cet","cette","ces",
    "mon","ton","son","ma","ta","sa","mes","tes","ses","notre","votre","leur",
    "nos","vos","leurs",
    # Prépositions
    "au","aux","en","dans","sur","sous","par","pour","sans","avec","chez",
    "vers","entre","contre","depuis","pendant","avant","après","devant",
    "derrière","lors",
    # Pronoms
    "je","tu","il","elle","nous","vous","ils","elles","me","te","se","lui",
    "moi","toi","soi","eux","qui","que","quoi","dont","où","lequel",
    "laquelle","lesquels","lesquelles","auquel","duquel",
    # Conjonctions / adverbes conj.
    "et","ou","mais","donc","or","ni","car","si","quand","lorsque","puisque",
    "parce","comme","bien","alors","tandis","sinon","ainsi","pourtant",
    # Auxiliaires / verbes courants
    "est","sont","était","étaient","sera","seront","serait","seraient",
    "a","ai","as","ont","avoir","être","avait","avaient","avons","avez",
    "fait","faire","va","vais","allais","peut","peuvent","pouvait","pouvaient",
    "doit","doivent","faut","fallait","veux","veut","vouloir","suis","sommes",
    # Adverbes courants
    "très","plus","moins","aussi","encore","déjà","toujours","jamais","souvent",
    "parfois","bien","mal","beaucoup","peu","assez","trop","tout","tous",
    "toute","toutes","rien","ne","pas","non","oui","là","ici","voilà","même",
    "autre","autres","alors","après","avant","maintenant","jamais","rien",
    "quelque","quelques","chaque","plusieurs","certain","certains","certaine",
    # Pronoms abrégés (chat)
    "c","j","d","n","l","qu","m","t","s","y",
    # Expressions chat FR
    "ça","ca","bon","bah","ben","hein","enfin","bref","ouais","ouai","voilà",
    "ah","oh","ha","haha","ahah","lol","ok","okay","nan","nan","bref",
    "genre","truc","chose","gens","mec","gars","type","coup","fois",
    "merci","bonjour","bonsoir","salut","coucou","yes","non","oui",
    "ptit","petit","petite","grand","grande","vrai","vraie","vrai",
    # English
    "the","a","an","is","are","was","were","be","been","being","have","has",
    "had","do","does","did","will","would","could","should","may","might",
    "must","can","to","of","in","on","at","by","for","with","about","as",
    "from","into","that","this","it","i","you","he","she","we","they","my",
    "your","his","her","our","their","not","no","and","or","but","if","so",
    "all","just","get","got","go","what","which","who","when","where","how",
    "why","there","here","more","very","too","than","then","now","any","some",
    "its","like","know","think","also","only","because","can","would","could",
    "here","other","than","its","them","these","those","yes","hey","hi","lol",
}

URL_RE = re.compile(r"https?://\S+|www\.\S+")
EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002300-\U000027FF\U0000FE00-\U0000FEFF"
    "\U00002702-\U000027B0\U00010000-\U0010FFFF]+",
    flags=re.UNICODE,
)
WORD_RE = re.compile(r"[a-zA-ZÀ-ÿ]{3,}", re.UNICODE)


# ── Parser ────────────────────────────────────────────────────────────────────
def parse_whatsapp(filepath: Path) -> list[dict]:
    """Return list of {dt, sender, content} dicts for known senders."""
    TS_RE = re.compile(r"^(\d{1,2}/\d{1,2}/\d{2}), (\d{1,2}:\d{2}) - (.+)$")
    SND_RE = re.compile(r"^([A-Z]{2,3}): (.*)")

    messages: list[dict] = []
    cur: dict | None = None

    with open(filepath, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            ts_m = TS_RE.match(line)
            if ts_m:
                # Flush previous message
                if cur and cur["sender"] in KNOWN_SENDERS:
                    messages.append(cur)
                date_str, time_str, rest = ts_m.groups()
                try:
                    dt = datetime.strptime(f"{date_str} {time_str}", "%m/%d/%y %H:%M")
                except ValueError:
                    cur = None
                    continue
                snd_m = SND_RE.match(rest)
                if snd_m and snd_m.group(1) in KNOWN_SENDERS:
                    cur = {"dt": dt, "sender": snd_m.group(1), "content": snd_m.group(2)}
                else:
                    cur = None
            elif cur:
                cur["content"] += "\n" + line

    if cur and cur["sender"] in KNOWN_SENDERS:
        messages.append(cur)

    messages.sort(key=lambda m: m["dt"])
    return messages


# ── Text helpers ──────────────────────────────────────────────────────────────
def normalize(w: str) -> str:
    """Lowercase + strip accents for stop-word comparison (keep original for output)."""
    return unicodedata.normalize("NFD", w.lower()).encode("ascii", "ignore").decode()


def tokenize(text: str) -> list[str]:
    text = URL_RE.sub(" ", text)
    text = text.replace("<Media omitted>", " ")
    raw_words = WORD_RE.findall(text.lower())
    result = []
    for w in raw_words:
        normed = normalize(w)
        if normed not in STOP_WORDS and w not in STOP_WORDS and len(w) >= 3:
            result.append(w)
    return result


def extract_emojis(text: str) -> list[str]:
    return EMOJI_RE.findall(text)


def count_links(text: str) -> int:
    return len(URL_RE.findall(text))


# ── Stats builder ─────────────────────────────────────────────────────────────
def build_stats(messages: list[dict]) -> dict:
    # Per-person counters
    p_msgs: Counter = Counter()
    p_words: Counter = Counter()
    p_chars: Counter = Counter()
    p_media: Counter = Counter()
    p_links: Counter = Counter()
    word_freq: dict[str, Counter] = defaultdict(Counter)
    emoji_freq: dict[str, Counter] = defaultdict(Counter)

    # Time-based
    by_hour: Counter = Counter()
    by_hour_person: dict[str, Counter] = defaultdict(Counter)
    by_weekday: Counter = Counter()
    by_weekday_person: dict[str, Counter] = defaultdict(Counter)
    by_month: dict[str, Counter] = defaultdict(Counter)
    daily: dict[str, Counter] = defaultdict(Counter)

    # For response times: time between messages from different senders
    last_sender: str | None = None
    last_dt: datetime | None = None
    response_times: dict[str, list[float]] = defaultdict(list)

    for msg in messages:
        s = msg["sender"]
        dt = msg["dt"]
        content = msg["content"]

        is_media = "<Media omitted>" in content
        words = tokenize(content)
        emojis = extract_emojis(content)
        links = count_links(content)

        p_msgs[s] += 1
        p_words[s] += len(words)
        p_chars[s] += len(content)
        if is_media:
            p_media[s] += 1
        p_links[s] += links

        word_freq[s].update(words)
        emoji_freq[s].update(e for e in emojis)

        h = dt.hour
        wd = dt.weekday()  # 0 = Monday
        month = dt.strftime("%Y-%m")
        day = dt.strftime("%Y-%m-%d")

        by_hour[h] += 1
        by_hour_person[s][h] += 1
        by_weekday[wd] += 1
        by_weekday_person[s][wd] += 1
        by_month[month][s] += 1
        daily[day][s] += 1

        # Response times
        if last_sender and last_sender != s and last_dt:
            delta = (dt - last_dt).total_seconds()
            if 0 < delta < 86400:
                response_times[s].append(delta)
        last_sender = s
        last_dt = dt

    # Cumulative messages by month per person
    all_months = sorted(by_month.keys())
    cum: dict[str, int] = {s: 0 for s in KNOWN_SENDERS}
    cumulative_by_month: dict[str, dict] = {}
    for month in all_months:
        for s in KNOWN_SENDERS:
            cum[s] += by_month[month].get(s, 0)
        cumulative_by_month[month] = dict(cum)

    # Response time stats
    def rt_stats(times: list[float]) -> dict:
        if not times:
            return {}
        ts = sorted(times)
        n = len(ts)
        return {
            "n": n,
            "mean": round(sum(ts) / n, 1),
            "median": round(ts[n // 2], 1),
            "p25": round(ts[max(0, int(n * 0.25))], 1),
            "p75": round(ts[min(n - 1, int(n * 0.75))], 1),
            "p95": round(ts[min(n - 1, int(n * 0.95))], 1),
        }

    def top_words(counter: Counter, n: int = 200) -> list[dict]:
        return [{"word": w, "count": c} for w, c in counter.most_common(n)]

    word_freq_all: Counter = Counter()
    for c in word_freq.values():
        word_freq_all.update(c)

    emoji_all: Counter = Counter()
    for c in emoji_freq.values():
        emoji_all.update(c)

    all_days = sorted(daily.keys())
    total_msgs = sum(p_msgs.values())
    active_days = len(all_days)

    # People sorted by message count
    people_sorted = sorted(KNOWN_SENDERS, key=lambda s: -p_msgs[s])

    # Per-person avg chars per message
    char_length_distribution: dict[str, list[int]] = {}
    for msg in messages:
        s = msg["sender"]
        length = len(msg["content"])
        if s not in char_length_distribution:
            char_length_distribution[s] = []
        char_length_distribution[s].append(length)

    # Bin message lengths: 0-50, 50-100, 100-200, 200-500, 500+
    length_bins = [0, 50, 100, 200, 500, 10000]
    length_labels = ["0-50", "50-100", "100-200", "200-500", "500+"]
    msg_length_dist: dict[str, list[int]] = {}
    for s, lengths in char_length_distribution.items():
        bins = [0] * len(length_labels)
        for l in lengths:
            for i in range(len(length_bins) - 1):
                if length_bins[i] <= l < length_bins[i + 1]:
                    bins[i] += 1
                    break
        msg_length_dist[s] = bins

    # Activity streak: max consecutive active days
    if all_days:
        from datetime import timedelta
        date_objs = [datetime.strptime(d, "%Y-%m-%d") for d in all_days]
        max_streak = 1
        cur_streak = 1
        for i in range(1, len(date_objs)):
            if (date_objs[i] - date_objs[i - 1]).days == 1:
                cur_streak += 1
                max_streak = max(max_streak, cur_streak)
            else:
                cur_streak = 1
    else:
        max_streak = 0

    return {
        "meta": {
            "generated_at": datetime.now().isoformat(),
            "total_messages": total_msgs,
            "date_from": all_days[0] if all_days else "",
            "date_to": all_days[-1] if all_days else "",
            "active_days": active_days,
            "max_streak": max_streak,
            "avg_msgs_per_day": round(total_msgs / max(1, active_days), 1),
            "people": people_sorted,
            "colors": COLORS,
            "full_names": FULL_NAMES,
            "length_labels": length_labels,
        },
        "by_person": {
            s: {
                "messages": p_msgs[s],
                "words": p_words[s],
                "chars": p_chars[s],
                "avg_words_per_msg": round(p_words[s] / max(1, p_msgs[s]), 1),
                "avg_chars_per_msg": round(p_chars[s] / max(1, p_msgs[s]), 1),
                "media_count": p_media[s],
                "links_count": p_links[s],
                "pct_messages": round(p_msgs[s] / max(1, total_msgs) * 100, 1),
                "top_emoji": (
                    emoji_freq[s].most_common(1)[0][0]
                    if emoji_freq[s]
                    else None
                ),
            }
            for s in KNOWN_SENDERS
        },
        "by_hour": {str(h): by_hour[h] for h in range(24)},
        "by_hour_person": {
            s: {str(h): by_hour_person[s][h] for h in range(24)}
            for s in KNOWN_SENDERS
        },
        "by_weekday": {str(d): by_weekday[d] for d in range(7)},
        "by_weekday_person": {
            s: {str(d): by_weekday_person[s][d] for d in range(7)}
            for s in KNOWN_SENDERS
        },
        "by_month": {
            month: {s: data.get(s, 0) for s in KNOWN_SENDERS}
            for month, data in sorted(by_month.items())
        },
        "cumulative_by_month": cumulative_by_month,
        "months_list": all_months,
        "word_freq_all": top_words(word_freq_all, 300),
        "word_freq_person": {s: top_words(word_freq[s], 150) for s in KNOWN_SENDERS},
        "emojis_all": [{"emoji": e, "count": c} for e, c in emoji_all.most_common(30)],
        "emojis_person": {
            s: [{"emoji": e, "count": c} for e, c in emoji_freq[s].most_common(15)]
            for s in KNOWN_SENDERS
        },
        "daily_timeline": {
            day: {s: cnt.get(s, 0) for s in KNOWN_SENDERS}
            for day, cnt in sorted(daily.items())
        },
        "msg_length_dist": msg_length_dist,
        "response_time_stats": {
            s: rt_stats(times) for s, times in response_times.items()
        },
    }


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    OUTPUT.parent.mkdir(exist_ok=True)

    print(f"⬡ Parsing {INPUT} ...")
    messages = parse_whatsapp(INPUT)
    print(f"  → {len(messages)} messages trouvés")

    print("⬡ Computing stats ...")
    stats = build_stats(messages)
    meta = stats["meta"]

    with open(OUTPUT, "w", encoding="utf-8") as fh:
        json.dump(stats, fh, ensure_ascii=False, separators=(",", ":"))

    print(f"  ✓ Écrit → {OUTPUT}")
    print(f"\n📊 Summary")
    print(f"   Total messages : {meta['total_messages']:,}")
    print(f"   Période        : {meta['date_from']} → {meta['date_to']}")
    print(f"   Jours actifs   : {meta['active_days']}")
    print(f"   Moy. msgs/jour : {meta['avg_msgs_per_day']}")
    print(f"   Streak max     : {meta['max_streak']} jours consécutifs")
    print("\n👤 Messages par personne :")
    for s, d in sorted(stats["by_person"].items(), key=lambda x: -x[1]["messages"]):
        bar = "█" * (d["messages"] // 100)
        print(f"   {s:3s}  {d['messages']:5d}  ({d['pct_messages']:5.1f}%)  {bar}")


if __name__ == "__main__":
    main()
