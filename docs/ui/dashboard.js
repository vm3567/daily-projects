// Dashboard: streaks, green days calendar, this week's numbers, what needs attention.

import { h, fmtDay } from './dom.js';
import { dotColour, dayScore, todayIndia, addDays, monthOf, daysWithoutWork, isOverdue, indiaDate, initials } from '../rules.js';
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
  const firstDay = [firstCreated, addDays(today, -120)].sort().reverse()[0];
  const st = streaks(get, today, firstDay);

  // This month's green days
  const [yy, mm] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  let allGreenDays = 0;
  let someGreenDays = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const d = `${month}-${String(i).padStart(2, '0')}`;
    const sc = get(d);
    if (isFull(sc)) allGreenDays++;
    else if (sc && sc.green) someGreenDays++;
  }

  // This week (last 7 days) from history
  const weekStart = addDays(today, -6);
  const events = Object.values(history).flat().filter((e) => indiaDate(e.at) >= weekStart);
  const stepsDone = events.filter((e) => e.kind === 'step_ticked').length;
  const notes = events.filter((e) => e.kind === 'note_added').length;
  const worked = new Set(events.filter((e) => e.projectId && e.kind !== 'created' && e.kind !== 'reviewed').map((e) => e.projectId)).size;

  // 1. Wins this week: the real steps finished, newest first
  const nameOf = (e) => (data.projects.find((x) => x.id === e.projectId) || {}).name || e.projectName || '';
  const wins = events.filter((e) => e.kind === 'step_ticked').sort((a, b) => (a.at < b.at ? 1 : -1));
  const dayName = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });

  // 2. This week vs last week
  const lastStart = addDays(today, -13);
  const lastEnd = addDays(today, -7);
  const allEvents = Object.values(history).flat();
  const inRange = (e, a, b) => { const d = indiaDate(e.at); return d >= a && d <= b; };
  const lastWeek = allEvents.filter((e) => inRange(e, lastStart, lastEnd));
  const greenDaysIn = (a, b) => { let n = 0; for (let d = a; d <= b; d = addDays(d, 1)) if (isFull(get(d))) n++; return n; };
  const compare = [
    ['Steps done', stepsDone, lastWeek.filter((e) => e.kind === 'step_ticked').length],
    ['All-green days', greenDaysIn(weekStart, today), greenDaysIn(lastStart, lastEnd)],
    ['Work notes', notes, lastWeek.filter((e) => e.kind === 'note_added').length],
  ];
  const trend = (now, before) => (now > before ? h('span', { class: 'up' }, `↑ ${now - before} more`)
    : now < before ? h('span', { class: 'down' }, `↓ ${before - now} fewer`) : h('span', { class: 'muted small' }, 'same'));

  // 3. All time
  const totalSteps = allEvents.filter((e) => e.kind === 'step_ticked').length;
  // finished and still finished, plus finished projects that were later deleted (reopened ones don't count)
  const finishedIds = new Set(data.projects.filter((p) => p.state === 'finished').map((p) => p.id));
  for (const e of allEvents) if (e.kind === 'finished' && !exists(data, e.projectId)) finishedIds.add(e.projectId);
  let totalGreenDays = 0;
  for (let d = firstDay; d <= today; d = addDays(d, 1)) if (isFull(get(d))) totalGreenDays++;

  // 4. Finished projects shelf
  const shelf = data.projects.filter((p) => p.state === 'finished').sort((a, b) => (a.stateChangedAt < b.stateChangedAt ? 1 : -1));

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
  const showWins = ui.showAllWins ? wins : wins.slice(0, 6);
  return h('div', { class: 'dashboard' },
    allGreen ? h('div', { class: 'celebrate', key: 'celebrate' },
      h('div', { class: 'celebrate-big' }, `🎉 All ${active.length} projects green!`),
      h('div', null, st.current > 1 ? `${st.current} days in a row${st.current >= st.best ? ' — your best ever' : ''}` : 'Every project got your attention today.')) : null,
    h('div', { class: 'dash-tiles' },
      tile('Today', `${greenNow} of ${active.length}`, greenNow === active.length && active.length ? 'all green 🎉' : 'projects green', greenNow === active.length && active.length ? 'good' : ''),
      tile('Streak', `🔥 ${st.current}`, st.current === 1 ? 'day all green' : 'days all green in a row', st.current ? 'warm' : ''),
      tile('Best streak', String(st.best), st.best === 1 ? 'day' : 'days'),
      tile(`All-green days`, String(allGreenDays), `in ${monthFmt.format(new Date(Date.UTC(yy, mm - 1, 1)))}`)),

    h('div', { class: 'dash-grid', key: 'dash-wins' },
      h('section', { class: 'dash-card' }, h('h3', null, `Wins this week (${wins.length})`),
        wins.length ? h('ul', { class: 'wins' }, showWins.map((e) => h('li', { key: 'win-' + e.id },
          h('span', { class: 'win-check' }, '✓'),
          h('div', null, h('div', null, e.detail),
            h('div', { class: 'muted small' }, exists(data, e.projectId)
              ? [h('button', { class: 'link small', onClick: () => ctx.openProject(e.projectId) }, nameOf(e)), ` · ${dayName.format(new Date(e.at))}`]
              : `${nameOf(e)} · ${dayName.format(new Date(e.at))}`))))) : h('p', { class: 'muted small' }, 'Tick a step and it shows here.'),
        wins.length > 6 ? h('button', { class: 'link small', onClick: () => { ui.showAllWins = !ui.showAllWins; ctx.render(); } },
          ui.showAllWins ? 'Show fewer' : `+ ${wins.length - 6} more`) : null),
      h('section', { class: 'dash-card' }, h('h3', null, 'This week vs last week'),
        h('ul', { class: 'compare' }, compare.map(([label, now, before]) => h('li', { key: 'cmp-' + label },
          h('span', null, label), h('span', null, h('strong', null, String(now)), ' ', trend(now, before))))))),

    h('div', { class: 'dash-grid', key: 'dash-alltime' },
      h('section', { class: 'dash-card' }, h('h3', null, 'All time'),
        h('div', { class: 'dash-nums' },
          h('div', null, h('strong', null, String(totalSteps)), h('span', null, 'steps done')),
          h('div', null, h('strong', null, String(finishedIds.size)), h('span', null, 'projects finished')),
          h('div', null, h('strong', null, String(totalGreenDays)), h('span', null, 'all-green days')))),
      h('section', { class: 'dash-card' }, h('h3', null, 'Finished projects'),
        shelf.length ? h('div', { class: 'shelf' }, shelf.slice(0, 12).map((p) => h('button', {
          class: 'trophy', key: 'tr-' + p.id, title: `Finished ${fmtDay(indiaDate(p.stateChangedAt))}`, onClick: () => ctx.openProject(p.id),
        }, `🏆 ${p.name}`))) : h('p', { class: 'muted small' }, 'Finish a project and its trophy shows here.'))),

    h('section', { class: 'dash-card' },
      h('div', { class: 'dash-card-head' },
        h('button', { class: 'icon', 'aria-label': 'Previous month', onClick: () => shift(-1) }, '‹'),
        h('h3', null, `Green days — ${monthFmt.format(new Date(Date.UTC(yy, mm - 1, 1)))}`),
        h('button', { class: 'icon', 'aria-label': 'Next month', onClick: () => shift(1), disabled: month >= monthOf(today) ? true : undefined }, '›')),
      h('div', { class: 'cal' }, WEEKDAYS.map((w) => h('div', { class: 'cal-head', key: 'w' + w }, w)), cells),
      h('div', { class: 'cal-legend' },
        h('span', null, h('i', { class: 'cal-key full' }), 'all green'),
        h('span', null, h('i', { class: 'cal-key half' }), 'half or more'),
        h('span', null, h('i', { class: 'cal-key some' }), 'a few'),
        h('span', null, h('i', { class: 'cal-key zero' }), 'none'),
        someGreenDays || allGreenDays ? null : h('span', { class: 'muted' }, 'Fills in as days pass.'))),

    h('div', { class: 'dash-grid' },
      h('section', { class: 'dash-card' }, h('h3', null, 'Last 7 days'),
        h('div', { class: 'dash-nums' },
          h('div', null, h('strong', null, String(stepsDone)), h('span', null, 'steps done')),
          h('div', null, h('strong', null, String(notes)), h('span', null, 'work notes')),
          h('div', null, h('strong', null, String(worked)), h('span', null, 'projects worked on')))),

      h('section', { class: 'dash-card' }, h('h3', null, 'Most worked this month'),
        top.length ? h('ul', { class: 'dash-bars' }, top.map(({ p, n }) => {
          const fill = h('div', { class: 'dash-bar-fill' });
          fill.style.width = `${Math.max(8, Math.round((n / maxTop) * 100))}%`; // style object (allowed by the page's safety rules)
          return h('li', { key: 'top-' + p.id },
            h('button', { class: 'link', onClick: () => ctx.openProject(p.id) }, p.name),
            h('div', { class: 'dash-bar' }, fill), h('span', { class: 'muted small' }, String(n)));
        })) : h('p', { class: 'muted small' }, 'Nothing yet this month.')),

      h('section', { class: 'dash-card' }, h('h3', null, 'Needs attention'),
        stale.length || overdue.length ? h('ul', { class: 'dash-list' },
          overdue.map((p) => h('li', { key: 'od-' + p.id }, h('span', { class: 'dot red' }),
            h('button', { class: 'link', onClick: () => ctx.openProject(p.id) }, p.name), h('span', { class: 'tag late' }, `Overdue · ${fmtDay(p.deadline)}`))),
          stale.filter((x) => !isOverdue(x.p, today)).map(({ p, d }) => h('li', { key: 'st-' + p.id }, h('span', { class: `dot ${dotColour(p, today)}` }),
            h('button', { class: 'link', onClick: () => ctx.openProject(p.id) }, p.name), h('span', { class: 'tag stale' }, `No real work for ${d} days`))))
          : h('p', { class: 'muted small' }, 'Nothing stuck. 👍')),

      h('section', { class: 'dash-card' }, h('h3', null, 'People to contact'),
        chase.length ? h('ul', { class: 'dash-list' }, chase.map(({ person, st: s }) => h('li', { key: 'pc-' + person.id },
          h('span', { class: 'avatar' }, initials(person.name)),
          h('button', { class: 'link', onClick: () => ctx.openPerson(person.id) }, person.name),
          h('span', { class: 'muted small' }, s.waiting ? `waiting ${s.maxWait} day${s.maxWait === 1 ? '' : 's'}` : 'date passed'))))
          : h('p', { class: 'muted small' }, 'Nobody to chase right now.'))));
}
