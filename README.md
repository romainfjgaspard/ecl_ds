# 💾 ECL Data Club — WhatsApp Stats Dashboard

> Analyse statistique du groupe WhatsApp · GitHub Pages

🌐 **Live site:** https://romainfjgaspard.github.io/ecl_ds/

---

## Structure

```
ecl_ds/
├── groupe.txt              WhatsApp export (non commité)
├── generate_data.py        Parseur + générateur de stats.json
├── race_bcr.py             Bar chart race (bar_chart_race lib) → data/race_bcr.mp4
├── race_matplotlib.py      Bar chart race (Matplotlib custom)  → data/race_matplotlib.mp4
├── requirements.txt
├── index.html              Dashboard GitHub Pages
├── style.css
├── app.js
└── data/
    ├── stats.json          Généré par generate_data.py
    ├── race_bcr.mp4        Généré par race_bcr.py
    └── race_matplotlib.mp4 Généré par race_matplotlib.py
```

## Setup

```bash
pip install -r requirements.txt

# 1. Générer les stats JSON (obligatoire)
python generate_data.py

# 2. (Optionnel) Vidéos bar chart race
python race_bcr.py          # nécessite ffmpeg
python race_matplotlib.py   # nécessite ffmpeg
```

> **ffmpeg** requis pour les vidéos : `winget install ffmpeg` (Windows) ou `brew install ffmpeg` (macOS)

## Dashboard features

### Charts interactifs
- **Timeline** : messages par mois/semaine, modes absolu / % relatif / cumulé
- **Messages par membre** : bar chart horizontal trié
- **Part des messages** : donut chart
- **Longueur des messages** : distribution par tranche (chars)
- **Heatmap d'activité** : heure × jour de la semaine (filtrable par membre)
- **Nuage de mots** : top mots hors stop-words (FR + EN), filtrable par membre
- **Tableau individuel** : messages, mots, moyenne, médias, liens, emoji favori — triable
- **Top emojis** : filtrable par membre
- **Temps de réponse médian** : médiane + P25/P75/P95
- **Activité hebdo** : distribution par jour de la semaine
- **Heure d'envoi** : profil horaire par membre
- **Top mots** : top 15 mots par membre

### Filtres globaux
- **Période** (mois de début / mois de fin)
- **Membres** (toggle par personne)
- **Granularité timeline** (mois / semaine)

### Bar Chart Race (3 versions)
- **JS live** : animation CSS dans le navigateur, play/pause/vitesse
- **bar_chart_race** : vidéo Python (lib dédiée)
- **Matplotlib custom** : animation FuncAnimation avec interpolation cubic ease-in-out

## Déploiement GitHub Pages

```bash
git add data/stats.json data/race_*.mp4 index.html style.css app.js
git commit -m "update stats"
git push origin main
```

Activer GitHub Pages sur `main` / root dans les settings du repo.
