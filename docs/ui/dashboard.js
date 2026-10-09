// Dashboard (one screen): numbers strip, green days calendar, time, what needs attention.

import { h, fmtDay } from './dom.js';
import { dotColour, dayScore, todayIndia, addDays, monthOf, daysWithoutWork, isOverdue, indiaDate, initials, minutesBetween, fmtMinutes, weekStart as mondayOf } from '../rules.js';
import { peopleByFollowUp } from './people.js';
import { NO_WORK_NOTE_DAYS } from '../config.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Green score for any day: today live, saved days from the record, other past days worked out from history. */
function scoreFor(data, history, day, today, todayScore) {
  if (day === today) return todayScore;
  if (day > today) return null;
  const saved = data.dayScores && data.dayScores[day];
  if (saved) return saved;
  if (!history[monthOf(day)]) return null; // month not loaded yet
  const sc = dayScore(data, history, day);
  return sc.total ? sc : null;
}

const isFull = (sc) => !!(sc && sc.total && sc.green === sc.total);
const exists = (data, id) => data.projects.some((p) => p.id === id);

/** Current streak (ending today or yesterday) and best streak over the days we can see. */
function streaks(get, today, firstDay) {
  let current = isFull(get(today)) ? 1 : 0;
  for (let d = addDays(today, -1); d >= firstDay; d = addDays(d, -1)) {
    if (!isFull(get(d))) break;
    current++;
  }
  let best = 0;
  let run = 0;
  for (let d = firstDay; d <= today; d = addDays(d, 1)) {
    if (isFull(get(d))) { run++; best = Math.max(best, run); } else run = 0;
  }
  return { current, best: Math.max(best, current) };
}

function tile(label, value, sub, cls = '') {
  return h('div', { class: 'dash-tile ' + cls }, h('div', { class: 'dash-label' }, label), h('div', { class: 'dash-value' }, value), sub ? h('div', { class: 'dash-sub' }, sub) : null);
}

