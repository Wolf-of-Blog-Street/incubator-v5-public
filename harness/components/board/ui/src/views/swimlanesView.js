import {
  state,
  dom,
  isDocClosed,
  getDocColor,
  getDocCodename,
  getDocSubState,
  setStoredPref,
  STORAGE_KEYS
} from '../store/state.js';
import { getDocLookupMap } from '../store/selectors.js';
import { escapeHtml } from '../utils/markdown.js';
import { createCardHtml } from './cards.js';

const DONE_PREVIEW = 3;

/** Newest first: highest id first. */
export function latestFirst(tasks) {
  return [...tasks].sort((a, b) => Number(b.id) - Number(a.id));
}

export function isDoneCollapsed(slug) {
  return state.collapseDone;
}

export function toggleDoneCol(slug, onRender) {
  toggleAllDone(onRender);
}

export function toggleAllDone(onRender) {
  state.collapseDone = !state.collapseDone;
  setStoredPref(STORAGE_KEYS.COLLAPSE_DONE, state.collapseDone ? 'true' : 'false');
  state.collapsedDoneOverrides = {};
  updateDoneToggleButton();
  if (typeof onRender === 'function') onRender();
}

export function updateDoneToggleButton() {
  if (dom.btnToggleDoneText && dom.btnToggleDoneIcon) {
    if (state.collapseDone) {
      dom.btnToggleDoneText.textContent = 'Show done';
      dom.btnToggleDoneIcon.textContent = '▾';
    } else {
      dom.btnToggleDoneText.textContent = 'Hide done';
      dom.btnToggleDoneIcon.textContent = '▴';
    }
  }
}

/**
 * Keeps the Toggle All label naming the action the lanes will take.
 */
export function updateToggleAllLabel() {
  if (!dom.btnToggleAllSwimlanes || !dom.swimlanesList) return;
  const allCollapsed = !!dom.swimlanesList.querySelector('.doc-swimlane')
    && !dom.swimlanesList.querySelector('.doc-swimlane:not(.is-collapsed)');
  dom.btnToggleAllSwimlanes.textContent = allCollapsed ? 'Expand all' : 'Collapse all';
}

/**
 * Renders the header for a design doc swimlane.
 */
export function createDocSwimlaneHeaderHtml({
  slug,
  title,
  isClosed,
  docColor,
  docCodename,
  subBadgesHtml,
  openBugs,
  progressPct,
  doneCount,
  totalCount
}) {
  return `
    <div class="swimlane-header">
      <div class="swimlane-header-left">
        <button type="button" class="swimlane-toggle-btn" data-action="toggle-swimlane-collapse" title="Collapse or expand" aria-label="Collapse or expand lane">▾</button>
        <span class="doc-codename-badge" style="background: ${docColor.bg}; color: ${docColor.accent}; border: 1px solid ${docColor.border};">${escapeHtml(docCodename)}</span>
        <h3 class="swimlane-title">${escapeHtml(title)}</h3>
        ${subBadgesHtml.join(' ')}
        ${openBugs > 0 ? `<span class="swimlane-bug-pill">${openBugs} bug${openBugs === 1 ? '' : 's'}</span>` : ''}
      </div>
      <div class="swimlane-header-right">
        <div class="swimlane-progress-wrap" title="${doneCount}/${totalCount} done">
          <div class="swimlane-progress-bar" style="width: ${progressPct}%;"></div>
        </div>
        <span class="swimlane-progress-text">${doneCount}/${totalCount} done</span>
        ${!isClosed ? `<button class="btn btn-secondary btn-sm" data-action="cut-task-for-doc" data-slug="${escapeHtml(slug)}">+ Add job</button>` : ''}
        <button class="btn btn-secondary btn-sm" data-action="read-doc" data-slug="${escapeHtml(slug)}">Read doc</button>
        ${isClosed
          ? `<button class="btn btn-secondary btn-sm" data-action="open-doc" data-slug="${escapeHtml(slug)}">Reopen doc</button>`
          : `<button class="btn btn-secondary btn-sm" data-action="close-doc" data-slug="${escapeHtml(slug)}">Finish doc</button>`}
      </div>
    </div>
  `;
}

