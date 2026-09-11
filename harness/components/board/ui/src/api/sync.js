import { state, dom, showToast } from '../store/state.js';
import { fetchRoster, fetchBoardState, fetchProjects } from './client.js';
import { renderAgentSwitcherMenu, renderProjectSwitcherMenu, updateActiveAgentHeader } from '../components/switcher.js';
import { updateHUD } from '../components/hud.js';

let defaultRenderer = null;

export function setDefaultRenderer(fn) {
  defaultRenderer = fn;
}

/**
 * Orchestrates multi-agent board data synchronization.
 */
export async function fetchData(silent = false, onRender) {
  try {
    let rosterAgents = state.roster || [];
    let defaultAgent = state.defaultAgentId || 'manager-pm';

    try {
      const rosterData = await fetchRoster();
      rosterAgents = rosterData.agents || [];
      defaultAgent = rosterData.defaultAgent || 'manager-pm';
    } catch (rosterErr) {
      console.warn('Could not fetch roster, running single-agent mode:', rosterErr);
    }

    let activeAgentId = state.activeAgentId || defaultAgent;
    if (rosterAgents.length > 0 && !rosterAgents.some(a => a.id === activeAgentId)) {
      activeAgentId = defaultAgent || rosterAgents[0].id;
    }

    const currentAgent = rosterAgents.find(a => a.id === activeAgentId);
    const projects = currentAgent?.projects || [];
    let activeProjectId = state.activeProjectId;
    if (projects.length > 0) {
      if (!activeProjectId || !projects.some(p => p.id === activeProjectId)) {
        activeProjectId = projects[0].id;
      }
    } else {
      activeProjectId = null;
    }

    const [boardState, projectsData] = await Promise.all([
      fetchBoardState(activeAgentId, activeProjectId),
      fetchProjects().catch(() => ({ projects: [], stats: null }))
    ]);

    // A doc filter saved from another board must not hide this one
    const f = state.activeDocFilter;
    if (f && f !== 'all' && f !== 'standalone'
        && !boardState.docs.some(d => d.slug === f)
        && !boardState.tasks.some(t => t.design_slug === f)) {
      state.activeDocFilter = 'all';
      setStoredPref(STORAGE_KEYS.DOC_FILTER, 'all');
    }

    // Skip re-render if payload is identical during auto-polling
    const nextPayload = JSON.stringify({
      roster: rosterAgents,
      activeAgentId,
      activeProjectId,
      summary: boardState.summary,
      tasks: boardState.tasks,
      docs: boardState.docs,
      projectsCatalog: projectsData.projects || []
    });

    if (silent && state._lastDataPayload === nextPayload) {
      state.lastSyncTime = Date.now();
      return;
    }
    state._lastDataPayload = nextPayload;

    state.roster = rosterAgents;
    state.defaultAgentId = defaultAgent;
    state.activeAgentId = activeAgentId;
    state.activeProjectId = activeProjectId;
    state.summary = boardState.summary;
    state.tasks = boardState.tasks;
    state.docs = boardState.docs;
    state.projectsCatalog = projectsData.projects || [];
    state.projectsStats = projectsData.stats || null;
    state.lastSyncTime = Date.now();

    renderAgentSwitcherMenu();
    updateActiveAgentHeader(currentAgent);
    renderProjectSwitcherMenu();
    updateHUD();

    const renderer = typeof onRender === 'function' ? onRender : defaultRenderer;
    if (typeof renderer === 'function') {
      renderer();
    }

    if (!silent) {
      const refreshIcon = dom.btnRefresh ? dom.btnRefresh.querySelector('.refresh-icon') : null;
      if (refreshIcon) {
        refreshIcon.style.transform = 'rotate(360deg)';
        setTimeout(() => { refreshIcon.style.transform = 'none'; }, 300);
      }
    }
  } catch (err) {
    console.error('Failed to sync board state:', err);
    if (!silent) showToast(`Sync error: ${err.message}`, 'error');
  }
}
