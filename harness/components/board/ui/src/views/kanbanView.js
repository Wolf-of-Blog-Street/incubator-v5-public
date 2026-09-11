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
      <div class="col-empty">No to-do jobs for ${escapeHtml(label)}
        <button type="button" class="btn btn-secondary btn-sm" data-action="cut-task-for-doc" data-slug="${escapeHtml(slug)}">+ Add job</button>
      </div>`;
  } else {
    fill(dom.listTodo, todo, 'No to-do jobs');
  }
  fill(dom.listInProgress, inProgress, 'Nothing in progress');
  fill(dom.listReview, review, 'Nothing in review');

  const showDone = !state.collapseDone;
  const colDone = dom.colDone || document.getElementById('col-done');
  const kanbanContainer = document.querySelector('.kanban-container');

  if (colDone) {
    colDone.style.display = showDone ? '' : 'none';
  }
  if (kanbanContainer) {
    kanbanContainer.classList.toggle('has-done', showDone);
  }

  if (showDone && dom.listDone) {
    fill(dom.listDone, done, 'Nothing done yet');
  }

  if (windowScrollY > 0) window.scrollTo({ top: windowScrollY, behavior: 'instant' });
}
