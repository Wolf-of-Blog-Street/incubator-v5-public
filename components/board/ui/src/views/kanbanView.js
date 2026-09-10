import { state, dom, getDocCodename } from '../store/state.js';
import { escapeHtml } from '../utils/markdown.js';
import { createCardHtml } from './cards.js';
import { isDoneCollapsed, latestFirst } from './swimlanesView.js';

const DONE_PREVIEW = 5;

function fill(el, list, hint) {
  if (!el) return;
  el.innerHTML = list.length ? list.map(createCardHtml).join('') : `<div class="col-empty">${hint}</div>`;
}

export function renderKanban(tasks) {
  const todo = tasks.filter(t => t.status === 'todo' || t.status === 'planned');
  const inProgress = tasks.filter(t => t.status === 'in-progress');
  const review = tasks.filter(t => t.status === 'review');
  const done = latestFirst(tasks.filter(t => t.status === 'done'));

  if (dom.countTodo) dom.countTodo.textContent = todo.length;
  if (dom.countInProgress) dom.countInProgress.textContent = inProgress.length;
  if (dom.countReview) dom.countReview.textContent = review.length;
  if (dom.countDone) dom.countDone.textContent = done.length;

  const windowScrollY = window.scrollY || document.documentElement.scrollTop;

  const docFiltered = state.activeDocFilter !== 'all' && state.activeDocFilter !== 'standalone';
  if (todo.length === 0 && docFiltered) {
    const slug = state.activeDocFilter;
    const doc = (state.docs || []).find(d => d.slug === slug);
    const label = `${getDocCodename(slug)} ${doc?.title || slug}`;
    if (dom.listTodo) dom.listTodo.innerHTML = `
      <div class="col-empty">No to-do tasks for ${escapeHtml(label)}
        <button type="button" class="btn btn-secondary btn-sm" data-action="cut-task-for-doc" data-slug="${escapeHtml(slug)}">+ Add task</button>
      </div>`;
  } else {
    fill(dom.listTodo, todo, 'No to-do tasks');
  }
  fill(dom.listInProgress, inProgress, 'Nothing in progress');
  fill(dom.listReview, review, 'Nothing in review');

  if (dom.listDone) {
    const collapsed = isDoneCollapsed('kanban');
    const shown = collapsed ? done.slice(0, DONE_PREVIEW) : done;
    const hidden = done.length - shown.length;
    dom.listDone.innerHTML = (shown.length ? shown.map(createCardHtml).join('') : '<div class="col-empty">Nothing done yet</div>')
      + (done.length > DONE_PREVIEW ? `<button type="button" class="btn-show-more" data-action="toggle-done-col" data-slug="kanban">${collapsed ? `Show all ${done.length} done` : 'Show fewer'}</button>` : '');
  }

  if (windowScrollY > 0) window.scrollTo({ top: windowScrollY, behavior: 'instant' });
}
