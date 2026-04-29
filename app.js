/* ═══════════════════════════════════════════════════════════════════════════
   ECL Data Club — app.js
   Loads data/stats.json and renders all interactive charts
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Globals ──────────────────────────────────────────────────────────────────
let STATS = null;
let CHARTS = {};
let FILTERS = { startMonth: null, endMonth: null, people: [] };
let GRAN = 'month'; // 'month' | 'week'
let TL_MODE = 'absolute'; // 'absolute' | 'pct' | 'stacked'

// Bar chart race state
let raceTimer = null;
let raceIdx = 0;
let racePlaying = false;
let raceInitialized = false;
const RACE_MAX_SPEED = 10;

// Tab state
let activeTab = 'overview';

// Table sort state
let tableSortCol = 'messages';
let tableSortAsc = false;

// ── Chart.js global defaults (dark theme) ────────────────────────────────────
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#334155';
Chart.defaults.font.family = '"JetBrains Mono", "Fira Code", Consolas, monospace';
Chart.defaults.font.size = 11;
Chart.defaults.plugins.tooltip.backgroundColor = '#1e293b';
Chart.defaults.plugins.tooltip.borderColor = '#334155';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.titleColor = '#e2e8f0';
Chart.defaults.plugins.tooltip.bodyColor = '#94a3b8';
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 6;
Chart.defaults.plugins.legend.display = false;

const DAYS_FR   = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'];

// ── Utils ─────────────────────────────────────────────────────────────────────
const fmt  = n => n == null ? '—' : Number(n).toLocaleString('fr-FR');
const fmtS = s => s < 60 ? `${Math.round(s)}s`
               : s < 3600 ? `${Math.round(s/60)}min`
               : `${(s/3600).toFixed(1)}h`;

function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return `${MONTHS_FR[parseInt(mo)-1]} ${y}`;
}

function hexToRgba(hex, a=1) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function destroyChart(id) {
  if (CHARTS[id]) { CHARTS[id].destroy(); delete CHARTS[id]; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const resp = await fetch('data/stats.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    STATS = await resp.json();
  } catch (e) {
    document.body.innerHTML = `
      <div class="loading-overlay">
        <div style="color:#ef4444;font-size:24px">⚠</div>
        <div class="loading-text">data/stats.json introuvable</div>
        <code style="color:#38bdf8;font-size:12px">python generate_data.py</code>
      </div>`;
    return;
  }

  // Init filters
  const months = STATS.months_list;
  FILTERS.startMonth = months[0];
  FILTERS.endMonth   = months[months.length - 1];
  FILTERS.people     = [...STATS.meta.people];

  setupControls();

  // Update header badge immediately (before charts, so never stuck on 'Chargement…')
  const { date_from, date_to, total_messages } = STATS.meta;
  document.getElementById('header-badge').textContent =
    `${fmt(total_messages)} messages · ${date_from} → ${date_to}`;
  document.getElementById('footer-gen').textContent =
    `Généré le ${new Date(STATS.meta.generated_at).toLocaleString('fr-FR')}`;

  // Render after layout pass to ensure canvas dimensions are correct
  requestAnimationFrame(() => renderAll());
}

// ── Controls setup ────────────────────────────────────────────────────────────
function setupControls() {
  const months = STATS.months_list;

  // Date selects
  const selStart = document.getElementById('sel-start');
  const selEnd   = document.getElementById('sel-end');
  months.forEach(m => {
    selStart.insertAdjacentHTML('beforeend', `<option value="${m}">${monthLabel(m)}</option>`);
    selEnd.insertAdjacentHTML('beforeend',   `<option value="${m}">${monthLabel(m)}</option>`);
  });
  selStart.value = months[0];
  selEnd.value   = months[months.length - 1];
  selStart.addEventListener('change', () => {
    FILTERS.startMonth = selStart.value;
    if (FILTERS.startMonth > FILTERS.endMonth) {
      FILTERS.endMonth = FILTERS.startMonth;
      selEnd.value = FILTERS.endMonth;
    }
    renderAll();
  });
  selEnd.addEventListener('change', () => {
    FILTERS.endMonth = selEnd.value;
    if (FILTERS.endMonth < FILTERS.startMonth) {
      FILTERS.startMonth = FILTERS.endMonth;
      selStart.value = FILTERS.startMonth;
    }
    renderAll();
  });

  // Person toggles
  const toggles = document.getElementById('person-toggles');
  STATS.meta.people.forEach(p => {
    const color = STATS.meta.colors[p];
    const name  = STATS.meta.full_names[p] || p;
    const btn = document.createElement('button');
    btn.className = 'person-toggle-btn active';
    btn.dataset.person = p;
    btn.textContent = name;
    btn.style.borderColor = color;
    btn.style.color = color;
    btn.addEventListener('click', () => {
      if (FILTERS.people.includes(p)) {
        if (FILTERS.people.length === 1) return; // keep at least 1
        FILTERS.people = FILTERS.people.filter(x => x !== p);
        btn.classList.remove('active');
      } else {
        FILTERS.people.push(p);
        btn.classList.add('active');
      }
      renderAll();
    });
    toggles.appendChild(btn);
  });

  // Granularity
  document.querySelectorAll('.gran-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.gran-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      GRAN = btn.dataset.gran;
      renderTimeline();
    });
  });

  // Timeline mode
  document.querySelectorAll('#timeline-mode-btns .sm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#timeline-mode-btns .sm-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      TL_MODE = btn.dataset.mode;
      renderTimeline();
    });
  });

  // Reset
  document.getElementById('btn-reset').addEventListener('click', () => {
    FILTERS.startMonth = months[0];
    FILTERS.endMonth   = months[months.length - 1];
    FILTERS.people     = [...STATS.meta.people];
    selStart.value = months[0];
    selEnd.value   = months[months.length - 1];
    document.querySelectorAll('.person-toggle-btn').forEach(b => b.classList.add('active'));
    renderAll();
  });

  // Heatmap person select
  const selHM = document.getElementById('sel-heatmap-person');
  STATS.meta.people.forEach(p => {
    selHM.insertAdjacentHTML('beforeend',
      `<option value="${p}">${STATS.meta.full_names[p] || p}</option>`);
  });
  selHM.addEventListener('change', () => renderHeatmap(selHM.value));

  // Word cloud person select
  const selWC = document.getElementById('sel-wc-person');
  STATS.meta.people.forEach(p => {
    selWC.insertAdjacentHTML('beforeend',
      `<option value="${p}">${STATS.meta.full_names[p] || p}</option>`);
  });
  selWC.addEventListener('change', () => renderWordCloud(selWC.value));
  document.getElementById('btn-wc-refresh').addEventListener('click', () => {
    renderWordCloud(selWC.value);
  });

  // Emoji person select
  const selEmo = document.getElementById('sel-emoji-person');
  STATS.meta.people.forEach(p => {
    selEmo.insertAdjacentHTML('beforeend',
      `<option value="${p}">${STATS.meta.full_names[p] || p}</option>`);
  });
  selEmo.addEventListener('change', () => renderEmojis(selEmo.value));

  // Top words person select
  const selTW = document.getElementById('sel-topwords-person');
  STATS.meta.people.forEach(p => {
    selTW.insertAdjacentHTML('beforeend',
      `<option value="${p}">${STATS.meta.full_names[p] || p}</option>`);
  });
  selTW.addEventListener('change', () => renderTopWords(selTW.value));

  // Main navigation tabs
  document.querySelectorAll('.main-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMainTab(btn.dataset.tab));
  });

  // Race tabs (inside race tab panel)
  document.querySelectorAll('.race-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.race-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.race-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`race-panel-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Table sorting
  document.querySelectorAll('.stats-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (tableSortCol === col) { tableSortAsc = !tableSortAsc; }
      else { tableSortCol = col; tableSortAsc = false; }
      renderTable();
    });
  });
}

// ── Filtered data helpers ─────────────────────────────────────────────────────
function getFilteredMonths() {
  return STATS.months_list.filter(m =>
    m >= FILTERS.startMonth && m <= FILTERS.endMonth
  );
}

function getPersonMsgsByMonth() {
  // { person: [count per filtered month] }
  const fMonths = getFilteredMonths();
  const result = {};
  FILTERS.people.forEach(p => {
    result[p] = fMonths.map(m => (STATS.by_month[m] || {})[p] || 0);
  });
  return { months: fMonths, byPerson: result };
}

function getPersonTotals() {
  const fMonths = getFilteredMonths();
  const totals = {};
  FILTERS.people.forEach(p => {
    totals[p] = fMonths.reduce((s, m) => s + ((STATS.by_month[m] || {})[p] || 0), 0);
  });
  return totals;
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchMainTab(tab) {
  document.querySelectorAll('.main-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.main-tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === `tab-${tab}`));
  activeTab = tab;
  requestAnimationFrame(() => renderTabContent(tab));
}

function renderTabContent(tab) {
  if (tab === 'overview') {
    renderTimeline();
    const t = getPersonTotals();
    renderByPerson(t);
    renderDonut(t);
    renderLengthDist();
    renderTable();
  } else if (tab === 'activity') {
    const hmP = document.getElementById('sel-heatmap-person')?.value || 'all';
    renderHeatmap(hmP);
    renderWeekday();
    renderHour();
    renderLengthDist2();
    renderResponseTime();
  } else if (tab === 'content') {
    const emP = document.getElementById('sel-emoji-person')?.value || 'all';
    renderEmojis(emP);
    const twP = document.getElementById('sel-topwords-person')?.value || STATS.meta.people[0];
    renderTopWords(twP);
    // WordCloud last (heavier, needs correct canvas dims)
    setTimeout(() => {
      const wcP = document.getElementById('sel-wc-person')?.value || 'all';
      renderWordCloud(wcP);
    }, 60);
  } else if (tab === 'race') {
    if (!raceInitialized) {
      raceInitialized = true;
      initRaceJS();
    }
  }
}

// ── Render all ────────────────────────────────────────────────────────────────
function renderAll() {
  renderKPIs(getPersonTotals());
  renderTabContent(activeTab);
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────
function renderKPIs(totals) {
  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  const fMonths = getFilteredMonths();
  const days = fMonths.length;

  document.getElementById('kpi-total-val').textContent = fmt(total);
  document.getElementById('kpi-total-sub').textContent =
    `${fMonths[0] ? monthLabel(fMonths[0]) : '—'} → ${fMonths.at(-1) ? monthLabel(fMonths.at(-1)) : '—'}`;

  document.getElementById('kpi-days-val').textContent = fmt(STATS.meta.active_days);
  document.getElementById('kpi-days-sub').textContent = `${days} mois sélectionnés`;

  const avg = total > 0 ? (total / Math.max(1, days * 30)).toFixed(1) : '—';
  document.getElementById('kpi-avg-val').textContent = avg;
  document.getElementById('kpi-avg-sub').textContent = 'messages / jour';

  const top = Object.entries(totals).sort((a,b) => b[1]-a[1])[0];
  if (top) {
    const color = STATS.meta.colors[top[0]];
    const pct = total > 0 ? (top[1]/total*100).toFixed(1) : 0;
    const kpiTopVal = document.getElementById('kpi-top-val');
    kpiTopVal.textContent = STATS.meta.full_names[top[0]] || top[0];
    kpiTopVal.style.color = color;
    document.getElementById('kpi-top-sub').textContent = `${fmt(top[1])} msgs (${pct}%)`;
  }

  document.getElementById('kpi-streak-val').textContent = STATS.meta.max_streak;
  const totalWords = STATS.meta.people.reduce((s, p) => s + (STATS.by_person[p]?.words || 0), 0);
  document.getElementById('kpi-words-val').textContent =
    totalWords >= 1000000 ? `${(totalWords/1000000).toFixed(1)}M` :
    totalWords >= 1000 ? `${(totalWords/1000).toFixed(0)}k` : fmt(totalWords);
  document.getElementById('kpi-words-sub').textContent = 'mots ≠ stop words';
}

// ── Timeline chart ────────────────────────────────────────────────────────────
function renderTimeline() {
  destroyChart('timeline');
  const { months, byPerson } = getPersonMsgsByMonth();

  let labels, datasets;

  if (GRAN === 'week') {
    // Aggregate daily_timeline by week
    const days = Object.keys(STATS.daily_timeline).filter(d => {
      const m = d.slice(0,7);
      return m >= FILTERS.startMonth && m <= FILTERS.endMonth;
    });
    const weekMap = {};
    days.forEach(day => {
      const d = new Date(day);
      const mon = new Date(d); mon.setDate(d.getDate() - d.getDay() + 1);
      const wk = mon.toISOString().slice(0,10);
      if (!weekMap[wk]) weekMap[wk] = {};
      FILTERS.people.forEach(p => {
        weekMap[wk][p] = (weekMap[wk][p] || 0) + (STATS.daily_timeline[day][p] || 0);
      });
    });
    const weeks = Object.keys(weekMap).sort();
    labels = weeks.map(w => w.slice(5));
    const totals = weeks.map(w => FILTERS.people.reduce((s,p) => s+(weekMap[w][p]||0), 0));
    const maxVal = Math.max(...totals, 1);

    if (TL_MODE === 'stacked') {
      datasets = FILTERS.people.map(p => ({
        label: STATS.meta.full_names[p], data: weeks.map(w => weekMap[w][p]||0),
        borderColor: STATS.meta.colors[p], backgroundColor: hexToRgba(STATS.meta.colors[p], 0.35),
        borderWidth: 2, fill: true, tension: 0.3, pointRadius: 0,
      }));
    } else if (TL_MODE === 'pct') {
      datasets = FILTERS.people.map(p => ({
        label: STATS.meta.full_names[p],
        data: weeks.map(w => {
          const t = FILTERS.people.reduce((s,q) => s+(weekMap[w][q]||0), 0);
          return t > 0 ? +((weekMap[w][p]||0)/t*100).toFixed(1) : 0;
        }),
        borderColor: STATS.meta.colors[p], backgroundColor: hexToRgba(STATS.meta.colors[p], 0.15),
        borderWidth: 2, fill: false, tension: 0.3, pointRadius: 0,
      }));
    } else {
      datasets = FILTERS.people.map(p => ({
        label: STATS.meta.full_names[p], data: weeks.map(w => weekMap[w][p]||0),
        borderColor: STATS.meta.colors[p], backgroundColor: hexToRgba(STATS.meta.colors[p], 0.1),
        borderWidth: 2, fill: false, tension: 0.3, pointRadius: 0,
      }));
    }

  } else {
    // Monthly
    labels = months.map(monthLabel);
    if (TL_MODE === 'stacked') {
      datasets = FILTERS.people.map(p => ({
        label: STATS.meta.full_names[p], data: byPerson[p],
        borderColor: STATS.meta.colors[p], backgroundColor: hexToRgba(STATS.meta.colors[p], 0.35),
        borderWidth: 2, fill: true, tension: 0.3, pointRadius: 3, pointHoverRadius: 5,
      }));
    } else if (TL_MODE === 'pct') {
      datasets = FILTERS.people.map(p => {
        const totals = months.map((m,i) => FILTERS.people.reduce((s,q) => s+(byPerson[q][i]||0), 0));
        return {
          label: STATS.meta.full_names[p],
          data: byPerson[p].map((v,i) => totals[i] > 0 ? +(v/totals[i]*100).toFixed(1) : 0),
          borderColor: STATS.meta.colors[p], backgroundColor: hexToRgba(STATS.meta.colors[p], 0.15),
          borderWidth: 2, fill: false, tension: 0.3, pointRadius: 3, pointHoverRadius: 5,
        };
      });
    } else {
      datasets = FILTERS.people.map(p => ({
        label: STATS.meta.full_names[p], data: byPerson[p],
        borderColor: STATS.meta.colors[p], backgroundColor: hexToRgba(STATS.meta.colors[p], 0.1),
        borderWidth: 2, fill: false, tension: 0.3, pointRadius: 3, pointHoverRadius: 5,
      }));
    }
  }

  const yLabel = TL_MODE === 'pct' ? '% des messages' : 'Messages';

  CHARTS.timeline = new Chart(document.getElementById('chart-timeline'), {
    type: TL_MODE === 'stacked' ? 'line' : 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top',
          labels: { boxWidth: 10, padding: 14, color: '#94a3b8', pointStyle: 'line', usePointStyle: true } },
        tooltip: { mode: 'index', intersect: false,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${TL_MODE === 'pct' ? ctx.raw+'%' : fmt(ctx.raw)}`,
          }
        },
      },
      scales: {
        x: { grid: { color: '#1e293b' }, ticks: { maxRotation: 45, color: '#64748b' } },
        y: { grid: { color: '#1e293b' }, ticks: { color: '#64748b' },
             title: { display: true, text: yLabel, color: '#64748b', font: { size: 10 } },
             stacked: TL_MODE === 'stacked',
        },
      },
    },
  });
}

// ── Messages by person (horizontal bar) ──────────────────────────────────────
function renderByPerson(totals) {
  destroyChart('by-person');
  const sorted = Object.entries(totals).sort((a,b) => b[1]-a[1]);
  const labels = sorted.map(([p]) => STATS.meta.full_names[p] || p);
  const data   = sorted.map(([,v]) => v);
  const colors = sorted.map(([p]) => STATS.meta.colors[p]);
  const total  = data.reduce((s,v) => s+v, 0);

  CHARTS['by-person'] = new Chart(document.getElementById('chart-by-person'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.map(c => hexToRgba(c, 0.8)),
        borderColor: colors,
        borderWidth: 1, borderRadius: 4, borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.raw)} (${(ctx.raw/total*100).toFixed(1)}%)`,
          }
        },
      },
      scales: {
        x: { grid: { color: '#1e293b' }, ticks: { color: '#64748b' },
          title: { display: true, text: 'Messages', color: '#64748b', font: { size: 10 } } },
        y: { grid: { display: false }, ticks: { color: '#94a3b8' } },
      },
    },
  });
}

// ── Donut ─────────────────────────────────────────────────────────────────────
function renderDonut(totals) {
  destroyChart('donut');
  const sorted = Object.entries(totals).sort((a,b) => b[1]-a[1]);
  const labels = sorted.map(([p]) => STATS.meta.full_names[p] || p);
  const data   = sorted.map(([,v]) => v);
  const colors = sorted.map(([p]) => STATS.meta.colors[p]);

  CHARTS.donut = new Chart(document.getElementById('chart-donut'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data, backgroundColor: colors.map(c => hexToRgba(c, 0.85)),
        borderColor: '#0f172a', borderWidth: 3, hoverOffset: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          display: true, position: 'right',
          labels: { boxWidth: 10, padding: 10, color: '#94a3b8', font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const t = data.reduce((s,v)=>s+v,0);
              return ` ${ctx.label}: ${fmt(ctx.raw)} (${(ctx.raw/t*100).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

// ── Message length distribution (tab-activity uses chart-length2) ─────────────
function renderLengthDist2() {
  destroyChart('length2');
  const labels = STATS.meta.length_labels;
  const datasets = FILTERS.people.map(p => ({
    label: STATS.meta.full_names[p] || p,
    data: STATS.msg_length_dist[p] || labels.map(() => 0),
    backgroundColor: hexToRgba(STATS.meta.colors[p], 0.75),
    borderColor: STATS.meta.colors[p], borderWidth: 1, borderRadius: 3,
  }));
  const el = document.getElementById('chart-length2');
  if (!el) return;
  CHARTS.length2 = new Chart(el, {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top',
          labels: { boxWidth: 8, padding: 8, color: '#94a3b8', font: { size: 10 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } },
          title: { display: true, text: 'Longueur (chars)', color: '#64748b', font: { size: 10 } } },
        y: { grid: { color: '#1e293b' }, ticks: { color: '#64748b' } },
      },
    },
  });
}

// ── Message length distribution ───────────────────────────────────────────────
function renderLengthDist() {
  destroyChart('length');
  const labels = STATS.meta.length_labels;
  const datasets = FILTERS.people.map(p => ({
    label: STATS.meta.full_names[p] || p,
    data: STATS.msg_length_dist[p] || labels.map(() => 0),
    backgroundColor: hexToRgba(STATS.meta.colors[p], 0.75),
    borderColor: STATS.meta.colors[p], borderWidth: 1, borderRadius: 3,
  }));

  CHARTS.length = new Chart(document.getElementById('chart-length'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top',
          labels: { boxWidth: 8, padding: 8, color: '#94a3b8', font: { size: 10 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } },
          title: { display: true, text: 'Longueur (chars)', color: '#64748b', font: { size: 10 } } },
        y: { grid: { color: '#1e293b' }, ticks: { color: '#64748b' } },
      },
    },
  });
}

// ── Heatmap (hour × weekday) ──────────────────────────────────────────────────
function renderHeatmap(person) {
  const container = document.getElementById('heatmap-container');
  container.innerHTML = '';

  // Build 24×7 matrix
  const matrix = Array.from({length: 24}, () => new Array(7).fill(0));
  const people = person === 'all' ? STATS.meta.people : [person];

  people.forEach(p => {
    const hd = STATS.by_hour_person[p] || {};
    const wd = STATS.by_weekday_person[p] || {};
    for (let h = 0; h < 24; h++) {
      for (let d = 0; d < 7; d++) {
        // approximate: hour total × weekday total / all total
        const hTotal = (STATS.by_hour_person[p] || {})[h] || 0;
        const wTotal = (STATS.by_weekday_person[p] || {})[d] || 0;
        const allTotal = STATS.by_person[p]?.messages || 1;
        matrix[h][d] += Math.round(hTotal * wTotal / allTotal);
      }
    }
  });

  // Use actual hour-only data if single person or all
  // (exact hour×day not stored, approximated above)
  const maxVal = Math.max(...matrix.flat(), 1);

  const grid = document.createElement('div');
  grid.className = 'heatmap-grid cols-7';

  // Header row
  const emptyCell = document.createElement('div');
  grid.appendChild(emptyCell);
  DAYS_FR.forEach(d => {
    const h = document.createElement('div');
    h.className = 'heatmap-header'; h.textContent = d;
    grid.appendChild(h);
  });

  // Hour rows
  for (let h = 0; h < 24; h++) {
    const rowLabel = document.createElement('div');
    rowLabel.className = 'heatmap-row-label';
    rowLabel.textContent = `${h.toString().padStart(2,'0')}h`;
    grid.appendChild(rowLabel);

    for (let d = 0; d < 7; d++) {
      const val = matrix[h][d];
      const pct = val / maxVal;
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      const alpha = 0.08 + pct * 0.92;
      cell.style.background = `rgba(56,189,248,${alpha.toFixed(2)})`;
      cell.setAttribute('data-tip', `${DAYS_FR[d]} ${h}h : ~${val} msgs`);
      grid.appendChild(cell);
    }
  }

  container.appendChild(grid);
}

// ── Word cloud ────────────────────────────────────────────────────────────────
function renderWordCloud(person) {
  const canvas = document.getElementById('canvas-wordcloud');
  // Resize canvas to container
  const w = canvas.parentElement.offsetWidth || 600;
  const h = canvas.parentElement.offsetHeight || 280;
  canvas.width  = w;
  canvas.height = h;

  let words;
  if (person === 'all') {
    words = STATS.word_freq_all.slice(0, 120);
  } else {
    words = (STATS.word_freq_person[person] || []).slice(0, 100);
  }
  if (!words.length) return;

  const maxCount = words[0].count;
  const color = person === 'all'
    ? (i) => {
        const people = STATS.meta.people;
        return STATS.meta.colors[people[i % people.length]];
      }
    : () => STATS.meta.colors[person] || '#38bdf8';

  const list = words.map((w, i) => [
    w.word,
    Math.max(12, Math.round((w.count / maxCount) * 68))
  ]);

  const accentColors = person === 'all'
    ? STATS.meta.people.map(p => STATS.meta.colors[p])
    : [STATS.meta.colors[person] || '#38bdf8', '#94a3b8', '#64748b'];

  try {
    WordCloud(canvas, {
      list,
      gridSize: Math.round(16 * canvas.width / 1024),
      weightFactor: 1,
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      color: (word, weight, fontSize, distance, theta) => {
        const idx = list.findIndex(w => w[0] === word);
        return accentColors[idx % accentColors.length];
      },
      rotateRatio: 0.3,
      rotationSteps: 2,
      backgroundColor: 'transparent',
      shuffle: true,
      minSize: 10,
      drawOutOfBound: false,
    });
  } catch(e) {
    // wordcloud2.js not loaded
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#334155';
    ctx.fillText('wordcloud2.js not loaded', 20, 40);
  }
}

// ── Stats table ───────────────────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('stats-tbody');
  const totals = getPersonTotals();
  const grandTotal = Object.values(totals).reduce((s,v)=>s+v,0);

  // Merge static by_person with dynamic totals
  let rows = STATS.meta.people.map(p => ({
    p,
    ...STATS.by_person[p],
    messages: totals[p] || 0,
    pct_messages: grandTotal > 0 ? +(totals[p]/grandTotal*100).toFixed(1) : 0,
  }));

  // Sort
  rows.sort((a,b) => {
    const va = a[tableSortCol] ?? 0;
    const vb = b[tableSortCol] ?? 0;
    return tableSortAsc ? va - vb : vb - va;
  });

  // Update header indicators
  document.querySelectorAll('.stats-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.dataset.col === tableSortCol) {
      th.classList.add(tableSortAsc ? 'sort-asc' : 'sort-desc');
    }
  });

  const maxMsgs = Math.max(...rows.map(r => r.messages), 1);

  tbody.innerHTML = rows.map(r => {
    const color = STATS.meta.colors[r.p];
    const barW  = Math.round((r.messages / maxMsgs) * 120);
    return `
    <tr>
      <td>
        <div class="person-cell">
          <div class="person-dot" style="background:${color}"></div>
          ${STATS.meta.full_names[r.p] || r.p}
        </div>
      </td>
      <td>
        <div class="person-bar-cell">
          ${fmt(r.messages)}
          <div class="inline-bar" style="width:${barW}px;background:${color};opacity:0.7"></div>
        </div>
      </td>
      <td>${r.pct_messages}%</td>
      <td>${fmt(r.words)}</td>
      <td>${r.avg_words_per_msg}</td>
      <td>${r.avg_chars_per_msg}</td>
      <td>${fmt(r.media_count)}</td>
      <td>${fmt(r.links_count)}</td>
      <td style="font-size:18px;text-align:center">${r.top_emoji || '—'}</td>
    </tr>`;
  }).join('');
}

// ── Emojis ────────────────────────────────────────────────────────────────────
function renderEmojis(person) {
  destroyChart('emojis');
  let emojis;
  if (person === 'all') {
    emojis = STATS.emojis_all.slice(0, 12);
  } else {
    emojis = (STATS.emojis_person[person] || []).slice(0, 12);
  }
  if (!emojis.length) return;

  const color = person === 'all' ? '#38bdf8' : STATS.meta.colors[person];

  CHARTS.emojis = new Chart(document.getElementById('chart-emojis'), {
    type: 'bar',
    data: {
      labels: emojis.map(e => e.emoji),
      datasets: [{ data: emojis.map(e => e.count),
        backgroundColor: hexToRgba(color, 0.75),
        borderColor: color, borderWidth: 1, borderRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)} fois` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 16 } } },
        y: { grid: { color: '#1e293b' }, ticks: { color: '#64748b' } },
      },
    },
  });
}

// ── Response times ────────────────────────────────────────────────────────────
function renderResponseTime() {
  destroyChart('response');
  const rt = STATS.response_time_stats;
  const people = STATS.meta.people.filter(p => rt[p] && rt[p].median != null);
  if (!people.length) return;

  const sorted = people.sort((a,b) => (rt[a].median||0) - (rt[b].median||0));
  const labels = sorted.map(p => STATS.meta.full_names[p] || p);
  const medians = sorted.map(p => rt[p].median);
  const p25     = sorted.map(p => rt[p].p25);
  const p75     = sorted.map(p => rt[p].p75);
  const colors  = sorted.map(p => STATS.meta.colors[p]);

  CHARTS.response = new Chart(document.getElementById('chart-response'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'P25–P75', data: sorted.map((p,i) => [p25[i], p75[i]]),
          backgroundColor: colors.map(c => hexToRgba(c, 0.2)),
          borderColor: colors, borderWidth: 1, borderRadius: 4, skipNull: true },
        { label: 'Médiane', data: medians,
          backgroundColor: colors.map(c => hexToRgba(c, 0.85)),
          borderColor: colors, borderWidth: 1, borderRadius: 4, type: 'bar' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: true, position: 'top',
          labels: { boxWidth: 8, padding: 8, color: '#94a3b8', font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = sorted[ctx.dataIndex];
              const r = rt[p];
              return [
                ` Médiane : ${fmtS(r.median)}`,
                ` P25 : ${fmtS(r.p25)}  P75 : ${fmtS(r.p75)}`,
                ` P95 : ${fmtS(r.p95)}  (n=${r.n})`,
              ];
            },
            title: ctx => `Temps de réponse — ${ctx[0].label}`,
          },
        },
      },
      scales: {
        x: { grid: { color: '#1e293b' }, ticks: {
            color: '#64748b',
            callback: v => fmtS(v),
          },
          title: { display: true, text: 'Secondes (médiane)', color: '#64748b', font: { size: 10 } },
        },
        y: { grid: { display: false }, ticks: { color: '#94a3b8' } },
      },
    },
  });
}

// ── Weekday chart ─────────────────────────────────────────────────────────────
function renderWeekday() {
  destroyChart('weekday');
  const datasets = FILTERS.people.map(p => ({
    label: STATS.meta.full_names[p] || p,
    data: Array.from({length:7}, (_,d) => (STATS.by_weekday_person[p]||{})[d] || 0),
    backgroundColor: hexToRgba(STATS.meta.colors[p], 0.75),
    borderColor: STATS.meta.colors[p], borderWidth: 1, borderRadius: 3,
  }));

  CHARTS.weekday = new Chart(document.getElementById('chart-weekday'), {
    type: 'bar',
    data: { labels: DAYS_FR, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top',
          labels: { boxWidth: 8, padding: 8, color: '#94a3b8', font: { size: 10 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { grid: { display: false }, stacked: true, ticks: { color: '#64748b' } },
        y: { grid: { color: '#1e293b' }, stacked: true, ticks: { color: '#64748b' } },
      },
    },
  });
}

// ── Hour chart ────────────────────────────────────────────────────────────────
function renderHour() {
  destroyChart('hour');
  const labels = Array.from({length:24}, (_,h) => `${h}h`);
  const datasets = FILTERS.people.map(p => ({
    label: STATS.meta.full_names[p] || p,
    data: Array.from({length:24}, (_,h) => (STATS.by_hour_person[p]||{})[h] || 0),
    borderColor: STATS.meta.colors[p],
    backgroundColor: hexToRgba(STATS.meta.colors[p], 0.1),
    borderWidth: 1.5, fill: true, tension: 0.4, pointRadius: 0,
  }));

  CHARTS.hour = new Chart(document.getElementById('chart-hour'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top',
          labels: { boxWidth: 8, padding: 8, color: '#94a3b8', font: { size: 10 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', maxRotation: 0,
            callback: (v,i) => i % 3 === 0 ? labels[i] : '' } },
        y: { grid: { color: '#1e293b' }, ticks: { color: '#64748b' } },
      },
    },
  });
}

// ── Top words per person ──────────────────────────────────────────────────────
function renderTopWords(person) {
  destroyChart('topwords');
  const words = (STATS.word_freq_person[person] || []).slice(0, 15);
  if (!words.length) return;

  const color = STATS.meta.colors[person] || '#38bdf8';

  CHARTS.topwords = new Chart(document.getElementById('chart-topwords'), {
    type: 'bar',
    data: {
      labels: words.map(w => w.word),
      datasets: [{
        data: words.map(w => w.count),
        backgroundColor: words.map((_, i) => hexToRgba(color, 0.4 + i/words.length * 0.6)),
        borderColor: color, borderWidth: 1, borderRadius: 3,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)} fois` } },
      },
      scales: {
        x: { grid: { color: '#1e293b' }, ticks: { color: '#64748b' } },
        y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 11 } } },
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// BAR CHART RACE — JavaScript live version
// ═══════════════════════════════════════════════════════════════════════════
function initRaceJS() {
  raceIdx = 0;
  racePlaying = false;
  updateRaceFrame(0);

  const playBtn    = document.getElementById('race-play-btn');
  const restartBtn = document.getElementById('race-restart-btn');
  const speedSlider= document.getElementById('race-speed');
  const speedLabel = document.getElementById('race-speed-label');

  playBtn.addEventListener('click', () => {
    if (racePlaying) {
      pauseRace();
      playBtn.textContent = '▶ Play';
    } else {
      if (raceIdx >= STATS.months_list.length - 1) raceIdx = 0;
      playRace();
      playBtn.textContent = '⏸ Pause';
    }
  });

  restartBtn.addEventListener('click', () => {
    pauseRace();
    raceIdx = 0;
    updateRaceFrame(0);
    playBtn.textContent = '▶ Play';
  });

  speedSlider.addEventListener('input', () => {
    const v = parseInt(speedSlider.value);
    speedLabel.textContent = `×${v}`;
    if (racePlaying) {
      pauseRace();
      playRace();
    }
  });
}

function getRaceInterval() {
  const speed = parseInt(document.getElementById('race-speed').value);
  return Math.round(1800 / speed);
}

function playRace() {
  racePlaying = true;
  raceTimer = setInterval(() => {
    raceIdx++;
    if (raceIdx >= STATS.months_list.length) {
      raceIdx = STATS.months_list.length - 1;
      pauseRace();
      document.getElementById('race-play-btn').textContent = '▶ Play';
      return;
    }
    updateRaceFrame(raceIdx);
  }, getRaceInterval());
}

function pauseRace() {
  racePlaying = false;
  if (raceTimer) { clearInterval(raceTimer); raceTimer = null; }
}

function updateRaceFrame(idx) {
  const months  = STATS.months_list;
  const month   = months[idx];
  const cumData = STATS.cumulative_by_month[month] || {};
  const people  = STATS.meta.people;
  const maxVal  = Math.max(...people.map(p => cumData[p] || 0), 1);

  // Sort descending
  const sorted = [...people].sort((a,b) => (cumData[b]||0) - (cumData[a]||0));

  document.getElementById('js-race-month').textContent = monthLabel(month);
  const total = sorted.reduce((s,p) => s+(cumData[p]||0), 0);
  document.getElementById('js-race-total').textContent = `${fmt(total)} messages cumulés`;

  // Update progress
  const pct = months.length > 1 ? (idx / (months.length-1) * 100) : 100;
  document.getElementById('race-progress-fill').style.width = pct+'%';
  document.getElementById('race-progress-label').textContent =
    `${idx+1} / ${months.length}`;

  const container = document.getElementById('js-race-bars');

  // Reorder DOM rows (create or reuse)
  let rows = {};
  container.querySelectorAll('.race-bar-row').forEach(r => {
    rows[r.dataset.person] = r;
  });

  // Build rows that don't exist
  sorted.forEach((p, rank) => {
    if (!rows[p]) {
      const color = STATS.meta.colors[p];
      const name  = STATS.meta.full_names[p] || p;
      const row = document.createElement('div');
      row.className = 'race-bar-row';
      row.dataset.person = p;
      row.innerHTML = `
        <div class="race-bar-name" style="color:${color}">${name}</div>
        <div class="race-bar-track">
          <div class="race-bar-fill" style="background:${color};width:0%">
            <span class="race-bar-val">0</span>
          </div>
        </div>
        <div class="race-bar-rank">#${rank+1}</div>`;
      container.appendChild(row);
      rows[p] = row;
    }
  });

  // Update all bars
  sorted.forEach((p, rank) => {
    const val  = cumData[p] || 0;
    const pct  = (val / maxVal * 100).toFixed(2);
    const row  = rows[p];
    const fill = row.querySelector('.race-bar-fill');
    const valEl= row.querySelector('.race-bar-val');
    const rnkEl= row.querySelector('.race-bar-rank');

    fill.style.width = pct+'%';
    valEl.textContent = fmt(val);
    rnkEl.textContent = `#${rank+1}`;
    rnkEl.style.color = rank === 0 ? '#fbbf24' : '#64748b';

    // Re-order in DOM (sorted order)
    container.appendChild(row);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
