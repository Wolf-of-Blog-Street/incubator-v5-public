import {
  state,
  dom,
  isDocClosed,
  isDocOpen,
  getDocColor,
  getDocCodename,
  getDocSubState,
  getTrackIcon,
  showToast
} from '../store/state.js';
import { createCardHtml } from './cards.js';
import { escapeHtml, renderMarkdown } from '../utils/markdown.js';

export function renderDocs() {
  const windowScrollY = window.scrollY || document.documentElement.scrollTop;
  const docs = state.docs || [];
  const totalCount = docs.length;
  const closedCount = docs.filter(isDocClosed).length;
  const openCount = totalCount - closedCount;

  if (dom.countDocsAll) dom.countDocsAll.textContent = totalCount;
  if (dom.countDocsOpenTab) dom.countDocsOpenTab.textContent = openCount;
  if (dom.countDocsClosedTab) dom.countDocsClosedTab.textContent = closedCount;
  if (dom.countDocsActive) dom.countDocsActive.textContent = openCount;
  if (dom.countDocsFinished) dom.countDocsFinished.textContent = closedCount;

  const catalogFilter = state.activeDocsFilter || 'open';
  const subFilter = state.activeDocsCatalogSubFilter || 'all';

  if (dom.docsCatalogSubfilters) {
    dom.docsCatalogSubfilters.classList.toggle('is-hidden', catalogFilter !== 'open');
  }

  if (dom.docsFilterTabs) {
    dom.docsFilterTabs.querySelectorAll('.docs-filter-tab').forEach(t => {
      const match = t.dataset.filter === catalogFilter;
      t.classList.toggle('active', match);
    });
  }

  let displayDocs = docs;
  if (catalogFilter === 'open' || catalogFilter === 'active') {
    displayDocs = docs.filter(isDocOpen);
    if (subFilter !== 'all') {
      displayDocs = displayDocs.filter(d => {
        const sub = getDocSubState(d.slug);
        if (subFilter === 'todo') return sub.hasToDo;
        if (subFilter === 'in-progress') return sub.hasInProgress;
        if (subFilter === 'finished') return sub.allFinished;
        return true;
      });
    }
  } else if (catalogFilter === 'closed' || catalogFilter === 'finished') {
    displayDocs = docs.filter(isDocClosed);
  }

  if (displayDocs.length === 0) {
    const filterMsg = (catalogFilter === 'closed' || catalogFilter === 'finished')
      ? 'No closed design documents found.'
      : (catalogFilter === 'open' || catalogFilter === 'active')
      ? (subFilter !== 'all' ? `No open design documents found matching sub-filter "${subFilter}".` : 'No open design documents found.')
      : 'No design documents found.';
    dom.docsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 3rem; text-align: center; color: var(--text-muted);">
        <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">${filterMsg}</p>
        <p style="font-size: 0.85rem;">All design documents are authored in <code>workspaces/*-docs/design/&lt;slug&gt;.md</code>.</p>
      </div>
    `;
    if (windowScrollY > 0) window.scrollTo({ top: windowScrollY, behavior: 'instant' });
    return;
  }

  dom.docsGrid.innerHTML = displayDocs.map(doc => {
    const stats = doc.taskStats || { total: 0, done: 0, openBugs: 0, progress: 0 };
    const bugPill = stats.openBugs > 0 ? `<span class="pill pill-track-bug">${stats.openBugs} open bug${stats.openBugs === 1 ? '' : 's'}</span>` : '';
    const isFinished = isDocClosed(doc);
    const docColor = getDocColor(doc);
    const docCodename = getDocCodename(doc);
    const subState = getDocSubState(doc.slug);
    const isActive = subState.hasInProgress || subState.hasToDo;

    const executionBadge = isFinished
      ? '<span class="badge-substate badge-doc-closed">Closed</span>'
      : subState.hasInProgress ? '<span class="badge-substate badge-substate-progress">Active · in progress</span>'
      : subState.hasToDo ? '<span class="badge-substate badge-substate-todo">Active · to do</span>'
      : '<span class="badge-substate badge-substate-finished">Inactive · all done</span>';

    const cardLifecycleBtn = isFinished
      ? `<button type="button" class="btn btn-secondary btn-sm btn-doc-lifecycle" data-action="card-open-doc" data-slug="${escapeHtml(doc.slug)}">Reopen</button>`
      : `<button type="button" class="btn btn-secondary btn-sm btn-doc-lifecycle" data-action="card-close-doc" data-slug="${escapeHtml(doc.slug)}">Close</button>`;

    return `
      <article class="doc-card ${isFinished ? 'is-finished' : ''}" data-slug="${doc.slug}" style="border-top: 3px solid ${docColor.accent};">
        <div class="doc-card-top">
          <div class="doc-icon-slug">
            <span class="doc-codename-badge" style="background: ${docColor.bg}; color: ${docColor.accent}; border: 1px solid ${docColor.border};">${escapeHtml(docCodename)}</span>
            <span class="doc-slug">${escapeHtml(doc.slug)}</span>
            ${executionBadge}
          </div>
          ${cardLifecycleBtn}
        </div>

        <h3 class="doc-title">${escapeHtml(doc.title)}</h3>

        <div class="doc-meta-row">
          <span>${escapeHtml(doc.author || 'manager-pm')}</span>
          ${doc.lastUpdated ? `<span class="doc-meta-date">${escapeHtml(doc.lastUpdated)}</span>` : ''}
          ${bugPill}
        </div>

        <div class="doc-progress-section">
          <div class="doc-progress-stats">
            <span style="font-weight: 600; color: var(--text-primary);">${stats.done}/${stats.total} jobs complete</span>
            <span style="font-family: var(--font-mono); color: ${isFinished ? 'var(--accent-emerald)' : docColor.accent}; font-weight: 700;">${stats.progress}%</span>
          </div>
          <div class="doc-progress-bar-wrap">
            <div class="doc-progress-bar" style="width: ${stats.progress}%; background: ${isFinished ? 'linear-gradient(90deg, #10b981, #34d399)' : docColor.accent};"></div>
          </div>
        </div>
      </article>
    `;
  }).join('');

  if (windowScrollY > 0) {
    window.scrollTo({ top: windowScrollY, behavior: 'instant' });
  }
}

export async function openDocReader(slug) {
  try {
    const agent = state.activeAgentId || '';
    const project = state.activeProjectId || '';
    const params = new URLSearchParams();
    if (project) params.set('project', project);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const endpoint = agent
      ? `/api/v1/agents/${encodeURIComponent(agent)}/docs/${encodeURIComponent(slug)}${qs}`
      : `/api/v1/docs/${encodeURIComponent(slug)}${qs}`;
    const res = await fetch(endpoint).then(r => r.ok ? r : fetch(`/api/docs/${encodeURIComponent(slug)}${qs}`));
    if (!res.ok) throw new Error(`Document "${slug}" not found`);

    const data = await res.json();
    const doc = data.doc;
    state.activeDoc = doc;

    const isClosed = isDocClosed(doc);
    const docColor = getDocColor(doc);
    const docCodename = getDocCodename(doc);
    dom.readerTitle.innerHTML = `<span class="doc-codename-badge" style="background: ${docColor.bg}; color: ${docColor.accent}; border: 1px solid ${docColor.border}; margin-right: 0.5rem;">${escapeHtml(docCodename)}</span>${escapeHtml(doc.title || doc.slug)}`;
    dom.readerStatusPill.textContent = isClosed ? '🏁 Closed' : '🟢 Open';
    dom.readerStatusPill.className = `pill ${isClosed ? 'pill-finished' : 'pill-track-core'}`;
    dom.readerAuthor.textContent = doc.author ? `by ${doc.author}` : '';

    if (dom.readerFinishDocBtn) {
      dom.readerFinishDocBtn.style.display = isClosed ? 'none' : 'inline-flex';
      dom.readerFinishDocBtn.dataset.slug = doc.slug;
    }
    if (dom.readerReopenDocBtn) {
      dom.readerReopenDocBtn.style.display = isClosed ? 'inline-flex' : 'none';
      dom.readerReopenDocBtn.dataset.slug = doc.slug;
    }
    if (dom.readerAddTaskBtn) {
      dom.readerAddTaskBtn.style.display = isClosed ? 'none' : 'inline-flex';
    }

    dom.readerProse.innerHTML = renderMarkdown(doc.content);

    const tasks = doc.tasks || [];
    dom.readerTaskCount.textContent = tasks.length;
    dom.readerTaskList.innerHTML = tasks.length > 0
      ? tasks.map(createCardHtml).join('')
      : '<div class="col-empty">No jobs on this doc yet</div>';

    dom.docReaderDrawer.classList.add('open');
    dom.docReaderDrawer.setAttribute('aria-hidden', 'false');
  } catch (err) {
    showToast(`Error opening design doc: ${err.message}`, 'error');
  }
}

export function closeDocReader() {
  if (dom.docReaderDrawer) {
    dom.docReaderDrawer.classList.remove('open');
    dom.docReaderDrawer.setAttribute('aria-hidden', 'true');
  }
}