/**
 * Renders the 4-column kanban board layout for a swimlane (TO-DO, IN PROGRESS, IN REVIEW, DONE).
 */
export function createSwimlaneColumnsHtml({ slug, todo, inProgress, review, done }) {
  const col = (status, label, list, hint) => `
    <div class="swimlane-col" data-col-status="${status}">
      <div class="swimlane-col-header"><span class="swimlane-col-title">${label}</span><span class="col-count">${list.length}</span></div>
      <div class="swimlane-card-list">${list.length ? list.map(createCardHtml).join('') : `<div class="col-empty">${hint}</div>`}</div>
    </div>`;

  const showDone = !state.collapseDone;
  const doneColHtml = showDone ? `
    <div class="swimlane-col" data-col-status="done">
      <div class="swimlane-col-header"><span class="swimlane-col-title">Done</span><span class="col-count">${done.length}</span></div>
      <div class="swimlane-card-list">${done.length ? latestFirst(done).map(createCardHtml).join('') : '<div class="col-empty">Nothing done yet</div>'}</div>
    </div>` : '';

  return `
    <div class="swimlane-columns ${showDone ? 'has-done' : ''}">
      ${col('todo', 'To-do', todo, 'No to-do tasks')}
      ${col('in-progress', 'In progress', inProgress, 'Nothing in progress')}
      ${col('review', 'In review', review, 'Nothing in review')}
      ${doneColHtml}
    </div>
  `;
}

/**
 * Builds the complete HTML for an attached design doc swimlane.
 */
export function createDocSwimlaneHtml({ slug, docMeta, allDocTasks, filteredDocTasks }) {
  const title = docMeta?.title || slug;
  const isClosed = isDocClosed(slug);
  const docColor = getDocColor(slug);
  const docCodename = getDocCodename(slug);
  const subState = getDocSubState(slug);

  const totalCount = allDocTasks.length;
  const doneCount = allDocTasks.filter(t => t.status === 'done').length;
  const openBugs = allDocTasks.filter(t => t.track === 'bug' && t.status !== 'done').length;
  const progressPct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

  const todo = filteredDocTasks.filter(t => t.status === 'todo' || t.status === 'planned');
  const inProgress = filteredDocTasks.filter(t => t.status === 'in-progress');
  const review = filteredDocTasks.filter(t => t.status === 'review');
  const done = filteredDocTasks.filter(t => t.status === 'done');

  const isDoneColCollapsed = isDoneCollapsed(slug);

  const subBadgesHtml = [];
  if (!isClosed) {
    if (subState.hasInProgress) {
      subBadgesHtml.push('<span class="badge-substate badge-substate-progress">Active · in progress</span>');
    } else if (subState.hasToDo) {
      subBadgesHtml.push('<span class="badge-substate badge-substate-todo">Active · to do</span>');
    } else {
      subBadgesHtml.push('<span class="badge-substate badge-substate-finished">Inactive · all done</span>');
    }
  } else {
    subBadgesHtml.push('<span class="badge-substate badge-doc-closed">Closed</span>');
  }

  const headerHtml = createDocSwimlaneHeaderHtml({
    slug,
    title,
    isClosed,
    docColor,
    docCodename,
    subBadgesHtml,
    openBugs,
    progressPct,
    doneCount,
    totalCount
  });

  const columnsHtml = createSwimlaneColumnsHtml({
    slug,
    todo,
    inProgress,
    review,
    done
  });

  return `
    <div class="doc-swimlane ${isClosed ? 'is-closed' : ''}" data-slug="${escapeHtml(slug)}">
      ${headerHtml}
      ${columnsHtml}
    </div>
  `;
}

/**
 * Builds the complete HTML for the standalone / ad-hoc tasks swimlane.
 */
