import { getDocColor, getDocCodename } from '../store/state.js';
import { escapeHtml } from '../utils/markdown.js';

const ACTIONS = {
  todo: ['start', 'Start'], planned: ['start', 'Start'],
  'in-progress': ['review', 'Review'], review: ['done', 'Done'], done: ['reopen', 'Reopen'],
};

export function createCardHtml(task) {
  const [action, label] = ACTIONS[task.status] || ACTIONS.done;

  let planPill = '';
  if (typeof task.details === 'string' && task.details.trim()) {
    const boxes = task.details.match(/^[-*]\s+\[[ xX]\]/gm) || [];
    const checked = boxes.filter(b => /[xX]/.test(b)).length;
    planPill = `<button type="button" class="card-plan-pill" data-action="view-plan" data-id="${task.id}" title="Plan">${boxes.length ? `${checked}/${boxes.length}` : 'Plan'}</button>`;
  }

  let docPill = '';
  if (task.design_slug) {
    const c = getDocColor(task.design_slug);
    docPill = `<button type="button" class="card-doc-pill" data-action="read-doc" data-slug="${escapeHtml(task.design_slug)}" style="--doc-accent: ${c.accent}; --doc-border: ${c.border};" title="Read design doc">${escapeHtml(getDocCodename(task.design_slug))}</button>`;
  }

  return `
    <article class="task-card ${task.track === 'bug' ? 'is-bug' : ''}" data-id="${task.id}" tabindex="0">
      <div class="card-meta">
        <span class="card-id">#${task.id}</span>
        <span class="card-track">${escapeHtml(task.track)}</span>
        ${docPill}${planPill}
        <button type="button" class="btn-card-action" data-action="${action}" data-id="${task.id}">${label}</button>
      </div>
      <h3 class="card-title">${escapeHtml(task.title)}</h3>
    </article>`;
}
