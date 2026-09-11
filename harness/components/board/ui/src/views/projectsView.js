import { state, dom, showToast } from '../store/state.js';
import { escapeHtml } from '../utils/markdown.js';
import { createProject, deleteProject, scanProjects } from '../api/client.js';

/**
 * Renders the Projects Catalog & Live Checkout Inventory View.
 */
export function renderProjects() {
  if (!dom.projectsGrid || !dom.projectsSummaryStrip) return;

  const windowScrollY = window.scrollY || document.documentElement.scrollTop;
  const projects = state.projectsCatalog || [];
  const stats = state.projectsStats || {
    totalProjects: projects.length,
    checkedOutProjects: projects.filter(p => p.isCheckedOut).length,
    unassignedProjects: projects.filter(p => !p.isCheckedOut).length,
    activeAgentSeats: state.roster?.length || 0
  };

  // 1. Render Summary Metric Cards
  dom.projectsSummaryStrip.innerHTML = `
    <div class="projects-stat-card">
      <span class="stat-label">TOTAL REPOSITORIES</span>
      <span class="stat-val">${stats.totalProjects}</span>
    </div>
    <div class="projects-stat-card checked-out">
      <span class="stat-label">CHECKED OUT</span>
      <span class="stat-val emerald">${stats.checkedOutProjects}</span>
    </div>
    <div class="projects-stat-card unassigned">
      <span class="stat-label">UNASSIGNED</span>
      <span class="stat-val amber">${stats.unassignedProjects}</span>
    </div>
    <div class="projects-stat-card">
      <span class="stat-label">ACTIVE AGENT SEATS</span>
      <span class="stat-val">${stats.activeAgentSeats}</span>
    </div>
  `;

  // 2. Update Filter Badge Counts
  const countAll = dom.countProjAll || document.getElementById('count-proj-all');
  const countChecked = dom.countProjChecked || document.getElementById('count-proj-checked');
  const countUnassigned = dom.countProjUnassigned || document.getElementById('count-proj-unassigned');

  if (countAll) countAll.textContent = stats.totalProjects;
  if (countChecked) countChecked.textContent = stats.checkedOutProjects;
  if (countUnassigned) countUnassigned.textContent = stats.unassignedProjects;

  // 3. Filter and Search
  const filter = state.projectsFilter || 'all';
  const query = (state.projectsSearchQuery || '').toLowerCase().trim();

  let filtered = projects;
  if (filter === 'checked-out') {
    filtered = filtered.filter(p => p.isCheckedOut);
  } else if (filter === 'unassigned') {
    filtered = filtered.filter(p => !p.isCheckedOut);
  }

  if (query) {
    filtered = filtered.filter(p => {
      const matchName = (p.name || '').toLowerCase().includes(query);
      const matchUrl = (p.github_url || '').toLowerCase().includes(query);
      const matchDesc = (p.description || '').toLowerCase().includes(query);
      const matchId = (p.id || '').toLowerCase().includes(query);
      const matchTags = (p.tags || []).some(t => t.toLowerCase().includes(query));
      return matchName || matchUrl || matchDesc || matchId || matchTags;
    });
  }

  // 4. Empty State
  if (filtered.length === 0) {
    dom.projectsGrid.innerHTML = `
      <div class="projects-empty-state">
        <span class="empty-icon">📁</span>
        <h3>${query ? 'No matching projects found' : (filter === 'all' ? 'No Projects Registered in Catalog' : `No ${filter === 'checked-out' ? 'Checked Out' : 'Unassigned'} Projects`)}</h3>
        <p>${query ? 'Try a different search term or clear the filter.' : 'Add your first GitHub repository to track multi-seat checkout topology.'}</p>
        ${!query && filter === 'all' ? `<button type="button" class="btn btn-primary btn-sm" id="btn-empty-add-project">+ Add Project</button>` : ''}
      </div>
    `;
    return;
  }

  // 5. Render Project Cards
  dom.projectsGrid.innerHTML = filtered.map(proj => {
    const isChecked = Boolean(proj.isCheckedOut);
    const checkoutCount = proj.checkoutCount || (proj.checkedOutBy ? proj.checkedOutBy.length : 0);
    const tags = proj.tags || [];

    const tagsHtml = tags.map(t => `<span class="proj-tag-chip">#${escapeHtml(t)}</span>`).join('');

    let checkoutsHtml = '';
    if (isChecked && proj.checkedOutBy && proj.checkedOutBy.length > 0) {
      checkoutsHtml = `
        <div class="proj-checkouts-section">
          <span class="checkouts-header-label">ACTIVE SEAT CHECKOUTS (${checkoutCount})</span>
          <div class="proj-checkouts-list">
            ${proj.checkedOutBy.map(c => `
              <div class="proj-checkout-item">
                <div class="checkout-left">
                  <span class="checkout-agent-avatar">${escapeHtml(c.agentIcon || '🤖')}</span>
                  <div class="checkout-meta">
                    <span class="checkout-agent-name">${escapeHtml(c.agentName || c.agentId)}</span>
                    <span class="checkout-path" title="${escapeHtml(c.absolutePath || '')}">
                      <code>${escapeHtml(c.workspacePath || c.agentId)}</code>
                    </span>
                  </div>
                </div>
                <div class="checkout-right">
                  ${c.currentBranch ? `<span class="checkout-branch-pill" title="Git Branch: ${escapeHtml(c.currentBranch)}">🌿 ${escapeHtml(c.currentBranch)}</span>` : ''}
                  <button type="button" class="btn-inspect-board" data-action="inspect-project-board" data-agent-id="${escapeHtml(c.agentId)}" data-project-id="${escapeHtml(proj.id)}" title="Switch to ${escapeHtml(c.agentName || c.agentId)} Board">
                    <span>Inspect Board</span> ↗
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      checkoutsHtml = `
        <div class="proj-unassigned-notice">
          <div class="notice-icon">⚠️</div>
          <div class="notice-content">
            <span class="notice-title">Not checked out by any agent</span>
            <span class="notice-desc">No seat in the fleet has cloned this repo under its <code>workspaces/</code> directory.</span>
          </div>
        </div>
      `;
    }

    const cleanDate = proj.created_at ? new Date(proj.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

    return `
      <div class="project-card ${isChecked ? 'is-checked-out' : 'is-unassigned'}" data-project-id="${escapeHtml(proj.id)}">
        <div class="proj-card-top">
          <div class="proj-card-title-group">
            <div class="proj-name-row">
              <span class="proj-icon">📁</span>
              <h3 class="proj-title">${escapeHtml(proj.name || proj.id)}</h3>
            </div>
            <a href="${escapeHtml(proj.github_url)}" target="_blank" rel="noopener noreferrer" class="proj-github-link" title="Open repository on GitHub">
              <span>${escapeHtml(proj.github_url.replace(/^https?:\/\/github\.com\//, ''))}</span>
              <span class="external-icon">↗</span>
            </a>
          </div>
          <div class="proj-card-status">
            ${isChecked ? `
              <span class="proj-status-badge checked">
                <span class="status-pulse"></span> CHECKED OUT
              </span>
            ` : `
              <span class="proj-status-badge unassigned">
                <span class="status-dot-amber"></span> UNASSIGNED
              </span>
            `}
          </div>
        </div>

        ${proj.description ? `<p class="proj-description">${escapeHtml(proj.description)}</p>` : '<p class="proj-description empty">No description provided</p>'}

        ${tagsHtml ? `<div class="proj-tags-wrap">${tagsHtml}</div>` : ''}

        ${checkoutsHtml}

        <div class="proj-card-footer">
          <span class="proj-created-date">${cleanDate ? `Registered ${cleanDate}` : ''}</span>
          <div class="proj-footer-actions">
            <button type="button" class="btn-delete-proj" data-action="delete-project" data-project-id="${escapeHtml(proj.id)}" title="Remove project from catalog">
              <span>🗑️</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (windowScrollY > 0) {
    window.scrollTo({ top: windowScrollY, behavior: 'instant' });
  }
}

/**
 * Opens the Add Project modal dialog.
 */
export function openAddProjectModal() {
  const dialog = dom.addProjectDialog || document.getElementById('add-project-dialog');
  if (!dialog) return;

  const urlInput = document.getElementById('proj-url-input');
  const nameInput = document.getElementById('proj-name-input');
  const descInput = document.getElementById('proj-desc-input');
  const tagsInput = document.getElementById('proj-tags-input');

  if (urlInput) urlInput.value = '';
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  if (tagsInput) tagsInput.value = '';

  dialog.showModal();
  if (urlInput) urlInput.focus();
}

/**
 * Closes the Add Project modal dialog.
 */
export function closeAddProjectModal() {
  const dialog = dom.addProjectDialog || document.getElementById('add-project-dialog');
  if (dialog && dialog.open) {
    dialog.close();
  }
}

/**
 * Handles submission of the Add Project form.
 */
export async function handleAddProjectSubmit(e, onCreated) {
  e.preventDefault();

  const urlInput = document.getElementById('proj-url-input');
  const nameInput = document.getElementById('proj-name-input');
  const descInput = document.getElementById('proj-desc-input');
  const tagsInput = document.getElementById('proj-tags-input');

  const githubUrl = urlInput ? urlInput.value.trim() : '';
  if (!githubUrl) {
    showToast('GitHub URL is required', 'error');
    return;
  }

  const name = nameInput ? nameInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : '';
  const tagsRaw = tagsInput ? tagsInput.value.trim() : '';
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  const payload = {
    github_url: githubUrl,
    name: name || undefined,
    description: desc,
    tags
  };

  try {
    const res = await createProject(payload);
    closeAddProjectModal();
    showToast(`Project "${res.project.name}" registered to catalog!`, 'success');
    if (typeof onCreated === 'function') {
      onCreated();
    }
  } catch (err) {
    showToast(`Failed to register project: ${err.message}`, 'error');
  }
}

/**
 * Handles project deletion.
 */
export async function handleDeleteProject(projectId, onDeleted) {
  if (!projectId) return;
  const target = (state.projectsCatalog || []).find(p => p.id === projectId);
  const name = target?.name || projectId;

  if (!confirm(`Are you sure you want to remove "${name}" from the projects catalog?`)) {
    return;
  }

  try {
    await deleteProject(projectId);
    showToast(`Project "${name}" removed from catalog`, 'success');
    if (typeof onDeleted === 'function') {
      onDeleted();
    }
  } catch (err) {
    showToast(`Error removing project: ${err.message}`, 'error');
  }
}

/**
 * Handles force re-scan of fleet agent workspaces.
 */
export async function handleScanProjects(onScanned) {
  const btn = dom.btnRefreshProjectsScan || document.getElementById('btn-refresh-projects-scan');
  const icon = btn ? btn.querySelector('.refresh-icon') : null;
  if (icon) icon.classList.add('spinning');

  try {
    const res = await scanProjects();
    state.projectsCatalog = res.projects || [];
    state.projectsStats = res.stats || null;
    showToast(`Scan complete: ${res.stats.totalProjects} projects across ${res.stats.activeAgentSeats} agent seats`, 'success');
    if (typeof onScanned === 'function') {
      onScanned();
    }
  } catch (err) {
    showToast(`Scan error: ${err.message}`, 'error');
  } finally {
    if (icon) icon.classList.remove('spinning');
  }
}
