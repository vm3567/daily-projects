// Stage: a small label on every task — ⚪ Not started, 🔵 In progress, 🟠 Waiting: <for whom>, ✅ Done.
// It is separate from the dot (the dot keeps meaning "worked on recently"). The rules are in rules.js (stageOf);
// here: the chip, the chooser on a task's page (with "Waiting for whom?") and the filter chips over a list.
// Used by the owner's pages and by the staff and team pages (their stage comes from logic.js teamStage).

import { h, fmtDay } from './dom.js';
import { STAGES, STAGE_LABELS, stageText, stageOf, WAIT_PICKS, WAITING_MAX, isMainProject } from '../rules.js';

export const STAGE_FILTERS = [['all', 'All'], ['notstarted', 'Not started'], ['inprogress', 'In progress'], ['waiting', 'Waiting'], ['done', 'Done']];

/** The chip: colours by class (stage-notstarted grey, stage-inprogress blue, stage-waiting amber, stage-done green). */
export function stageChip(info, { you = false, onClick = null, key = null } = {}) {
  const stage = info && STAGES.includes(info.stage) ? info.stage : 'notstarted';
  const text = stageText({ ...info, stage }, { you });
  const since = stage === 'waiting' && info.since ? `Waiting since ${fmtDay(info.since)}` : '';
  const title = [since, info && info.auto ? 'Stage (worked out by itself)' : 'Stage'].filter(Boolean).join(' · ');
  const cls = 'stage-chip stage-' + stage;
  return onClick
    ? h('button', { class: cls + ' tap', type: 'button', key, title: title + ' — tap to change', 'aria-label': `${text} — tap to change the stage`, onClick }, text)
    : h('span', { class: cls, key, title }, text);
}

/** Filter chips: All N | Not started N | In progress N | Waiting N | Done N (+ extra [key, label, count]). */
export function stageFilterBar(counts, current, onPick, extra = []) {
  const on = current || 'all';
  const btn = (k, label, n) => h('button', {
    class: 'stage-filter' + (k === 'all' ? '' : ' stage-' + k) + (on === k ? ' on' : ''), type: 'button', key: 'sf-' + k, 'aria-pressed': String(on === k),
    onClick: () => onPick(k),
  }, `${label} ${n}`);
  return h('div', { class: 'stage-filters', role: 'group', 'aria-label': 'Filter by stage', key: 'stage-filters' },
    STAGE_FILTERS.map(([k, label]) => btn(k, label, counts[k] || 0)),
    extra.map(([k, label, n]) => btn(k, label, n)));
}

/** A task's stage (the owner's tasks): a given task asks the team's progress (stuck → waiting). */
export function ownerStage(ctx, p) {
  const team = p && p.team && ctx.teamProgress ? ctx.teamProgress(p.id) : null;
  return stageOf(p, team);
}

/**
 * On a task's page, near the top: the chip; tapped, the 4 stages; Waiting asks "Waiting for whom?" (a short box with
 * quick picks: Approval, Management, Info and the people's names). No pop-up box: it is all on the page.
 */
export function stageLine(ctx, p) {
  const { ui, store } = ctx;
  if (!p || isMainProject(store.view.data, p)) return null; // (a 📂 project has its tasks' stages)
  const info = ownerStage(ctx, p);
  const open = ui.stageOpen === p.id;
  const canEdit = !store.canEdit || store.canEdit();
  const set = (stage, waitingFor = '') => {
    store.dispatch('setStage', { projectId: p.id, stage, ...(stage === 'waiting' ? { waitingFor } : {}) });
    ui.stageOpen = null; ui.stageWait = null; ctx.render();
  };
  const pick = (s) => {
    if (s !== 'waiting') { set(s); return; }
    ui.stageWait = { text: info.stage === 'waiting' ? info.waitingFor || '' : '' };
    ctx.render();
    setTimeout(() => { const el = typeof document !== 'undefined' && document.querySelector && document.querySelector(`[data-key="stage-wait-${p.id}"]`); if (el && el.focus) el.focus(); }, 30);
  };
  const people = ((store.view.data.people || []).map((x) => x.name)).filter(Boolean).slice(0, 8);
  const w = ui.stageWait;
  return h('div', { class: 'stage-line', key: 'stage-' + p.id },
    stageChip(info, { onClick: canEdit ? () => { ui.stageOpen = open ? null : p.id; ui.stageWait = null; ctx.render(); } : null, key: 'stage-chip-' + p.id }),
    open ? h('div', { class: 'stage-chooser', role: 'group', 'aria-label': 'Choose the stage', key: 'stage-chooser-' + p.id },
      h('div', { class: 'stage-opts' }, STAGES.map((s) => h('button', {
        class: 'stage-chip stage-' + s + ' tap' + (info.stage === s ? ' on' : ''), type: 'button', key: 'so-' + s, 'aria-pressed': String(info.stage === s), onClick: () => pick(s),
      }, STAGE_LABELS[s])),
      info.auto ? null : h('button', { class: 'link small', type: 'button', key: 'so-auto', title: 'Let the app work out the stage again', onClick: () => set(null) }, 'Automatic')),
      w ? h('form', {
        class: 'stage-wait', key: 'stage-wait-form-' + p.id,
        onSubmit: (e) => { e.preventDefault(); set('waiting', w.text); },
      },
      h('label', { class: 'small' }, 'Waiting for whom?'),
      h('div', { class: 'row' },
        h('input', { key: 'stage-wait-' + p.id, value: w.text, maxlength: String(WAITING_MAX), placeholder: 'Who or what (optional)', autocomplete: 'off', 'aria-label': 'Waiting for whom?',
          onInput: (e, el) => { w.text = el.value; } }),
        h('button', { class: 'btn primary small', type: 'submit' }, 'Save'),
        h('button', { class: 'btn small', type: 'button', onClick: () => { ui.stageWait = null; ctx.render(); } }, 'Cancel')),
      h('div', { class: 'stage-picks' }, [...WAIT_PICKS, ...people].map((n) => h('button', { class: 'chip', type: 'button', key: 'wp-' + n, onClick: () => set('waiting', n) }, n)))) : null) : null);
}