export function renderDashboard(ctx) {
  const { store, ui } = ctx;
  const { data, history } = store.view;
  const today = todayIndia();
  const active = data.projects.filter((p) => p.state === 'active');
  const greenNow = active.filter((p) => dotColour(p, today) === 'green').length;
  const todayScore = { green: greenNow, total: active.length };

  // Load the history months the calendar needs (once each).
  const month = ui.dashMonth || monthOf(today);
  const loading = (ui.dashLoading ||= new Set());
  for (const m of [month, monthOf(addDays(today, -40))]) {
    if (!history[m] && store.availableMonths().includes(m) && !loading.has(m)) {
      loading.add(m);
      store.loadMonth(m).catch(() => {});
    }
  }

  if (!ui.dashAllLoaded) {
    ui.dashAllLoaded = true;
    store.loadAllHistory().then(() => ctx.render()).catch(() => { ui.dashAllLoaded = false; });
  }

  const get = (d) => scoreFor(data, history, d, today, todayScore);
  const firstCreated = data.projects.map((p) => (p.createdAt ? indiaDate(p.createdAt) : today)).sort()[0] || today;
  const firstDay = [firstCreated, addDays(today, -800)].sort().reverse()[0]; // ~2 years, same as saved scores
  const st = streaks(get, today, firstDay);

  // This month's green days
  const [yy, mm] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  let allGreenDays = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const d = `${month}-${String(i).padStart(2, '0')}`;
    const sc = get(d);
    if (isFull(sc)) allGreenDays++;
  }

  // All time
  const allEvents = Object.values(history).flat();
  const totalSteps = allEvents.filter((e) => e.kind === 'step_ticked').length;
  // finished and still finished, plus finished projects that were later deleted (reopened ones don't count)
  const finishedIds = new Set(data.projects.filter((p) => p.state === 'finished').map((p) => p.id));
  for (const e of allEvents) if (e.kind === 'finished' && !exists(data, e.projectId)) finishedIds.add(e.projectId);

  // Finished projects shelf
  const shelf = data.projects.filter((p) => p.state === 'finished').sort((a, b) => (a.stateChangedAt < b.stateChangedAt ? 1 : -1));

  // Time this week (Monday to today), by group and by project, and last week's total
  const wk = mondayOf(today);
  const lastWkStart = addDays(wk, -7);
  const lastWkEnd = addDays(wk, -1);
  const timeRows = data.projects.map((p) => ({ p, m: minutesBetween(p, wk, today, data.timer) })).filter((x) => x.m > 0).sort((a, b) => b.m - a.m);
  const timeTotal = timeRows.reduce((n, x) => n + x.m, 0);
  const lastTotal = data.projects.reduce((n, p) => n + minutesBetween(p, lastWkStart, lastWkEnd), 0);
  const byGroup = new Map();
  for (const { p, m } of timeRows) byGroup.set(p.groupId, (byGroup.get(p.groupId) || 0) + m);
  const groupRows = [...byGroup.entries()].map(([gid, m]) => ({ name: (data.groups.find((g) => g.id === gid) || {}).name || 'Other', m })).sort((a, b) => b.m - a.m);
  const maxTime = timeRows.length ? timeRows[0].m : 1;

  // Most worked projects this month
  const monthEvents = (history[monthOf(today)] || []).filter((e) => e.projectId && ['step_ticked', 'note_added', 'step_added'].includes(e.kind));
  const counts = new Map();
  for (const e of monthEvents) counts.set(e.projectId, (counts.get(e.projectId) || 0) + 1);
  const top = [...counts.entries()]
    .map(([id, n]) => ({ p: data.projects.find((x) => x.id === id), n }))
    .filter((x) => x.p)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  const maxTop = top.length ? top[0].n : 1;

  // Needs attention
  const stale = active.map((p) => ({ p, d: daysWithoutWork(p, today) })).filter((x) => x.d >= NO_WORK_NOTE_DAYS).sort((a, b) => b.d - a.d).slice(0, 6);
  const overdue = active.filter((p) => isOverdue(p, today));
  const chase = peopleByFollowUp(data).filter((x) => x.st.colour === 'red').slice(0, 6);

  // Calendar grid (Monday first)
  const firstWeekday = (new Date(Date.UTC(yy, mm - 1, 1)).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(h('div', { class: 'cal-cell blank', key: 'e' + i }));
  for (let i = 1; i <= daysInMonth; i++) {
    const d = `${month}-${String(i).padStart(2, '0')}`;
    const sc = get(d);
    const pct = sc && sc.total ? sc.green / sc.total : null;
    const cls = d > today ? 'future' : pct === null ? 'none' : pct === 1 ? 'full' : pct >= 0.5 ? 'half' : pct > 0 ? 'some' : 'zero';
    cells.push(h('div', {
      class: `cal-cell ${cls}${d === today ? ' today' : ''}`, key: d,
      title: sc && sc.total ? `${fmtDay(d)}: ${sc.green} of ${sc.total} green` : fmtDay(d),
    }, h('span', { class: 'cal-num' }, String(i)), sc && sc.total ? h('span', { class: 'cal-score' }, `${sc.green}/${sc.total}`) : null));
  }
  const shift = (n) => {
    const d = new Date(Date.UTC(yy, mm - 1 + n, 1));
    ui.dashMonth = d.toISOString().slice(0, 7);
    ctx.render();
  };

  const allGreen = active.length > 0 && greenNow === active.length;
  const monthName = monthFmt.format(new Date(Date.UTC(yy, mm - 1, 1)));
  const bar = (n, max, min) => { const f = h('div', { class: 'dash-bar-fill' }); f.style.width = `${Math.max(min, Math.round((n / max) * 100))}%`; return f; }; // style object (allowed by the page's safety rules)
  const card = (title, body, head = null, key = title) => h('section', { class: 'dash-card', key: 'dc-' + key },
    head || h('h3', null, title), body);
  // One screen: a strip of numbers on top, then three columns.
  return h('div', { class: 'dashboard compact' },
    h('div', { class: 'dash-tiles' },
      tile('Today', `${greenNow} of ${active.length}`, allGreen ? 'all green 🎉' : 'projects green', allGreen ? 'good' : ''),
      tile('Streak', `🔥 ${st.current}`, st.current === 1 ? 'day all green' : 'days in a row', st.current ? 'warm' : ''),
      tile('Best streak', String(st.best), st.best === 1 ? 'day' : 'days'),
      tile('Green days', String(allGreenDays), `in ${monthName}`),
      tile('Steps done', String(totalSteps), 'all time'),
      tile('Finished', String(finishedIds.size), finishedIds.size === 1 ? 'project' : 'projects')),

    h('div', { class: 'dash-cols' },
      h('div', { class: 'dash-col' },
        card('Green days', h('div', null,
          h('div', { class: 'cal' }, WEEKDAYS.map((w) => h('div', { class: 'cal-head', key: 'w' + w }, w)), cells),
          h('div', { class: 'cal-legend' },
            h('span', null, h('i', { class: 'cal-key full' }), 'all green'),
            h('span', null, h('i', { class: 'cal-key half' }), 'half or more'),
            h('span', null, h('i', { class: 'cal-key some' }), 'a few'),
            h('span', null, h('i', { class: 'cal-key zero' }), 'none'))),
        h('div', { class: 'dash-card-head' },
          h('button', { class: 'icon', 'aria-label': 'Previous month', onClick: () => shift(-1) }, '‹'),
          h('h3', null, `Green days — ${monthName}`),
          h('button', { class: 'icon', 'aria-label': 'Next month', onClick: () => shift(1), disabled: month >= monthOf(today) ? true : undefined }, '›')), 'cal')),

      h('div', { class: 'dash-col' },
        card('Time this week', timeTotal ? h('div', null,
          h('div', { class: 'time-total' }, h('strong', null, fmtMinutes(timeTotal)),
            lastTotal ? h('span', { class: timeTotal >= lastTotal ? 'up' : 'down' }, timeTotal >= lastTotal ? ` ↑ ${fmtMinutes(timeTotal - lastTotal)} vs last week` : ` ↓ ${fmtMinutes(lastTotal - timeTotal)} vs last week`) : h('span', { class: 'muted small' }, ' since Monday')),
          h('div', { class: 'time-groups' }, groupRows.map((g) => h('span', { class: 'tag', key: 'tg-' + g.name }, `${g.name}: ${fmtMinutes(g.m)}`))),
          h('ul', { class: 'dash-bars' }, timeRows.slice(0, 5).map(({ p, m }) => h('li', { key: 'tm-' + p.id },
            h('button', { class: 'link', onClick: () => ctx.openProject(p.id) }, p.name),
            h('div', { class: 'dash-bar' }, bar(m, maxTime, 6)), h('span', { class: 'muted small' }, fmtMinutes(m))))))
          : h('p', { class: 'muted small' }, 'No time logged this week. Press ▶ Start in a project.'),
        h('div', { class: 'dash-card-head' }, h('h3', null, 'Time this week'), h('button', { class: 'link small', onClick: () => ctx.goTime() }, 'Time report →'))),
        card('Most worked this month', top.length ? h('ul', { class: 'dash-bars' }, top.map(({ p, n }) => h('li', { key: 'top-' + p.id },
          h('button', { class: 'link', onClick: () => ctx.openProject(p.id) }, p.name),
          h('div', { class: 'dash-bar' }, bar(n, maxTop, 8)), h('span', { class: 'muted small' }, String(n)))))
          : h('p', { class: 'muted small' }, 'Nothing yet this month.'))),

      h('div', { class: 'dash-col' },
        card('Needs attention', stale.length || overdue.length ? h('ul', { class: 'dash-list' },
          [...overdue.map((p) => h('li', { key: 'od-' + p.id }, h('span', { class: 'dot red' }),
            h('button', { class: 'link', onClick: () => ctx.openProject(p.id) }, p.name), h('span', { class: 'tag late' }, `Overdue · ${fmtDay(p.deadline)}`))),
          ...stale.filter((x) => !isOverdue(x.p, today)).map(({ p, d }) => h('li', { key: 'st-' + p.id }, h('span', { class: `dot ${dotColour(p, today)}` }),
            h('button', { class: 'link', onClick: () => ctx.openProject(p.id) }, p.name), h('span', { class: 'tag stale' }, `No work ${d} days`)))].slice(0, 5))
          : h('p', { class: 'muted small' }, 'Nothing stuck. 👍')),
        card('People to contact', chase.length ? h('ul', { class: 'dash-list' }, chase.slice(0, 4).map(({ person, st: s }) => h('li', { key: 'pc-' + person.id },
          h('span', { class: 'avatar' }, initials(person.name)),
          h('button', { class: 'link', onClick: () => ctx.openPerson(person.id) }, person.name),
          h('span', { class: 'muted small' }, s.waiting ? `waiting ${s.maxWait} day${s.maxWait === 1 ? '' : 's'}` : 'date passed'))))
          : h('p', { class: 'muted small' }, 'Nobody to chase right now.')),
        card('Finished projects', shelf.length ? h('div', { class: 'shelf' }, shelf.slice(0, 6).map((p) => h('button', {
          class: 'trophy', key: 'tr-' + p.id, title: `Finished ${fmtDay(indiaDate(p.stateChangedAt))}`, onClick: () => ctx.openProject(p.id),
        }, `🏆 ${p.name}`))) : h('p', { class: 'muted small' }, 'Finish a project and its trophy shows here.')))));
}