export function createStandaloneSwimlaneHtml(standaloneTasks = []) {
  const sTodo = standaloneTasks.filter(t => t.status === 'todo' || t.status === 'planned');
  const sInProgress = standaloneTasks.filter(t => t.status === 'in-progress');
  const sReview = standaloneTasks.filter(t => t.status === 'review');
  const sDone = standaloneTasks.filter(t => t.status === 'done');
  const sBugs = standaloneTasks.filter(t => t.track === 'bug' && t.status !== 'done').length;

  const columnsHtml = createSwimlaneColumnsHtml({
    slug: 'standalone',
    todo: sTodo,
    inProgress: sInProgress,
    review: sReview,
    done: sDone
  });

  return `
    <div class="doc-swimlane standalone-swimlane" data-slug="standalone">
      <div class="swimlane-header">
        <div class="swimlane-header-left">
          <button type="button" class="swimlane-toggle-btn" data-action="toggle-swimlane-collapse" title="Collapse or expand" aria-label="Collapse or expand lane">▾</button>
          <h3 class="swimlane-title">Standalone jobs</h3>
          ${sBugs > 0 ? `<span class="swimlane-bug-pill">${sBugs} bug${sBugs === 1 ? '' : 's'}</span>` : ''}
        </div>
        <div class="swimlane-header-right">
          <span class="swimlane-progress-text">${sDone.length}/${standaloneTasks.length} done</span>
          <button class="btn btn-secondary btn-sm" data-action="cut-standalone-task">+ Add job</button>
        </div>
      </div>
      ${columnsHtml}
    </div>
  `;
}

/**
 * Main renderer for the Swimlanes view.
 */
export function renderSwimlanes(tasks) {
  if (!dom.swimlanesList) return;

  // 0. Snapshot collapsed lanes and window scroll before the rebuild
  const collapsedSlugs = new Set([...dom.swimlanesList.querySelectorAll('.doc-swimlane.is-collapsed')].map(el => el.dataset.slug));
  const windowScrollY = window.scrollY || document.documentElement.scrollTop;

  // 1. Collect design doc slugs: every doc under the lifecycle, or just the picked doc
  const allDocs = state.docs || [];
  const docSlugs = new Set();
  const lifecycle = state.activeDocLifecycleFilter || 'open';
  const wanted = slug => state.activeDocFilter === 'all'
    ? (lifecycle === 'all' || !isDocClosed(slug))
    : state.activeDocFilter === slug;

  allDocs.forEach(d => { if (wanted(d.slug)) docSlugs.add(d.slug); });
  (state.tasks || []).forEach(t => {
    if (t.design_slug && t.design_slug.trim() && t.design_slug.toLowerCase() !== 'standalone' && wanted(t.design_slug.trim())) {
      docSlugs.add(t.design_slug.trim());
    }
  });

  const swimlanesHtml = [];
  const docMap = getDocLookupMap(state.docs);

  // 2. Render each Design Doc Swimlane
  for (const slug of docSlugs) {
    const docMeta = docMap.get(slug);
    const allDocTasks = state.tasks.filter(t => t.design_slug === slug);
    const filteredDocTasks = tasks.filter(t => t.design_slug === slug);

    swimlanesHtml.push(createDocSwimlaneHtml({
      slug,
      docMeta,
      allDocTasks,
      filteredDocTasks
    }));
  }

  // 3. Render Standalone Jobs section if present
  const standaloneTasks = tasks.filter(t => !t.design_slug || !t.design_slug.trim() || t.design_slug.toLowerCase() === 'standalone');
  if (standaloneTasks.length > 0 && (state.activeDocFilter === 'all' || state.activeDocFilter === 'standalone')) {
    swimlanesHtml.push(createStandaloneSwimlaneHtml(standaloneTasks));
  }

  dom.swimlanesList.innerHTML = swimlanesHtml.length
    ? swimlanesHtml.join('')
    : '<div class="col-empty board-empty">No jobs on this board yet. Press N to add one.</div>';

  // 4. Restore collapsed lanes and window scroll
  collapsedSlugs.forEach(slug => dom.swimlanesList.querySelector(`.doc-swimlane[data-slug="${CSS.escape(slug)}"]`)?.classList.add('is-collapsed'));
  if (windowScrollY > 0) window.scrollTo({ top: windowScrollY, behavior: 'instant' });

  // 5. Keep the Toggle All label naming the action the lanes will take
  updateToggleAllLabel();
}
