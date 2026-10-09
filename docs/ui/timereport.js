// Time report: a group, a date range, a pie chart by tag (or by project), in % or hours,
// and a PNG image (PowerPoint size) to download or copy.

import { h } from './dom.js';
import { todayIndia, addDays, timeSplit, percents, fmtMinutes, weekStart, monthOf } from '../rules.js';
import { workDoneByTag } from '../reports.js';
import { device } from '../device.js';
import { groupHasTimer } from '../ops.js';

const COLOURS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569'];
const NO_TAG_COLOUR = '#cbd5e1';

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDate = (d) => dayFmt.format(new Date(d + 'T00:00:00Z'));

/** The date range for a preset. */
export function rangeFor(preset, today = todayIndia(), custom = {}) {
  const [y, m] = today.split('-').map(Number);
  const monthStart = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const monthEnd = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, '0')}`;
  if (preset === 'lastWeek') { const mon = addDays(weekStart(today), -7); return [mon, addDays(mon, 6)]; }
  if (preset === 'thisMonth') return [monthStart(y, m), today];
  if (preset === 'lastMonth') { const ly = m === 1 ? y - 1 : y; const lm = m === 1 ? 12 : m - 1; return [monthStart(ly, lm), monthEnd(ly, lm)]; }
  if (preset === 'custom' && custom.from && custom.to) return custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
  return [weekStart(today), today]; // this week (Monday to today)
}

function colourFor(row, i) { return row.key === 'none' ? NO_TAG_COLOUR : COLOURS[i % COLOURS.length]; }

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  for (const k of kids) if (k) el.appendChild(k);
  return el;
}

/** Pie slices as SVG paths (a single 100% slice is a full circle). */
function pieSvg(rows, size = 240) {
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  const r = size / 2;
  const kids = [];
  if (rows.length === 1) kids.push(svg('circle', { cx: r, cy: r, r: r - 2, fill: colourFor(rows[0], 0) }));
  else {
    let a0 = -Math.PI / 2;
    rows.forEach((row, i) => {
      const a1 = a0 + (row.minutes / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => `${r + (r - 2) * Math.cos(a)} ${r + (r - 2) * Math.sin(a)}`;
      kids.push(svg('path', { d: `M ${r} ${r} L ${p(a0)} A ${r - 2} ${r - 2} 0 ${large} 1 ${p(a1)} Z`, fill: colourFor(row, i), stroke: '#fff', 'stroke-width': 2 }));
      a0 = a1;
    });
  }
  return svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'pie', role: 'img', 'aria-label': 'Pie chart' }, ...kids);
}

/** Draw the report on a canvas (1600×900 = PowerPoint 16:9) and return a PNG blob. */
export async function reportPng({ title, period, rows, pcts, mode }) {
  const W = 1600; const H = 900;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#0f172a'; g.font = 'bold 54px -apple-system, Segoe UI, Roboto, Arial, sans-serif'; g.fillText(title, 80, 110);
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  g.fillStyle = '#475569'; g.font = '32px -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  g.fillText(`${period}   ·   Total ${fmtMinutes(total)}`, 80, 165);
  // pie
  const cx = 420; const cy = 520; const rad = 280;
  let a0 = -Math.PI / 2;
  rows.forEach((row, i) => {
    const a1 = a0 + (total ? (row.minutes / total) * Math.PI * 2 : 0);
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rad, a0, a1); g.closePath();
    g.fillStyle = colourFor(row, i); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke();
    a0 = a1;
  });
  // legend
  let y = 280;
  const shown = rows.slice(0, 7);
  shown.forEach((row, i) => {
    g.fillStyle = colourFor(row, i); g.fillRect(820, y - 30, 36, 36);
    g.fillStyle = '#0f172a'; g.font = 'bold 34px -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    const name = row.name.length > 28 ? row.name.slice(0, 27) + '…' : row.name;
    g.fillText(name, 876, y);
    g.textAlign = 'right';
    g.fillText(mode === 'pct' ? `${pcts[i]}%` : fmtMinutes(row.minutes), 1520, y);
    g.fillStyle = '#64748b'; g.font = '26px -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    g.fillText(mode === 'pct' ? fmtMinutes(row.minutes) : `${pcts[i]}%`, 1520, y + 34);
    g.textAlign = 'left';
    y += 92; // room for the small second number under each line
  });
  if (rows.length > shown.length) { g.fillStyle = '#64748b'; g.font = '26px sans-serif'; g.fillText(`+ ${rows.length - shown.length} more`, 876, y); }
  g.fillStyle = '#94a3b8'; g.font = '24px -apple-system, Segoe UI, Roboto, Arial, sans-serif';
  g.fillText('Daily Projects', 80, H - 50);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

/** Fit text into a width on the canvas, adding "…" when too long. */
function fit(g, text, width) {
  if (g.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > width) t = t.slice(0, -1);
  return t + '…';
}

/** The owner report: time pie + legend on the left, work done per tag on the right (1600×900). */
export async function fullReportPng({ title, period, rows, pcts, work, tagColours, statuses = [] }) {
  const W = 1600; const H = 900;
  const FONT = '-apple-system, Segoe UI, Roboto, Arial, sans-serif';
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  g.fillStyle = '#0f172a'; g.font = `bold 50px ${FONT}`; g.fillText(fit(g, title, W - 140), 70, 95);
  g.fillStyle = '#475569'; g.font = `30px ${FONT}`; g.fillText(`${period}   ·   Total ${fmtMinutes(total)}`, 70, 145);
  // left: pie
  const cx = 330; const cy = 400; const rad = 190;
  let a0 = -Math.PI / 2;
  rows.forEach((row, i) => {
    const a1 = a0 + (total ? (row.minutes / total) * Math.PI * 2 : 0);
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rad, a0, a1); g.closePath();
    g.fillStyle = colourFor(row, i); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke();
    a0 = a1;
  });
  // left: legend under the pie
  let y = 640;
  rows.slice(0, 5).forEach((row, i) => {
    g.fillStyle = colourFor(row, i); g.fillRect(90, y - 22, 26, 26);
    g.fillStyle = '#0f172a'; g.font = `bold 26px ${FONT}`; g.fillText(fit(g, row.name, 250), 130, y);
    g.textAlign = 'right'; g.fillText(`${pcts[i]}%`, 520, y);
    g.fillStyle = '#64748b'; g.font = `24px ${FONT}`; g.fillText(fmtMinutes(row.minutes), 620, y);
    g.textAlign = 'left';
    y += 44;
  });
  if (rows.length > 5) { g.fillStyle = '#64748b'; g.font = `22px ${FONT}`; g.fillText(`+ ${rows.length - 5} more`, 130, y); }
  // right: work done per tag
  const x = 720;
  g.strokeStyle = '#e2e8f0'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 40, 190); g.lineTo(x - 40, H - 60); g.stroke();
  g.fillStyle = '#0f172a'; g.font = `bold 34px ${FONT}`;
  const doneCount = work.reduce((n, w) => n + w.items.length, 0);
  g.fillText(`Work done (${doneCount} step${doneCount === 1 ? '' : 's'})`, x, 220);
  y = 275;
  const standRows = statuses.slice(0, statuses.length > 6 ? 5 : 6);
  const standMore = statuses.length - standRows.length; // shown as "+ N more" so nothing is silently left out
  const standLines = standRows.length + (standMore ? 1 : 0);
  const standTop = standLines ? H - 60 - standLines * 34 - 50 : H;
  const maxY = Math.min(H - 70, standTop - 20);
  let hidden = 0;
  for (const w of work) {
    if (y > maxY - 40) { hidden += w.items.length; continue; }
    g.fillStyle = tagColours[w.key] || NO_TAG_COLOUR; g.fillRect(x, y - 22, 22, 22);
    g.fillStyle = '#0f172a'; g.font = `bold 28px ${FONT}`; g.fillText(fit(g, `${w.name} (${w.items.length})`, 780), x + 34, y);
    y += 40;
    for (const it of w.items) {
      if (y > maxY - 34) { hidden++; continue; } // keep a line free for "+ N more steps"

      g.fillStyle = '#334155'; g.font = `24px ${FONT}`;
      g.fillText(fit(g, `•  ${it.text}`, 600), x + 34, y);
      g.fillStyle = '#94a3b8'; g.font = `20px ${FONT}`;
      g.textAlign = 'right'; g.fillText(fit(g, it.project, 200), W - 60, y); g.textAlign = 'left';
      y += 34;
    }
    y += 12;
  }
  if (!doneCount) { g.fillStyle = '#94a3b8'; g.font = `24px ${FONT}`; g.fillText('No steps finished in this period.', x, y); }
  if (hidden) { g.fillStyle = '#64748b'; g.font = `22px ${FONT}`; g.fillText(`+ ${hidden} more steps`, x + 34, Math.min(y, maxY + 4)); }
  if (standRows.length) { // where things stand: one line per project
    g.strokeStyle = '#e2e8f0'; g.beginPath(); g.moveTo(x, standTop - 4); g.lineTo(W - 60, standTop - 4); g.stroke();
    g.fillStyle = '#0f172a'; g.font = `bold 28px ${FONT}`; g.fillText('Where things stand', x, standTop + 32);
    let sy = standTop + 74;
    for (const s of standRows) {
      g.fillStyle = '#0f172a'; g.font = `bold 23px ${FONT}`;
      const name = fit(g, s.name, 300);
      g.fillText(name, x, sy);
      const nw = g.measureText(name).width;
      g.fillStyle = '#92400e'; g.font = `23px ${FONT}`;
      g.fillText(fit(g, `— ${s.status}`, W - 60 - (x + nw + 12)), x + nw + 12, sy);
      sy += 34;
    }
    if (standMore) { g.fillStyle = '#64748b'; g.font = `22px ${FONT}`; g.fillText(`+ ${standMore} more projects (see the Time report page)`, x, sy); }
  }
  g.fillStyle = '#94a3b8'; g.font = `22px ${FONT}`; g.fillText('Daily Projects', 70, H - 30);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

/** Which period the report opens on: "Last month" in the first week of a month (owner report time), else what you used last. */
export function startPreset(today, saved) {
  if (Number(today.slice(8, 10)) <= 7) return 'lastMonth';
  return saved && saved !== 'custom' && PRESETS_OK.includes(saved) ? saved : 'thisWeek';
}
const PRESETS_OK = ['thisWeek', 'lastWeek', 'thisMonth', 'lastMonth'];

export function renderTimeReport(ctx) {
  const { store, ui } = ctx;
  const data = store.view.data;
  const groups = data.groups.filter(groupHasTimer);
  if (!groups.length) return h('div', { class: 'report' }, h('p', { class: 'muted' }, 'No group has the timer on. Turn it on in Settings.'));
  if (!ui.timeReport) {
    const saved = device.report();
    ui.timeReport = {
      groupId: saved.groupId || groups[0].id, preset: startPreset(todayIndia(), saved.preset),
      by: saved.by === 'project' ? 'project' : 'tag', mode: saved.mode === 'hours' ? 'hours' : 'pct', custom: {},
    };
  }
  const tr = ui.timeReport;
  if (!groups.some((g) => g.id === tr.groupId)) tr.groupId = groups[0].id;
  const group = groups.find((g) => g.id === tr.groupId);
  const [from, to] = rangeFor(tr.preset, todayIndia(), tr.custom);
  const rows = timeSplit(data, group.id, from, to, tr.by);
  // the history months this period needs (for "Work done")
  const need = new Set();
  for (let d = from; d <= to; d = addDays(d, 27)) need.add(monthOf(d));
  need.add(monthOf(to));
  const loading = (ui.trLoaded ||= new Set());
  for (const m of need) {
    if (!store.view.history[m] && store.availableMonths().includes(m) && !loading.has(m)) {
      loading.add(m);
      store.loadMonth(m).catch(() => loading.delete(m));
    }
  }
  const work = workDoneByTag(data, store.view.history, group.id, from, to);
  const tagRows = tr.by === 'tag' ? rows : timeSplit(data, group.id, from, to, 'tag');
  const tagColours = {};
  tagRows.forEach((r, i) => { tagColours[r.key] = colourFor(r, i); });
  const pcts = percents(rows);
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  const period = from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
  const title = `${group.name} — time by ${tr.by === 'tag' ? 'tag' : 'project'}`;
  const set = (k, v) => {
    if (k === 'preset' && v === 'custom') tr.custom = { from, to }; // start from the dates on screen, so changing one box works
    tr[k] = v;
    device.setReport({ groupId: tr.groupId, preset: tr.preset, by: tr.by, mode: tr.mode }); // opens the same way next time
    ctx.render();
  };
  const seg = (k, opts) => h('div', { class: 'segmented' }, opts.map(([v, label]) => h('button', {
    class: 'seg' + (tr[k] === v ? ' on' : ''), 'aria-pressed': String(tr[k] === v), onClick: () => set(k, v),
  }, label)));

  const download = async () => {
    const blob = await reportPng({ title, period, rows, pcts, mode: tr.mode });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `${group.name}-time-${from}-to-${to}.png` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    ctx.toast('Image downloaded — insert it in PowerPoint', 2500);
  };
  const fullTitle = `${group.name} — time and work done`;
  const statuses = data.projects.filter((p) => p.groupId === group.id && p.state === 'active' && p.status).map((p) => ({ name: p.name, status: p.status }));
  const fullPng = () => fullReportPng({ title: fullTitle, period, rows: tagRows, pcts: percents(tagRows), work, tagColours, statuses });
  const downloadFull = async () => {
    const blob = await fullPng();
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `${group.name}-report-${from}-to-${to}.png` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    ctx.toast('Report image downloaded — insert it in PowerPoint', 2500);
  };
  const copyFull = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': fullPng() })]);
      ctx.toast('Report image copied — paste it in PowerPoint or WhatsApp', 2500);
    } catch { ctx.toast('Copy is not allowed here — use Download instead'); }
  };
  const copy = async () => {
    try {
      // a promise inside ClipboardItem keeps iPhone Safari happy (the copy must start in the tap)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': reportPng({ title, period, rows, pcts, mode: tr.mode }) })]);
      ctx.toast('Image copied — paste it in PowerPoint or WhatsApp', 2500);
    } catch {
      ctx.toast('Copy is not allowed here — use Download image instead');
    }
  };

  return h('div', { class: 'report' },
    h('div', { class: 'report-controls' },
      h('label', null, 'Group ', h('select', { value: tr.groupId, onChange: (e, el) => set('groupId', el.value) }, groups.map((g) => h('option', { value: g.id }, g.name)))),
      h('label', null, 'Period ', h('select', { value: tr.preset, onChange: (e, el) => set('preset', el.value) },
        h('option', { value: 'thisWeek' }, 'This week'), h('option', { value: 'lastWeek' }, 'Last week'),
        h('option', { value: 'thisMonth' }, 'This month'), h('option', { value: 'lastMonth' }, 'Last month'),
        h('option', { value: 'custom' }, 'Choose dates…'))),
      tr.preset === 'custom' ? h('span', { class: 'row' },
        h('input', { type: 'date', value: tr.custom.from || from, onChange: (e, el) => { tr.custom = { from: el.value || from, to: tr.custom.to || to }; ctx.render(); } }), '→',
        h('input', { type: 'date', value: tr.custom.to || to, onChange: (e, el) => { tr.custom = { from: tr.custom.from || from, to: el.value || to }; ctx.render(); } })) : null,
      seg('by', [['tag', 'By tag'], ['project', 'By project']]),
      seg('mode', [['pct', '%'], ['hours', 'Hours']])),
    h('section', { class: 'dash-card report-card' },
      h('h3', null, title),
      h('p', { class: 'muted' }, `${period} · Total ${fmtMinutes(total)}`),
      total ? h('div', { class: 'report-body' },
        pieSvg(rows),
        h('ul', { class: 'report-legend' }, rows.map((row, i) => {
          const sw = h('span', { class: 'swatch' });
          sw.style.background = colourFor(row, i); // style object (allowed by the page's safety rules)
          return h('li', { key: 'rl-' + row.key }, sw,
            h('span', { class: 'legend-name' }, row.name),
            h('strong', null, tr.mode === 'pct' ? `${pcts[i]}%` : fmtMinutes(row.minutes)),
            h('span', { class: 'muted small' }, tr.mode === 'pct' ? fmtMinutes(row.minutes) : `${pcts[i]}%`));
        })))
        : h('p', { class: 'muted' }, `No time logged in ${group.name} for this period.`),
      total ? h('div', { class: 'row report-actions' },
        h('button', { class: 'btn primary', onClick: download }, '⬇ Download image'),
        h('button', { class: 'btn', onClick: copy }, '📋 Copy image'),
        h('span', { class: 'muted small' }, 'PowerPoint size (16:9)')) : null),
    h('section', { class: 'dash-card report-card' },
      h('div', { class: 'dash-card-head' }, h('h3', null, ((n) => `Work done (${n} step${n === 1 ? '' : 's'})`)(work.reduce((n, w) => n + w.items.length, 0)))),
      work.length ? h('div', { class: 'work-done' }, work.map((w) => {
        const sw = h('span', { class: 'swatch' });
        sw.style.background = tagColours[w.key] || NO_TAG_COLOUR; // style object (allowed by the page's safety rules)
        return h('div', { class: 'work-tag', key: 'wd-' + w.key },
          h('div', { class: 'work-tag-head' }, sw, h('strong', null, w.name), h('span', { class: 'muted small' }, `${w.items.length} step${w.items.length === 1 ? '' : 's'}`)),
          h('ul', null, w.items.slice(0, tr.showAllWork ? 999 : 6).map((it, i) => h('li', { key: 'wi-' + i },
            h('span', null, `✓ ${it.text}`), h('span', { class: 'muted small' }, it.project)))));
      })) : h('p', { class: 'muted' }, 'No steps finished in this period.'),
      work.some((w) => w.items.length > 6) ? h('button', { class: 'link small', onClick: () => set('showAllWork', !tr.showAllWork) }, tr.showAllWork ? 'Show fewer' : 'Show all') : null,
      statuses.length ? h('div', { class: 'stand' }, h('h4', null, 'Where things stand'),
        h('ul', null, statuses.map((st, i) => h('li', { key: 'stand-' + i }, h('strong', null, st.name), h('span', { class: 'muted' }, ` — ${st.status}`))))) : null,
      h('div', { class: 'row report-actions' },
        h('button', { class: 'btn primary', onClick: downloadFull }, '⬇ Full report image'),
        h('button', { class: 'btn', onClick: copyFull }, '📋 Copy full report'),
        h('span', { class: 'muted small' }, 'Time by tag + work done + status, PowerPoint size'))),
    (group.tags || []).length ? null
      : h('p', { class: 'muted small' }, `Tip: give ${group.name} some tags in Settings (or inside a project) to see time by tag.`));
}
