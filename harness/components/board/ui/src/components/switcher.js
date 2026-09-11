import { state, dom, setStoredPref, STORAGE_KEYS } from '../store/state.js';
import { escapeHtml } from '../utils/markdown.js';

/**
 * Renders the Agent Switcher dropdown menu list.
 */
export function renderAgentSwitcherMenu() {
  if (!dom.agentMenuList) return;
  dom.agentMenuList.innerHTML = (state.roster || []).map(agent => {
    const isSelected = agent.id === state.activeAgentId && state.activeView !== 'fleet';
    const total = agent.stats?.totalTasks || 0;
    const done = agent.stats?.doneTasks || 0;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return `
      <button type="button" class="agent-menu-item ${isSelected ? 'active' : ''}" data-agent-id="${escapeHtml(agent.id)}" role="menuitem">
        <span class="agent-menu-icon">${escapeHtml(agent.icon || '🤖')}</span>
        <div class="agent-menu-info">
          <span class="agent-menu-title">${escapeHtml(agent.name || agent.id)}</span>
          <span class="agent-menu-meta">${escapeHtml(agent.id)} · ${progress}% done</span>
        </div>
        ${agent.stats?.openBugs > 0 ? `<span class="agent-menu-badge has-bugs">${agent.stats.openBugs} bugs</span>` : ''}
      </button>
    `;
  }).join('');
}

/**
 * Renders the Project Switcher dropdown menu for active agent.
 */
export function renderProjectSwitcherMenu() {
  if (!dom.projectMenuList) return;
  const currentAgent = (state.roster || []).find(a => a.id === state.activeAgentId);
  const projects = currentAgent?.projects || [];

  if (projects.length === 0 || state.activeView === 'fleet' || state.activeView === 'projects') {
    if (dom.projectSwitcherDropdown) dom.projectSwitcherDropdown.style.display = 'none';
    return;
  }

  if (dom.projectSwitcherDropdown) dom.projectSwitcherDropdown.style.display = '';
  const activeProj = projects.find(p => p.id === state.activeProjectId) || projects[0];
  if (dom.activeProjectName) {
    dom.activeProjectName.textContent = activeProj.name || activeProj.id;
  }

  dom.projectMenuList.innerHTML = projects.map(proj => {
    const isSelected = proj.id === state.activeProjectId;
    const stats = proj.stats || {};
    const pct = stats.progressPct ?? 0;
    return `
      <button type="button" class="project-menu-item ${isSelected ? 'active' : ''}" data-project-id="${escapeHtml(proj.id)}" role="menuitem">
        <span class="project-menu-title">${escapeHtml(proj.name || proj.id)}</span>
        <span class="project-menu-badge">${pct}%</span>
      </button>
    `;
  }).join('');
}

/**
 * Updates top header display with current agent or fleet status.
 */
export function updateActiveAgentHeader(agent) {
  if (state.activeView === 'fleet') {
    if (dom.activeAgentIcon) dom.activeAgentIcon.textContent = '🌐';
    if (dom.activeAgentName) dom.activeAgentName.textContent = 'Fleet Overview';
    if (dom.activeAgentSub) dom.activeAgentSub.textContent = `${(state.roster || []).length} Seats Online`;
    return;
  }

  if (!agent) {
    if (dom.activeAgentIcon) dom.activeAgentIcon.textContent = '⬡';
    if (dom.activeAgentName) dom.activeAgentName.textContent = state.activeAgentId || 'manager-pm';
    if (dom.activeAgentSub) dom.activeAgentSub.textContent = 'Incubator v5';
    return;
  }

  if (dom.activeAgentIcon) dom.activeAgentIcon.textContent = agent.icon || '⬡';
  if (dom.activeAgentName) dom.activeAgentName.textContent = agent.name || agent.id;
  if (dom.activeAgentSub) dom.activeAgentSub.textContent = `${agent.id} · v5`;
}

/**
 * Switches the active agent context and triggers refresh.
 */

/** Filters belong to one board: clear them whenever the board changes. */
function resetFilters() {
  state.activeTrack = 'all';
  state.activeDocFilter = 'all';
  state.searchQuery = '';
  setStoredPref(STORAGE_KEYS.TRACK_FILTER, 'all');
  setStoredPref(STORAGE_KEYS.DOC_FILTER, 'all');
  if (dom.searchInput) dom.searchInput.value = '';
}

export async function switchAgent(agentId, onSwitched) {
  if (!agentId) return;
  state.activeAgentId = agentId;
  state.activeProjectId = null;
  resetFilters();
  const agent = (state.roster || []).find(a => a.id === agentId);
  updateActiveAgentHeader(agent);
  renderAgentSwitcherMenu();
  renderProjectSwitcherMenu();

  if (state.activeView !== 'fleet') {
    history.replaceState(null, '', `#agent=${encodeURIComponent(state.activeAgentId)}&view=${state.activeView}`);
  }
  if (typeof onSwitched === 'function') {
    await onSwitched(agentId);
  }
}

/**
 * Switches the active project context and triggers refresh.
 */
export async function switchProject(projectId, onSwitched) {
  if (!projectId || projectId === state.activeProjectId) return;
  state.activeProjectId = projectId;
  resetFilters();
  renderProjectSwitcherMenu();
  if (typeof onSwitched === 'function') {
    await onSwitched(projectId);
  }
}
