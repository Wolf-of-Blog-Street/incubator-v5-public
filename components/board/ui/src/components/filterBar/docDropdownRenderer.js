import {
  state,
  dom,
  getDocColor,
  getDocCodename,
  isDocClosed
} from '../../store/state.js';
import { escapeHtml } from '../../utils/markdown.js';

/**
 * Renders the Doc filter dropdown: lifecycle rows ("All open docs" / "All docs"),
 * every open doc, standalone, every closed doc, unlinked slugs; sets the trigger label.
 */
export function renderDocFilters(filteredTasks) {
  const docs = state.docs ?? [];
  const tasks = state.tasks ?? [];
  const lifecycle = state.activeDocLifecycleFilter || 'open';
  const activeDoc = state.activeDocFilter || 'all';
  const isStandalone = t => !t.design_slug || !t.design_slug.trim() || t.design_slug.toLowerCase() === 'standalone';

  const openDocs = docs.filter(d => !isDocClosed(d));
  const closedDocs = docs.filter(isDocClosed);
  const orphanSlugs = [...new Set(
    tasks.filter(t => !isStandalone(t) && !docs.some(d => d.slug === t.design_slug.trim())).map(t => t.design_slug.trim())
  )];
  const openTaskCount = tasks.filter(t => isStandalone(t) || !isDocClosed(t.design_slug)).length;
  const standaloneTasks = tasks.filter(isStandalone);
  const openCount = slug => tasks.filter(t => t.design_slug === slug && t.status !== 'done').length;

  const item = (value, labelHtml, count, o = {}) => `
    <button type="button" class="dropdown-item${o.selected ? ' is-selected' : ''}" data-value="${escapeHtml(value)}"${o.lifecycle ? ` data-lifecycle="${o.lifecycle}"` : ''}>
      <div class="dropdown-item-left"><span class="dropdown-item-check">✓</span>${labelHtml}</div>
      <span class="dropdown-item-count">${count}</span>
    </button>`;
  const docItem = d => {
    const c = getDocColor(d.slug);
    return item(
      d.slug,
      `<span class="filter-codename" style="color:${c.accent};border:1px solid ${c.border}">${escapeHtml(getDocCodename(d.slug))}</span><span>${escapeHtml(d.title || d.slug)}</span>`,
      openCount(d.slug),
      { selected: activeDoc === d.slug }
    );
  };
  const section = t => `<div class="dropdown-section">${t}</div>`;

  let html = item('all', '<span>All open docs</span>', openTaskCount, { lifecycle: 'open', selected: activeDoc === 'all' && lifecycle === 'open' })
    + item('all', '<span>All docs</span>', tasks.length, { lifecycle: 'all', selected: activeDoc === 'all' && lifecycle === 'all' });
  if (openDocs.length) html += section('Open') + openDocs.map(docItem).join('');
  if (standaloneTasks.length) html += item('standalone', '<span>Standalone tasks</span>', standaloneTasks.filter(t => t.status !== 'done').length, { selected: activeDoc === 'standalone' });
  if (closedDocs.length) html += section('Closed') + closedDocs.map(docItem).join('');
  if (orphanSlugs.length) html += section('Unlinked') + orphanSlugs.map(s => item(s, `<span class="filter-codename">#task</span><span>${escapeHtml(s)}</span>`, openCount(s), { selected: activeDoc === s })).join('');

  let label = lifecycle === 'open' ? `All open docs (${openTaskCount})` : `All docs (${tasks.length})`;
  if (activeDoc === 'standalone') {
    label = `Standalone (${standaloneTasks.length})`;
  } else if (activeDoc !== 'all') {
    const d = docs.find(x => x.slug === activeDoc);
    label = `${getDocCodename(activeDoc)} ${d ? d.title : activeDoc} (${openCount(activeDoc)} open)`;
  }
  if (dom.docDropdownLabel) {
    dom.docDropdownLabel.textContent = label;
    dom.docDropdownLabel.title = label;
  }
  dom.docDropdownTrigger?.classList.toggle('has-filter', activeDoc !== 'all');
  if (dom.docDropdownMenu) dom.docDropdownMenu.innerHTML = html;

}
