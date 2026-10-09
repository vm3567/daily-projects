// Time report: a group, a date range, a pie chart by tag (or by project), in % or hours,
// and a PNG image (PowerPoint size) to download or copy.

import { h } from './dom.js';
import { todayIndia, addDays, timeSplit, percents, fmtMinutes, weekStart } from '../rules.js';
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

export function renderTimeReport(ctx) {
  const { store, ui } = ctx;
  const data = store.view.data;
  const groups = data.groups.filter(groupHasTimer);
  if (!groups.length) return h('div', { class: 'report' }, h('p', { class: 'muted' }, 'No group has the timer on. Turn it on in Settings.'));
  const tr = (ui.timeReport ||= { groupId: groups[0].id, preset: 'thisWeek', by: 'tag', mode: 'pct', custom: {} });
  if (!groups.some((g) => g.id === tr.groupId)) tr.groupId = groups[0].id;
  const group = groups.find((g) => g.id === tr.groupId);
  const [from, to] = rangeFor(tr.preset, todayIndia(), tr.custom);
  const rows = timeSplit(data, group.id, from, to, tr.by);
  const pcts = percents(rows);
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  const period = from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
  const title = `${group.name} — time by ${tr.by === 'tag' ? 'tag' : 'project'}`;
  const set = (k, v) => { tr[k] = v; ctx.render(); };
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
        h('input', { type: 'date', value: tr.custom.from || from, onChange: (e, el) => { tr.custom.from = el.value; ctx.render(); } }), '→',
        h('input', { type: 'date', value: tr.custom.to || to, onChange: (e, el) => { tr.custom.to = el.value; ctx.render(); } })) : null,
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
    (group.tags || []).length ? null
      : h('p', { class: 'muted small' }, `Tip: give ${group.name} some tags in Settings (or inside a project) to see time by tag.`));
}
