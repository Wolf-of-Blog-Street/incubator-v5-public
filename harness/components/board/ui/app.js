/**
 * Incubator v5 — Board Web UI Controller
 * Zero-dependency modern reactive client with first-class Design Docs support.
 */

// Industry Standard Tracks & Icons
const INDUSTRY_TRACKS = [
  { id: 'core', label: 'core', icon: '⬡' },
  { id: 'engine', label: 'engine', icon: '⚙️' },
  { id: 'harness', label: 'harness', icon: '🛡️' },
  { id: 'sweeper', label: 'sweeper', icon: '🧹' },
  { id: 'feature', label: 'feature', icon: '✨' },
  { id: 'bug', label: 'bug', icon: '🐛' },
  { id: 'frontend', label: 'frontend', icon: '🎨' },
  { id: 'backend', label: 'backend', icon: '🔌' },
  { id: 'api', label: 'api', icon: '⚡' },
  { id: 'ux', label: 'ux', icon: '🪄' },
  { id: 'db', label: 'db', icon: '🗄️' },
  { id: 'infra', label: 'infra', icon: '☁️' },
  { id: 'docs', label: 'docs', icon: '📄' },
  { id: 'test', label: 'test', icon: '🧪' },
  { id: 'perf', label: 'perf', icon: '🚀' }
];

/**
 * Gets the rich visual icon associated with any track.
 */
function getTrackIcon(trackId) {
  if (!trackId) return '🏷️';
  const match = INDUSTRY_TRACKS.find(t => t.id === trackId);
  if (match && match.icon) return match.icon;
  if (trackId === 'security') return '🔒';
  if (trackId === 'ai' || trackId === 'model') return '🤖';
  return '🏷️';
}

// Design Doc Color Palettes & Theme System
const DOC_COLOR_PALETTES = {
  sky: {
    accent: '#38bdf8',
    bg: 'rgba(56, 189, 248, 0.12)',
    bgHover: 'rgba(56, 189, 248, 0.22)',
    border: 'rgba(56, 189, 248, 0.35)',
    text: '#7dd3fc',
    glow: 'rgba(56, 189, 248, 0.25)'
  },
  purple: {
    accent: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.12)',
    bgHover: 'rgba(168, 85, 247, 0.22)',
    border: 'rgba(168, 85, 247, 0.35)',
    text: '#c084fc',
    glow: 'rgba(168, 85, 247, 0.25)'
  },
  emerald: {
    accent: '#10b981',
    bg: 'rgba(16, 185, 129, 0.12)',
    bgHover: 'rgba(16, 185, 129, 0.22)',
    border: 'rgba(16, 185, 129, 0.35)',
    text: '#34d399',
    glow: 'rgba(16, 185, 129, 0.25)'
  },
  amber: {
    accent: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.12)',
    bgHover: 'rgba(245, 158, 11, 0.22)',
    border: 'rgba(245, 158, 11, 0.35)',
    text: '#fbbf24',
    glow: 'rgba(245, 158, 11, 0.25)'
  },
  rose: {
    accent: '#f43f5e',
    bg: 'rgba(244, 63, 94, 0.12)',
    bgHover: 'rgba(244, 63, 94, 0.22)',
    border: 'rgba(244, 63, 94, 0.35)',
    text: '#fb7185',
    glow: 'rgba(244, 63, 94, 0.25)'
  },
  indigo: {
    accent: '#6366f1',
    bg: 'rgba(99, 102, 241, 0.12)',
    bgHover: 'rgba(99, 102, 241, 0.22)',
    border: 'rgba(99, 102, 241, 0.35)',
    text: '#818cf8',
    glow: 'rgba(99, 102, 241, 0.25)'
  },
  teal: {
    accent: '#14b8a6',
    bg: 'rgba(20, 184, 166, 0.12)',
    bgHover: 'rgba(20, 184, 166, 0.22)',
    border: 'rgba(20, 184, 166, 0.35)',
    text: '#2dd4bf',
    glow: 'rgba(20, 184, 166, 0.25)'
  },
  orange: {
    accent: '#f97316',
    bg: 'rgba(249, 115, 22, 0.12)',
    bgHover: 'rgba(249, 115, 22, 0.22)',
    border: 'rgba(249, 115, 22, 0.35)',
    text: '#fb923c',
    glow: 'rgba(249, 115, 22, 0.25)'
  }
};

const PALETTE_KEYS = Object.keys(DOC_COLOR_PALETTES);

function resolveColorPalette(colorSpec, slug = '') {
  if (!colorSpec) {
    let hash = 0;
    for (let i = 0; i < slug.length; i++) {
      hash = (hash * 31 + slug.charCodeAt(i)) & 0xffffffff;
    }
    const key = PALETTE_KEYS[Math.abs(hash) % PALETTE_KEYS.length];
    return DOC_COLOR_PALETTES[key];
  }

  const clean = colorSpec.toLowerCase().trim();
  if (DOC_COLOR_PALETTES[clean]) {
    return DOC_COLOR_PALETTES[clean];
  }

  if (clean.startsWith('#')) {
    for (const p of Object.values(DOC_COLOR_PALETTES)) {
      if (p.accent.toLowerCase() === clean) return p;
    }
    return {
      accent: clean,
      bg: `${clean}1f`,
      bgHover: `${clean}38`,
      border: `${clean}55`,
      text: clean,
      glow: `${clean}40`
    };
  }

  return DOC_COLOR_PALETTES.indigo;
}

function getDocColor(slugOrDoc) {
  const doc = typeof slugOrDoc === 'string' ? (state.docs || []).find(d => d.slug === slugOrDoc) : slugOrDoc;
  const slug = (typeof slugOrDoc === 'string' ? slugOrDoc : doc?.slug) || '';
  return resolveColorPalette(doc?.color, slug);
}

function getDocCodename(slugOrDoc) {
  const doc = typeof slugOrDoc === 'string' ? (state.docs || []).find(d => d.slug === slugOrDoc) : slugOrDoc;
  if (doc?.codename) return doc.codename;
  const slug = (typeof slugOrDoc === 'string' ? slugOrDoc : doc?.slug) || '';
  if (!slug || slug === 'standalone') return '#standalone';

  const idx = (state.docs || []).findIndex(d => d.slug === slug);
  if (idx >= 0) return `#d-${idx + 1}`;

  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) & 0xffffffff;
  }
  return `#d-${(Math.abs(hash) % 9) + 1}`;
}

// Application State
const state = {
  tasks: [],
  summary: null,
  docs: [],
  activeDoc: null,
  activeTrack: 'all',
  activeDocFilter: 'all',
  activeDocStatusFilter: 'all', // 'all' | 'open' | 'closed'
  searchQuery: '',
  activeView: 'swimlanes', // 'fleet' | 'swimlanes' | 'kanban' | 'docs'
  selectedTaskId: null,
  collapseDone: true, // Default to true so Done is collapsed out of the box!
  collapsedDoneOverrides: {}, // slug -> boolean
  isPolling: true,
  lastSyncTime: Date.now(),
  // Multi-Agent Fleet State
  activeAgentId: 'manager-pm',
  activeProjectId: null,
  roster: [],
  defaultAgentId: 'manager-pm',
  // Design Docs Catalog Filter: 'all' | 'active' | 'finished'
  activeDocsFilter: 'all'
};

// Expose state for DevTools inspection and verification
window.__board_state = state;

// DOM References
const dom = {
  // Agent Switcher & Fleet
  agentSwitcherDropdown: document.getElementById('agent-switcher-dropdown'),
  agentSwitcherBtn: document.getElementById('agent-switcher-btn'),
  activeAgentIcon: document.getElementById('active-agent-icon'),
  activeAgentName: document.getElementById('active-agent-name'),
  activeAgentSub: document.getElementById('active-agent-sub'),
  agentDropdownMenu: document.getElementById('agent-dropdown-menu'),
  agentMenuList: document.getElementById('agent-menu-list'),
  btnMenuFleet: document.getElementById('btn-menu-fleet'),
  viewFleetBtn: document.getElementById('view-fleet-btn'),
  fleetView: document.getElementById('fleet-view'),
  fleetGrid: document.getElementById('fleet-grid'),
  fleetSummaryMetrics: document.getElementById('fleet-summary-metrics'),

  // Project Switcher
  projectSwitcherDropdown: document.getElementById('project-switcher-dropdown'),
  projectSwitcherBtn: document.getElementById('project-switcher-btn'),
  activeProjectName: document.getElementById('active-project-name'),
  projectDropdownMenu: document.getElementById('project-dropdown-menu'),
  projectMenuList: document.getElementById('project-menu-list'),


  // HUD
  hudProgressBar: document.getElementById('hud-progress-bar'),
  hudProgressText: document.getElementById('hud-progress-text'),
  hudTotalTasks: document.getElementById('hud-total-tasks'),
  hudTotalBugs: document.getElementById('hud-total-bugs'),

  // Search & Filters
  searchInput: document.getElementById('search-input'),
  filterTrackSelect: document.getElementById('filter-track-select'),
  filterDocSelect: document.getElementById('filter-doc-select'),
  trackDropdown: document.getElementById('track-dropdown'),
  trackDropdownTrigger: document.getElementById('track-dropdown-trigger'),
  trackDropdownLabel: document.getElementById('track-dropdown-label'),
  trackDropdownMenu: document.getElementById('track-dropdown-menu'),
  docDropdown: document.getElementById('doc-dropdown'),
  docDropdownTrigger: document.getElementById('doc-dropdown-trigger'),
  docDropdownLabel: document.getElementById('doc-dropdown-label'),
  docDropdownMenu: document.getElementById('doc-dropdown-menu'),
  docStatusDropdown: document.getElementById('doc-status-dropdown'),
  docStatusDropdownTrigger: document.getElementById('doc-status-dropdown-trigger'),
  docStatusDropdownLabel: document.getElementById('doc-status-dropdown-label'),
  docStatusDropdownMenu: document.getElementById('doc-status-dropdown-menu'),
  btnQuickFilterBugs: document.getElementById('btn-quick-filter-bugs'),
  btnToggleDone: document.getElementById('btn-toggle-done'),
  btnToggleDoneText: document.getElementById('btn-toggle-done-text'),
  btnToggleDoneIcon: document.getElementById('btn-toggle-done-icon'),
  btnToggleAllSwimlanes: document.getElementById('btn-toggle-all-swimlanes'),
  btnRefresh: document.getElementById('btn-refresh'),

  // View switchers
  viewSwimlanesBtn: document.getElementById('view-swimlanes-btn'),
  viewKanbanBtn: document.getElementById('view-kanban-btn'),
  viewDocsBtn: document.getElementById('view-docs-btn'),
  swimlanesView: document.getElementById('swimlanes-view'),
  swimlanesList: document.getElementById('swimlanes-list'),
  // Kanban View & Filter Bar
  kanbanView: document.getElementById('kanban-view'),
  kanbanDocDropdown: document.getElementById('kanban-doc-dropdown'),
  kanbanDocDropdownTrigger: document.getElementById('kanban-doc-dropdown-trigger'),
  kanbanDocDropdownLabel: document.getElementById('kanban-doc-dropdown-label'),
  kanbanDocDropdownMenu: document.getElementById('kanban-doc-dropdown-menu'),
  kanbanActiveFilterBanner: document.getElementById('kanban-active-filter-banner'),
  kanbanFilterDocName: document.getElementById('kanban-filter-doc-name'),
  kanbanFilterCount: document.getElementById('kanban-filter-count'),
  btnKanbanClearFilter: document.getElementById('btn-kanban-clear-filter'),
  // Design Documents View & Filter Tabs
  docsView: document.getElementById('docs-view'),
  docsGrid: document.getElementById('docs-grid'),
  docsFilterTabs: document.getElementById('docs-filter-tabs'),
  countDocsAll: document.getElementById('count-docs-all'),
  countDocsActive: document.getElementById('count-docs-active'),
  countDocsFinished: document.getElementById('count-docs-finished'),

  // Kanban Columns
  listPlanned: document.getElementById('list-planned'),
  listInProgress: document.getElementById('list-in-progress'),
  listDone: document.getElementById('list-done'),
  countPlanned: document.getElementById('count-planned'),
  countInProgress: document.getElementById('count-in-progress'),
  countDone: document.getElementById('count-done'),

  // Actions
  btnNewTask: document.getElementById('btn-new-task'),
  btnLogBug: document.getElementById('btn-log-bug'),

  // Modal Dialog
  taskDialog: document.getElementById('task-dialog'),
  taskForm: document.getElementById('task-form'),
  modalTitle: document.getElementById('modal-title'),
  modalCloseBtn: document.getElementById('modal-close-btn'),
  modalCancelBtn: document.getElementById('modal-cancel-btn'),
  taskTitleInput: document.getElementById('task-title-input'),
  taskDocSelect: document.getElementById('task-doc-select'),
  taskTrackSelect: document.getElementById('task-track-select'),
  taskStatusSelect: document.getElementById('task-status-select'),
  taskDetailsInput: document.getElementById('task-details-input'),

  // Task Drawer
  taskDrawer: document.getElementById('task-drawer'),
  drawerBackdrop: document.getElementById('drawer-backdrop'),
  drawerCloseBtn: document.getElementById('drawer-close-btn'),
  drawerId: document.getElementById('drawer-id'),
  drawerTrackBadge: document.getElementById('drawer-track-badge'),
  drawerTitleInput: document.getElementById('drawer-title-input'),
  drawerStatusSelect: document.getElementById('drawer-status-select'),
  drawerTrackSelect: document.getElementById('drawer-track-select'),
  drawerDocSelect: document.getElementById('drawer-doc-select'),
  drawerDocWidget: document.getElementById('drawer-doc-widget'),
  drawerDocTitle: document.getElementById('drawer-doc-title'),
  drawerDocSub: document.getElementById('drawer-doc-sub'),
  btnOpenDocFromTask: document.getElementById('btn-open-doc-from-task'),
  tabPlanInteractive: document.getElementById('tab-plan-interactive'),
  tabPlanEdit: document.getElementById('tab-plan-edit'),
  drawerPlanPreview: document.getElementById('drawer-plan-preview'),
  drawerPlanContent: document.getElementById('drawer-plan-content'),
  drawerPlanEditorWrap: document.getElementById('drawer-plan-editor-wrap'),
  drawerDetailsInput: document.getElementById('drawer-details-input'),
  drawerCreatedAt: document.getElementById('drawer-created-at'),
  drawerUpdatedAt: document.getElementById('drawer-updated-at'),
  drawerSaveBtn: document.getElementById('drawer-save-btn'),
  drawerDeleteBtn: document.getElementById('drawer-delete-btn'),

  // Design Doc Reader Drawer
  docReaderDrawer: document.getElementById('doc-reader-drawer'),
  docReaderBackdrop: document.getElementById('doc-reader-backdrop'),
  docReaderCloseBtn: document.getElementById('doc-reader-close-btn'),
  readerTitle: document.getElementById('reader-title'),
  readerStatusPill: document.getElementById('reader-status-pill'),
  readerAuthor: document.getElementById('reader-author'),
  readerProse: document.getElementById('reader-prose'),
  readerTaskList: document.getElementById('reader-task-list'),
  readerTaskCount: document.getElementById('reader-task-count'),
  readerAddTaskBtn: document.getElementById('reader-add-task-btn'),
  readerFinishDocBtn: document.getElementById('reader-finish-doc-btn'),
  readerReopenDocBtn: document.getElementById('reader-reopen-doc-btn'),

  // Toast
  toastContainer: document.getElementById('toast-container')
};

/**
 * Helper to determine if a design doc is marked as finished/closed.
 */
function isDocFinished(slugOrDoc) {
  if (!slugOrDoc) return false;
  const doc = typeof slugOrDoc === 'string' ? (state.docs || []).find(d => d.slug === slugOrDoc) : slugOrDoc;
  if (!doc) return false;
  if (doc.isFinished !== undefined) return Boolean(doc.isFinished);
  const status = (doc.status || '').toLowerCase();
  return ['finished', 'done', 'closed', 'archived'].includes(status);
}

/**
 * Helper to determine if a design doc is actively in progress/draft.
 */
function isDocActive(slugOrDoc) {
  return !isDocFinished(slugOrDoc);
}

/**
 * Updates a design doc's lifecycle status via the API.
 */
async function updateDocStatus(slug, targetStatus) {
  try {
    const agentQuery = state.activeAgentId ? `?agent=${encodeURIComponent(state.activeAgentId)}` : '';
    const res = await fetch(`/api/v1/docs/${encodeURIComponent(slug)}/status${agentQuery}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: targetStatus, agent: state.activeAgentId })
    }).then(r => r.ok ? r : fetch(`/api/docs/${encodeURIComponent(slug)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: targetStatus })
    }));

    if (!res.ok) throw new Error(`Status update failed: ${res.status}`);
    showToast(`Design doc "${slug}" marked as ${targetStatus}!`, 'success');
    await fetchData(false);
    if (state.activeDoc && state.activeDoc.slug === slug) {
      await openDocReader(slug);
    }
  } catch (err) {
    showToast(`Error updating doc status: ${err.message}`, 'error');
  }
}

/**
 * Shows a temporary floating toast notification.
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px) scale(0.95)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

/**
 * Fetches latest roster, board summary, tasks, and design docs from API.
 */
async function fetchData(silent = false) {
  try {
    // 1. Fetch multi-agent roster if available
    let rosterAgents = state.roster || [];
    let defaultAgent = state.defaultAgentId || 'manager-pm';
    try {
      const rosterRes = await fetch('/api/v1/roster');
      if (rosterRes.ok) {
        const rosterData = await rosterRes.json();
        rosterAgents = rosterData.agents || [];
        defaultAgent = rosterData.defaultAgent || 'manager-pm';
      }
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

    // 2. Fetch active agent and project board, tasks, docs
    const projectQuery = activeProjectId ? `&project=${encodeURIComponent(activeProjectId)}` : '';
    const agentQuery = activeAgentId ? `?agent=${encodeURIComponent(activeAgentId)}${projectQuery}` : (activeProjectId ? `?project=${encodeURIComponent(activeProjectId)}` : '');
    const [boardRes, tasksRes, docsRes] = await Promise.all([
      fetch(`/api/v1/board${agentQuery}`).then(r => r.ok ? r : fetch(`/api/board${agentQuery}`)),
      fetch(`/api/v1/tasks${agentQuery}`).then(r => r.ok ? r : fetch(`/api/tasks${agentQuery}`)),
      fetch(`/api/v1/agents/${encodeURIComponent(activeAgentId)}/docs${activeProjectId ? `?project=${encodeURIComponent(activeProjectId)}` : ''}`).then(r => r.ok ? r : fetch(`/api/docs${agentQuery}`))
    ]);

    if (!boardRes.ok || !tasksRes.ok) {
      throw new Error(`API returned ${boardRes.status} / ${tasksRes.status}`);
    }

    const summaryData = await boardRes.json();
    const tasksData = await tasksRes.json();
    const docsData = docsRes.ok ? await docsRes.json() : { docs: [] };

    // Change Detection: If data payload is unchanged during auto-polling, skip DOM re-render entirely
    const nextPayload = JSON.stringify({
      roster: rosterAgents,
      activeAgentId,
      activeProjectId,
      summary: summaryData,
      tasks: tasksData.tasks || [],
      docs: docsData.docs || []
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
    state.summary = summaryData;
    state.tasks = tasksData.tasks || [];
    state.docs = docsData.docs || [];
    state.lastSyncTime = Date.now();

    renderAgentSwitcherMenu();
    updateActiveAgentHeader(currentAgent);
    renderProjectSwitcherMenu();
    updateHUD();
    render();

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

/**
 * Renders the Agent Switcher dropdown list.
 */
function renderAgentSwitcherMenu() {
  if (!dom.agentMenuList) return;
  dom.agentMenuList.innerHTML = state.roster.map(agent => {
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
        ${agent.stats?.openBugs > 0 ? `<span class="agent-menu-badge" style="color: var(--status-bug); border-color: rgba(239, 68, 68, 0.3);">🐛 ${agent.stats.openBugs}</span>` : ''}
      </button>
    `;
  }).join('');
}

/**
 * Renders the Project Switcher dropdown list for active agent.
 */
function renderProjectSwitcherMenu() {
  if (!dom.projectMenuList) return;
  const currentAgent = state.roster.find(a => a.id === state.activeAgentId);
  const projects = currentAgent?.projects || [];

  if (projects.length === 0) {
    if (dom.projectSwitcherDropdown) dom.projectSwitcherDropdown.style.display = 'none';
    return;
  }

  if (dom.projectSwitcherDropdown) dom.projectSwitcherDropdown.style.display = 'block';
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
        <span class="project-menu-icon">📁</span>
        <span class="project-menu-title">${escapeHtml(proj.name || proj.id)}</span>
        <span class="project-menu-badge">${pct}%</span>
      </button>
    `;
  }).join('');
}

/**
 * Switches the active project context and refreshes data.
 */
async function switchProject(projectId) {
  if (!projectId || projectId === state.activeProjectId) return;
  state.activeProjectId = projectId;
  renderProjectSwitcherMenu();
  await fetchData(false);
}

/**
 * Updates top header display with current agent or fleet status.
 */
function updateActiveAgentHeader(agent) {
  if (state.activeView === 'fleet') {
    if (dom.activeAgentIcon) dom.activeAgentIcon.textContent = '🌐';
    if (dom.activeAgentName) dom.activeAgentName.textContent = 'Fleet Overview';
    if (dom.activeAgentSub) dom.activeAgentSub.textContent = `${state.roster.length} Seats Online`;
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
 * Sets the active view ('fleet' | 'swimlanes' | 'kanban' | 'docs')
 */
function setView(viewName) {
  state.activeView = viewName;
  if (dom.viewFleetBtn) dom.viewFleetBtn.classList.toggle('active', viewName === 'fleet');
  if (dom.viewSwimlanesBtn) dom.viewSwimlanesBtn.classList.toggle('active', viewName === 'swimlanes');
  if (dom.viewKanbanBtn) dom.viewKanbanBtn.classList.toggle('active', viewName === 'kanban');
  if (dom.viewDocsBtn) dom.viewDocsBtn.classList.toggle('active', viewName === 'docs');

  if (dom.fleetView) dom.fleetView.style.display = viewName === 'fleet' ? 'flex' : 'none';
  if (dom.swimlanesView) dom.swimlanesView.style.display = viewName === 'swimlanes' ? 'flex' : 'none';
  if (dom.kanbanView) dom.kanbanView.style.display = viewName === 'kanban' ? 'flex' : 'none';
  if (dom.docsView) dom.docsView.style.display = viewName === 'docs' ? 'flex' : 'none';

  const filterToolbar = document.querySelector('.filter-toolbar');
  if (filterToolbar) {
    filterToolbar.style.display = viewName === 'fleet' ? 'none' : 'flex';
  }

  if (dom.btnToggleAllSwimlanes) {
    dom.btnToggleAllSwimlanes.style.display = viewName === 'swimlanes' ? 'inline-flex' : 'none';
  }
  if (dom.btnToggleDone) {
    dom.btnToggleDone.style.display = viewName === 'swimlanes' ? 'inline-flex' : 'none';
  }

  const currentAgent = state.roster.find(a => a.id === state.activeAgentId);
  updateActiveAgentHeader(currentAgent);

  // Synchronize URL hash
  if (viewName === 'fleet') {
    history.replaceState(null, '', '#fleet');
  } else {
    history.replaceState(null, '', `#agent=${encodeURIComponent(state.activeAgentId)}&view=${viewName}`);
  }

  render();
}

/**
 * Switches the active agent context and refreshes data.
 */
async function switchAgent(agentId) {
  if (!agentId) return;
  state.activeAgentId = agentId;
  state.activeProjectId = null;
  const agent = state.roster.find(a => a.id === agentId);
  updateActiveAgentHeader(agent);
  renderAgentSwitcherMenu();
  renderProjectSwitcherMenu();
  if (state.activeView === 'fleet') {
    setView('swimlanes');
  } else {
    history.replaceState(null, '', `#agent=${encodeURIComponent(state.activeAgentId)}&view=${state.activeView}`);
  }
  await fetchData(false);
}


/**
 * Renders the Topological Fleet Overview Matrix.
 */
function renderFleet() {
  if (!dom.fleetGrid || !dom.fleetSummaryMetrics) return;

  const windowScrollY = window.scrollY || document.documentElement.scrollTop;

  const totalSeats = state.roster.length;
  const totalTasks = state.roster.reduce((sum, a) => sum + (a.stats?.totalTasks || 0), 0);
  const totalDone = state.roster.reduce((sum, a) => sum + (a.stats?.doneTasks || 0), 0);
  const totalInProgress = state.roster.reduce((sum, a) => sum + (a.stats?.inProgressTasks || 0), 0);
  const totalBugs = state.roster.reduce((sum, a) => sum + (a.stats?.openBugs || 0), 0);
  const overallProgress = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;

  dom.fleetSummaryMetrics.innerHTML = `
    <div class="fleet-summary-card">
      <span class="fleet-summary-label">ACTIVE SEATS</span>
      <span class="fleet-summary-val">${totalSeats}</span>
    </div>
    <div class="fleet-summary-card">
      <span class="fleet-summary-label">FLEET PROGRESS</span>
      <span class="fleet-summary-val progress">${overallProgress}%</span>
    </div>
    <div class="fleet-summary-card">
      <span class="fleet-summary-label">TOTAL TASKS</span>
      <span class="fleet-summary-val">${totalTasks}</span>
    </div>
    <div class="fleet-summary-card">
      <span class="fleet-summary-label">IN PROGRESS</span>
      <span class="fleet-summary-val" style="color: var(--status-in-progress);">${totalInProgress}</span>
    </div>
    <div class="fleet-summary-card">
      <span class="fleet-summary-label">OPEN BUGS</span>
      <span class="fleet-summary-val bugs">${totalBugs}</span>
    </div>
  `;

  if (state.roster.length === 0) {
    dom.fleetGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 3rem; text-align: center;">
        <span class="empty-icon" style="font-size: 2.5rem;">🌐</span>
        <h3 style="margin-top: 0.5rem; color: var(--text-primary);">No Agent Seats Discovered</h3>
        <p style="color: var(--text-muted); font-size: 0.85rem;">Run local agents with FALCON_BOARD_URL configured to connect seats to Falcon Manager.</p>
      </div>
    `;
    return;
  }

  dom.fleetGrid.innerHTML = state.roster.map(agent => {
    const stats = agent.stats || { totalTasks: 0, doneTasks: 0, inProgressTasks: 0, plannedTasks: 0, openBugs: 0, progressPct: 0 };
    const stages = agent.stages || [];
    const activeStage = stages.find(s => s.progress < 100) || stages[stages.length - 1] || null;
    const stageTitle = activeStage ? (activeStage.title || activeStage.slug) : 'All Stages Complete';
    const stagePct = activeStage ? activeStage.progress : 100;

    const tagsHtml = (agent.tags || []).map(tag => `
      <span class="fleet-tag-chip">#${escapeHtml(tag)}</span>
    `).join('');

    const projectsHtml = (agent.projects || []).map(p => {
      const pStats = p.stats || {};
      const pct = pStats.progressPct ?? 0;
      return `
        <button type="button" class="fleet-proj-pill" data-agent-id="${escapeHtml(agent.id)}" data-project-id="${escapeHtml(p.id)}" title="Open ${escapeHtml(p.name || p.id)} Project Board">
          <span class="proj-icon">📁</span>
          <span class="proj-name">${escapeHtml(p.name || p.id)}</span>
          <span class="proj-pct">${pct}%</span>
        </button>
      `;
    }).join('');

    return `
      <div class="fleet-agent-card" data-agent-id="${escapeHtml(agent.id)}">
        <div class="fleet-card-top">
          <div class="fleet-agent-header">
            <span class="fleet-agent-avatar">${escapeHtml(agent.icon || '🤖')}</span>
            <div class="fleet-agent-details">
              <span class="fleet-agent-name">${escapeHtml(agent.name || agent.id)}</span>
              <span class="fleet-agent-id">${escapeHtml(agent.id)}</span>
            </div>
          </div>
          <span class="fleet-status-pill online">ONLINE</span>
        </div>

        ${tagsHtml ? `<div class="fleet-tags-wrap">${tagsHtml}</div>` : ''}

        ${projectsHtml ? `
          <div class="fleet-projects-section">
            <span class="fleet-projects-label">WORKSPACE PROJECTS</span>
            <div class="fleet-projects-wrap">${projectsHtml}</div>
          </div>
        ` : ''}

        <div class="fleet-milestone-box">
          <div class="fleet-milestone-header">
            <span class="fleet-milestone-label">ACTIVE MILESTONE</span>
            <span class="fleet-milestone-pct">${stagePct}%</span>
          </div>
          <span class="fleet-milestone-title" title="${escapeHtml(stageTitle)}">${escapeHtml(stageTitle)}</span>
          <div class="fleet-card-progress">
            <div class="fleet-card-progress-bar" style="width: ${stagePct}%;"></div>
          </div>
        </div>

        <div class="fleet-metrics-strip">
          <div class="fleet-metric-pill">
            <span class="label">TOTAL</span>
            <span class="count">${stats.totalTasks}</span>
          </div>
          <div class="fleet-metric-pill">
            <span class="label">DONE</span>
            <span class="count" style="color: var(--accent-emerald);">${stats.doneTasks}</span>
          </div>
          <div class="fleet-metric-pill">
            <span class="label">ACTIVE</span>
            <span class="count" style="color: var(--status-in-progress);">${stats.inProgressTasks}</span>
          </div>
          <div class="fleet-metric-pill bugs">
            <span class="label">BUGS</span>
            <span class="count">${stats.openBugs}</span>
          </div>
        </div>

        <div class="fleet-card-actions">
          <button type="button" class="fleet-inspect-btn" data-action="inspect-agent" data-agent-id="${escapeHtml(agent.id)}">
            <span>Inspect Board</span> ↗
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (windowScrollY > 0) {
    window.scrollTo({ top: windowScrollY, behavior: 'instant' });
  }
}

/**
 * Updates the top telemetry HUD with live statistics.
 */
function updateHUD() {
  if (!state.summary) return;

  const { overallProgress, totalTasks, openBugs } = state.summary;

  dom.hudProgressBar.style.width = `${overallProgress || 0}%`;
  dom.hudProgressText.textContent = `${overallProgress || 0}%`;
  dom.hudTotalTasks.textContent = totalTasks || 0;
  dom.hudTotalBugs.textContent = openBugs || 0;

  if (openBugs > 0) {
    dom.hudTotalBugs.classList.add('has-bugs');
  } else {
    dom.hudTotalBugs.classList.remove('has-bugs');
  }
}

/**
 * Filters the active task list based on search, track, and mode filters.
 */
function getFilteredTasks() {
  return state.tasks.filter(task => {
    // Search query filter
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const matchTitle = (task.title || '').toLowerCase().includes(q);
      const matchSlug = (task.design_slug || '').toLowerCase().includes(q);
      const matchDetails = (task.details || '').toLowerCase().includes(q);
      const matchId = String(task.id).includes(q);
      if (!matchTitle && !matchSlug && !matchDetails && !matchId) return false;
    }

    // Track filter
    if (state.activeTrack !== 'all') {
      if (task.track !== state.activeTrack) return false;
    }

    // Design Doc filter
    if (state.activeDocFilter !== 'all') {
      if (state.activeDocFilter === 'standalone') {
        if (task.design_slug && task.design_slug.trim() && task.design_slug.toLowerCase() !== 'standalone') return false;
      } else {
        if (task.design_slug !== state.activeDocFilter) return false;
      }
    }

    // Doc status filter (open vs closed)
    if (task.design_slug && task.design_slug.trim() && task.design_slug.toLowerCase() !== 'standalone') {
      const isFinished = isDocFinished(task.design_slug);
      if (state.activeDocStatusFilter === 'open' && isFinished) return false;
      if (state.activeDocStatusFilter === 'closed' && !isFinished) return false;
    } else {
      if (state.activeDocStatusFilter === 'closed') return false;
    }

    // Exclude tasks belonging to finished design docs from regular board views only if active docs exist, status filter is 'all', and doc filter is 'all'
    if (task.design_slug && task.design_slug.trim() && task.design_slug.toLowerCase() !== 'standalone') {
      const hasActiveDocs = (state.docs || []).some(isDocActive);
      if (state.activeDocStatusFilter === 'all' && state.activeDocFilter === 'all' && hasActiveDocs && isDocFinished(task.design_slug)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Checks if the Done column is collapsed for a given design doc slug or standalone.
 */
function isDoneCollapsed(slug) {
  if (state.collapsedDoneOverrides[slug] !== undefined) {
    return state.collapsedDoneOverrides[slug];
  }
  return state.collapseDone;
}

/**
 * Toggles the Done column collapsed state for a single design doc.
 */
function toggleDoneCol(slug) {
  const current = isDoneCollapsed(slug);
  state.collapsedDoneOverrides[slug] = !current;
  render();
}

/**
 * Toggles Done columns globally across all swimlanes.
 */
function toggleAllDone() {
  state.collapseDone = !state.collapseDone;
  state.collapsedDoneOverrides = {};
  updateDoneToggleButton();
  render();
}

/**
 * Updates the global Done toggle button text and icon.
 */
function updateDoneToggleButton() {
  if (!dom.btnToggleDoneText || !dom.btnToggleDoneIcon) return;
  if (state.collapseDone) {
    dom.btnToggleDoneText.textContent = 'Expand Done';
    dom.btnToggleDoneIcon.textContent = '✓';
    dom.btnToggleDone.title = 'Expand Done columns across all swimlanes';
  } else {
    dom.btnToggleDoneText.textContent = 'Collapse Done';
    dom.btnToggleDoneIcon.textContent = '▴';
    dom.btnToggleDone.title = 'Collapse Done columns across all swimlanes';
  }
}

/**
 * Sets the active Design Doc filter and triggers a re-render.
 */
function setDocFilter(slug) {
  state.activeDocFilter = slug || 'all';
  render();
}

/**
 * Sets the active Design Doc status filter ('all' | 'open' | 'closed').
 */
function setDocStatusFilter(status) {
  state.activeDocStatusFilter = status || 'all';
  if (state.activeDocFilter && state.activeDocFilter !== 'all' && state.activeDocFilter !== 'standalone') {
    const isFinished = isDocFinished(state.activeDocFilter);
    if (state.activeDocStatusFilter === 'open' && isFinished) {
      state.activeDocFilter = 'all';
    } else if (state.activeDocStatusFilter === 'closed' && !isFinished) {
      state.activeDocFilter = 'all';
    }
  }
  render();
}

/**
 * Renders the Doc Status filter dropdown (All / Open / Closed).
 */
function renderDocStatusFilters() {
  if (!dom.docStatusDropdownMenu && !dom.docStatusDropdownLabel) return;

  const docs = state.docs || [];
  const openCount = docs.filter(isDocActive).length;
  const closedCount = docs.filter(isDocFinished).length;
  const totalCount = docs.length;

  const status = state.activeDocStatusFilter || 'all';
  let labelText = `All Docs (${totalCount})`;
  if (status === 'open') {
    labelText = `🟢 Open (${openCount})`;
  } else if (status === 'closed') {
    labelText = `🏁 Closed (${closedCount})`;
  }

  if (dom.docStatusDropdownLabel) {
    dom.docStatusDropdownLabel.textContent = labelText;
    dom.docStatusDropdownLabel.title = labelText;
  }

  if (dom.docStatusDropdownMenu) {
    dom.docStatusDropdownMenu.innerHTML = `
      <button type="button" class="dropdown-item ${status === 'all' ? 'is-selected' : ''}" data-value="all">
        <div class="dropdown-item-left">
          <span class="dropdown-item-check">✓</span>
          <span>All Docs (Open & Closed)</span>
        </div>
        <span class="dropdown-item-count">${totalCount}</span>
      </button>
      <button type="button" class="dropdown-item ${status === 'open' ? 'is-selected' : ''}" data-value="open">
        <div class="dropdown-item-left">
          <span class="dropdown-item-check">✓</span>
          <span>🟢 Open / Active</span>
        </div>
        <span class="dropdown-item-count">${openCount}</span>
      </button>
      <button type="button" class="dropdown-item ${status === 'closed' ? 'is-selected' : ''}" data-value="closed">
        <div class="dropdown-item-left">
          <span class="dropdown-item-check">✓</span>
          <span>🏁 Closed / Finished</span>
        </div>
        <span class="dropdown-item-count">${closedCount}</span>
      </button>
    `;
  }
}

/**
 * Renders the compact Design Doc filter dropdown in the top toolbar,
 * the filter pills in the Flat Kanban header, and updates the active filter banner.
 */
function renderDocFilters(filteredTasks) {
  const allDocs = state.docs || [];
  const statusFilter = state.activeDocStatusFilter || 'all';

  const activeDocSlugs = new Set();
  const finishedDocSlugs = new Set();

  allDocs.forEach(d => {
    if (isDocActive(d)) {
      if (statusFilter !== 'closed') activeDocSlugs.add(d.slug);
    } else {
      if (statusFilter !== 'open') finishedDocSlugs.add(d.slug);
    }
  });

  (state.tasks || []).forEach(t => {
    if (t.design_slug && t.design_slug.trim() && t.design_slug.toLowerCase() !== 'standalone') {
      const slug = t.design_slug.trim();
      if (isDocActive(slug)) {
        if (statusFilter !== 'closed') activeDocSlugs.add(slug);
      } else {
        if (statusFilter !== 'open') finishedDocSlugs.add(slug);
      }
    }
  });

  const matchingTasks = state.tasks.filter(t => {
    if (!t.design_slug || t.design_slug.trim().toLowerCase() === 'standalone') {
      return statusFilter !== 'closed';
    }
    const isFinished = isDocFinished(t.design_slug);
    if (statusFilter === 'open' && isFinished) return false;
    if (statusFilter === 'closed' && !isFinished) return false;
    return true;
  });
  const totalTasks = matchingTasks.length;
  const standaloneCount = (statusFilter === 'closed') ? 0 : state.tasks.filter(t => !t.design_slug || !t.design_slug.trim() || t.design_slug.toLowerCase() === 'standalone').length;

  // 1. Top Toolbar Dropdown: Custom Dropdown or Legacy Select
  const activeDoc = state.activeDocFilter;
  let activeDocLabelText = `All Design Docs (${totalTasks})`;
  if (activeDoc === 'standalone') {
    activeDocLabelText = `⚡ Standalone (${standaloneCount})`;
  } else if (activeDoc !== 'all') {
    const foundDoc = (state.docs || []).find(d => d.slug === activeDoc);
    const title = foundDoc ? foundDoc.title : activeDoc;
    const count = state.tasks.filter(t => t.design_slug === activeDoc).length;
    const codename = getDocCodename(activeDoc);
    activeDocLabelText = `${codename} ${title} (${count})`;
  }

  if (dom.docDropdownLabel) {
    dom.docDropdownLabel.textContent = activeDocLabelText;
    dom.docDropdownLabel.title = activeDocLabelText;
  }
  if (dom.kanbanDocDropdownLabel) {
    dom.kanbanDocDropdownLabel.textContent = activeDocLabelText;
    dom.kanbanDocDropdownLabel.title = activeDocLabelText;
  }

  let menuHtml = `
    <button type="button" class="dropdown-item ${activeDoc === 'all' ? 'is-selected' : ''}" data-value="all">
      <div class="dropdown-item-left">
        <span class="dropdown-item-check">✓</span>
        <span>All Design Docs</span>
      </div>
      <span class="dropdown-item-count">${totalTasks}</span>
    </button>
  `;

  // Active specs (if not filtering to closed only)
  if (statusFilter !== 'closed' && activeDocSlugs.size > 0) {
    if (statusFilter === 'all' && finishedDocSlugs.size > 0) {
      menuHtml += `
        <div style="font-size: 0.65rem; color: var(--text-muted); padding: 0.45rem 0.75rem 0.2rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">
          Open Epics
        </div>
      `;
    }
    for (const slug of activeDocSlugs) {
      const doc = (state.docs || []).find(d => d.slug === slug);
      const title = doc ? doc.title : slug;
      const count = state.tasks.filter(t => t.design_slug === slug).length;
      const isSelected = activeDoc === slug ? 'is-selected' : '';
      const codename = getDocCodename(slug);
      const color = getDocColor(slug);
      menuHtml += `
        <button type="button" class="dropdown-item ${isSelected}" data-value="${escapeHtml(slug)}" title="${escapeHtml(title)}">
          <div class="dropdown-item-left">
            <span class="dropdown-item-check">✓</span>
            <span class="filter-codename" style="color: ${color.accent}; border: 1px solid ${color.border};">${escapeHtml(codename)}</span>
            <span>${escapeHtml(title)}</span>
          </div>
          <span class="dropdown-item-count">${count}</span>
        </button>
      `;
    }
  }

  // Completed specs (if not filtering to open only)
  if (statusFilter !== 'open' && finishedDocSlugs.size > 0) {
    if (statusFilter === 'all' && activeDocSlugs.size > 0) {
      menuHtml += `
        <div style="font-size: 0.65rem; color: var(--text-muted); padding: 0.45rem 0.75rem 0.2rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06)); margin-top: 0.25rem;">
          Completed Epics
        </div>
      `;
    }
    for (const slug of finishedDocSlugs) {
      const doc = (state.docs || []).find(d => d.slug === slug);
      const title = doc ? doc.title : slug;
      const count = state.tasks.filter(t => t.design_slug === slug).length;
      const isSelected = activeDoc === slug ? 'is-selected' : '';
      const codename = getDocCodename(slug);
      const color = getDocColor(slug);
      menuHtml += `
        <button type="button" class="dropdown-item ${isSelected}" data-value="${escapeHtml(slug)}" title="${escapeHtml(title)}">
          <div class="dropdown-item-left">
            <span class="dropdown-item-check">✓</span>
            <span class="filter-codename" style="color: ${color.accent}; border: 1px solid ${color.border};">${escapeHtml(codename)}</span>
            <span>${escapeHtml(title)}</span>
          </div>
          <span class="dropdown-item-count">${count}</span>
        </button>
      `;
    }
  }

  if (standaloneCount > 0) {
    const isSelected = activeDoc === 'standalone' ? 'is-selected' : '';
    menuHtml += `
      <button type="button" class="dropdown-item ${isSelected}" data-value="standalone">
        <div class="dropdown-item-left">
          <span class="dropdown-item-check">✓</span>
          <span>⚡ Standalone Tasks</span>
        </div>
        <span class="dropdown-item-count">${standaloneCount}</span>
      </button>
    `;
  }

  if (dom.docDropdownMenu) {
    dom.docDropdownMenu.innerHTML = menuHtml;
  }
  if (dom.kanbanDocDropdownMenu) {
    dom.kanbanDocDropdownMenu.innerHTML = menuHtml;
  }

  if (dom.filterDocSelect) {
    let selectHtml = `<option value="all" ${state.activeDocFilter === 'all' ? 'selected' : ''}>All Design Docs (${totalTasks})</option>`;
    for (const slug of docSlugs) {
      const doc = (state.docs || []).find(d => d.slug === slug);
      const title = doc ? doc.title : slug;
      const count = state.tasks.filter(t => t.design_slug === slug).length;
      const isSelected = state.activeDocFilter === slug ? 'selected' : '';
      const codename = getDocCodename(slug);
      selectHtml += `<option value="${escapeHtml(slug)}" ${isSelected}>[${escapeHtml(codename)}] ${escapeHtml(title)} (${count})</option>`;
    }
    if (standaloneCount > 0 || docSlugs.size > 0) {
      const isSelected = state.activeDocFilter === 'standalone' ? 'selected' : '';
      selectHtml += `<option value="standalone" ${isSelected}>⚡ Standalone Tasks (${standaloneCount})</option>`;
    }
    dom.filterDocSelect.innerHTML = selectHtml;
    dom.filterDocSelect.value = state.activeDocFilter;
  }

  // 2. Flat Kanban Active Filter Banner (#kanban-active-filter-banner)
  if (dom.kanbanActiveFilterBanner) {
    if (state.activeDocFilter === 'all') {
      dom.kanbanActiveFilterBanner.style.display = 'none';
    } else {
      dom.kanbanActiveFilterBanner.style.display = 'flex';
      if (state.activeDocFilter === 'standalone') {
        if (dom.kanbanFilterDocName) dom.kanbanFilterDocName.textContent = '⚡ Standalone Tasks & Ad-hoc Bugs';
      } else {
        const doc = (state.docs || []).find(d => d.slug === state.activeDocFilter);
        const codename = getDocCodename(state.activeDocFilter);
        const name = doc ? `[${codename}] ${doc.title} (${state.activeDocFilter})` : `[${codename}] ${state.activeDocFilter}`;
        if (dom.kanbanFilterDocName) dom.kanbanFilterDocName.textContent = name;
      }
      if (dom.kanbanFilterCount) {
        dom.kanbanFilterCount.textContent = `${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'} shown`;
      }
    }
  }
}

/**
 * Dynamically renders the compact Track filter dropdown in the toolbar.
 */
function renderTrackFilters() {
  const totalTasks = state.tasks.length;
  const presentTracks = new Set((state.tasks || []).map(t => t.track).filter(Boolean));

  // Determine active track label
  let activeTrackLabel = `All Tracks (${totalTasks})`;
  if (state.activeTrack !== 'all') {
    const matched = INDUSTRY_TRACKS.find(item => item.id === state.activeTrack);
    const count = (state.tasks || []).filter(t => t.track === state.activeTrack).length;
    const icon = getTrackIcon(state.activeTrack);
    const labelName = matched ? matched.label : state.activeTrack;
    activeTrackLabel = `${icon} ${labelName} (${count})`;
  }

  if (dom.trackDropdownLabel) {
    dom.trackDropdownLabel.textContent = activeTrackLabel;
    dom.trackDropdownLabel.title = activeTrackLabel;
  }

  // Build options list: prioritize tracks present + core industry tracks
  const rendered = new Set();
  const trackItems = [];

  for (const item of INDUSTRY_TRACKS) {
    const isTopTrack = ['bug', 'core', 'engine', 'harness', 'sweeper', 'feature', 'frontend', 'backend', 'api', 'ux', 'db', 'infra', 'docs', 'test', 'perf'].includes(item.id);
    if (presentTracks.has(item.id) || isTopTrack) {
      const count = (state.tasks || []).filter(t => t.track === item.id).length;
      trackItems.push({ id: item.id, label: item.label, icon: item.icon, count });
      rendered.add(item.id);
    }
  }

  for (const track of presentTracks) {
    if (!rendered.has(track)) {
      const count = (state.tasks || []).filter(t => t.track === track).length;
      trackItems.push({ id: track, label: track, icon: getTrackIcon(track), count });
    }
  }

  // Render Custom Dropdown Menu
  if (dom.trackDropdownMenu) {
    let menuHtml = `
      <button type="button" class="dropdown-item ${state.activeTrack === 'all' ? 'is-selected' : ''}" data-value="all">
        <div class="dropdown-item-left">
          <span class="dropdown-item-check">✓</span>
          <span>All Tracks</span>
        </div>
        <span class="dropdown-item-count">${totalTasks}</span>
      </button>
    `;

    for (const t of trackItems) {
      const isSelected = state.activeTrack === t.id ? 'is-selected' : '';
      menuHtml += `
        <button type="button" class="dropdown-item ${isSelected}" data-value="${escapeHtml(t.id)}">
          <div class="dropdown-item-left">
            <span class="dropdown-item-check">✓</span>
            <span>${t.icon} ${escapeHtml(t.label)}</span>
          </div>
          <span class="dropdown-item-count">${t.count}</span>
        </button>
      `;
    }

    dom.trackDropdownMenu.innerHTML = menuHtml;
  }

  // Render Legacy Select if present
  if (dom.filterTrackSelect) {
    let html = `<option value="all" ${state.activeTrack === 'all' ? 'selected' : ''}>All Tracks (${totalTasks})</option>`;
    for (const t of trackItems) {
      const isSelected = state.activeTrack === t.id ? 'selected' : '';
      const countLabel = t.count > 0 ? ` (${t.count})` : '';
      html += `<option value="${escapeHtml(t.id)}" ${isSelected}>${t.icon} ${escapeHtml(t.label)}${countLabel}</option>`;
    }
    dom.filterTrackSelect.innerHTML = html;
    dom.filterTrackSelect.value = state.activeTrack;
  }

  // Update quick bug toggle button state
  if (dom.btnQuickFilterBugs) {
    dom.btnQuickFilterBugs.classList.toggle('active', state.activeTrack === 'bug');
    const openBugCount = (state.tasks || []).filter(t => t.track === 'bug' && t.status !== 'done').length;
    dom.btnQuickFilterBugs.textContent = openBugCount > 0 ? `🐛 Bugs (${openBugCount})` : '🐛 Bugs';
  }
}

/**
 * Master render router.
 */
function render() {
  const filtered = getFilteredTasks();
  renderTrackFilters();
  renderDocStatusFilters();
  renderDocFilters(filtered);
  updateDoneToggleButton();

  if (state.activeView === 'fleet') {
    renderFleet();
  } else if (state.activeView === 'swimlanes') {
    renderSwimlanes(filtered);
  } else if (state.activeView === 'kanban') {
    renderKanban(filtered);
  } else if (state.activeView === 'docs') {
    renderDocs();
  }
}

/**
 * Renders the Kanban board view.
 */
function renderKanban(tasks) {
  const planned = tasks.filter(t => t.status === 'planned');
  const inProgress = tasks.filter(t => t.status === 'in-progress');
  const done = tasks.filter(t => t.status === 'done');

  dom.countPlanned.textContent = planned.length;
  dom.countInProgress.textContent = inProgress.length;
  dom.countDone.textContent = done.length;

  // Preserve column and window scroll offsets
  const plannedScroll = dom.listPlanned ? dom.listPlanned.scrollTop : 0;
  const inProgressScroll = dom.listInProgress ? dom.listInProgress.scrollTop : 0;
  const doneScroll = dom.listDone ? dom.listDone.scrollTop : 0;
  const windowScrollY = window.scrollY || document.documentElement.scrollTop;

  dom.listPlanned.innerHTML = planned.map(createCardHtml).join('');
  dom.listInProgress.innerHTML = inProgress.map(createCardHtml).join('');
  dom.listDone.innerHTML = done.map(createCardHtml).join('');

  if (dom.listPlanned && plannedScroll > 0) dom.listPlanned.scrollTop = plannedScroll;
  if (dom.listInProgress && inProgressScroll > 0) dom.listInProgress.scrollTop = inProgressScroll;
  if (dom.listDone && doneScroll > 0) dom.listDone.scrollTop = doneScroll;
  if (windowScrollY > 0) window.scrollTo({ top: windowScrollY, behavior: 'instant' });
}

/**
 * Builds HTML for a single task card.
 */
function createCardHtml(task) {
  const isBug = task.track === 'bug';
  const trackClass = `pill-track-${task.track}`;
  const trackIcon = getTrackIcon(task.track);

  // Context-aware action buttons
  let actionBtn = '';
  if (task.status === 'planned') {
    actionBtn = `<button class="btn-card-action" data-action="start" data-id="${task.id}" title="Move to In-Progress">⚡ Start</button>`;
  } else if (task.status === 'in-progress') {
    actionBtn = `<button class="btn-card-action" data-action="done" data-id="${task.id}" title="Mark as Done">✓ Done</button>`;
  } else {
    actionBtn = `<button class="btn-card-action" data-action="reopen" data-id="${task.id}" title="Reopen to In-Progress">↺ Reopen</button>`;
  }

  // Handle standalone tasks without design doc vs attached design doc
  let slugPill = '';
  if (task.design_slug) {
    const docColor = getDocColor(task.design_slug);
    const docCodename = getDocCodename(task.design_slug);
    const docMeta = (state.docs || []).find(d => d.slug === task.design_slug);
    const docTitle = docMeta?.title || task.design_slug;

    slugPill = `
      <div class="card-doc-pill-group" style="--doc-accent: ${docColor.accent}; --doc-bg: ${docColor.bg}; --doc-border: ${docColor.border}; --doc-text: ${docColor.text}; --doc-bg-hover: ${docColor.bgHover}; --doc-glow: ${docColor.glow};">
        <button type="button" class="card-doc-pill" data-action="read-doc" data-slug="${escapeHtml(task.design_slug)}" title="Read Design Doc: ${escapeHtml(docTitle)}">
          <span class="card-doc-codename">${escapeHtml(docCodename)}</span>
          <span class="card-doc-slug">${escapeHtml(task.design_slug)}</span>
        </button>
        <button type="button" class="card-doc-filter-btn" data-action="filter-doc" data-slug="${escapeHtml(task.design_slug)}" title="Filter Kanban to: ${escapeHtml(task.design_slug)}">🔍</button>
      </div>`;
  } else {
    slugPill = `<button type="button" class="pill pill-standalone" data-action="filter-doc" data-slug="standalone" title="Filter to Standalone Tasks" style="cursor: pointer;">⚡ Standalone</button>`;
  }

  return `
    <article class="task-card ${isBug ? 'is-bug' : ''}" data-id="${task.id}" tabindex="0">
      <div class="card-top">
        <div class="card-id-track">
          <span class="card-id">#${task.id}</span>
          <span class="pill ${trackClass}">${trackIcon} ${escapeHtml(task.track)}</span>
        </div>
      </div>

      <h3 class="card-title">${escapeHtml(task.title)}</h3>

      <div class="card-footer">
        ${slugPill}
        <div class="card-actions">
          ${actionBtn}
        </div>
      </div>
    </article>
  `;
}

/**
 * Renders the primary Roadmap view.
 * Groups tasks by design doc into rich collapsible swimlanes with progress, specs, and status columns.
 */
function renderSwimlanes(tasks) {
  if (!dom.swimlanesList) return;

  // 0. Preserve column and window scroll offsets before DOM replacement
  const scrollOffsets = new Map();
  dom.swimlanesList.querySelectorAll('.doc-swimlane').forEach(lane => {
    const slug = lane.dataset.slug || 'standalone';
    lane.querySelectorAll('.swimlane-col').forEach(col => {
      const colStatus = col.dataset.colStatus || 'col';
      const list = col.querySelector('.swimlane-card-list');
      if (list && list.scrollTop > 0) {
        scrollOffsets.set(`${slug}__${colStatus}`, list.scrollTop);
      }
    });
  });
  const windowScrollY = window.scrollY || document.documentElement.scrollTop;

  // 1. Collect all known design doc slugs
  const allDocs = state.docs || [];
  const docSlugs = new Set();

  allDocs.forEach(d => {
    const isFinished = isDocFinished(d);
    if (state.activeDocStatusFilter === 'open' && isFinished) return;
    if (state.activeDocStatusFilter === 'closed' && !isFinished) return;
    if (state.activeDocFilter === 'all' || state.activeDocFilter === d.slug) {
      docSlugs.add(d.slug);
    }
  });

  // Also include any slug present in state.tasks that isn't empty/standalone
  (state.tasks || []).forEach(t => {
    if (t.design_slug && t.design_slug.trim() && t.design_slug.toLowerCase() !== 'standalone') {
      const slug = t.design_slug.trim();
      const isFinished = isDocFinished(slug);
      if (state.activeDocStatusFilter === 'open' && isFinished) return;
      if (state.activeDocStatusFilter === 'closed' && !isFinished) return;
      if (state.activeDocFilter === 'all' || state.activeDocFilter === slug) {
        docSlugs.add(slug);
      }
    }
  });

  const swimlanesHtml = [];

  // 2. Render each Design Doc Swimlane
  for (const slug of docSlugs) {
    const docMeta = (state.docs || []).find(d => d.slug === slug);
    const title = docMeta?.title || slug;
    const status = docMeta?.status || 'Active';
    const docColor = getDocColor(slug);
    const docCodename = getDocCodename(slug);

    // Aggregate stats across all tasks for this doc
    const allDocTasks = state.tasks.filter(t => t.design_slug === slug);
    const totalCount = allDocTasks.length;
    const doneCount = allDocTasks.filter(t => t.status === 'done').length;
    const openBugs = allDocTasks.filter(t => t.track === 'bug' && t.status !== 'done').length;
    const progressPct = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

    // Filtered tasks matching active track/mode/search filters
    const docFilteredTasks = tasks.filter(t => t.design_slug === slug);
    const planned = docFilteredTasks.filter(t => t.status === 'planned');
    const inProgress = docFilteredTasks.filter(t => t.status === 'in-progress');
    const done = docFilteredTasks.filter(t => t.status === 'done');
    const isDoneColCollapsed = isDoneCollapsed(slug);

    const bugBadge = openBugs > 0 ? `<span class="pill pill-track-bug">🐛 ${openBugs} bug(s)</span>` : '';

    swimlanesHtml.push(`
      <div class="doc-swimlane" data-slug="${escapeHtml(slug)}" style="border-left: 3px solid ${docColor.accent};">
        <div class="swimlane-header">
          <div class="swimlane-info">
            <button class="swimlane-toggle-btn" title="Toggle Swimlane" aria-label="Toggle Swimlane">▼</button>
            <span class="doc-codename-badge" style="background: ${docColor.bg}; color: ${docColor.accent}; border: 1px solid ${docColor.border};">${escapeHtml(docCodename)}</span>
            <h3 class="swimlane-title" data-action="read-doc" data-slug="${escapeHtml(slug)}" title="Click to Read Design Doc">
              ${escapeHtml(title)}
            </h3>
            <span class="swimlane-slug">${escapeHtml(slug)}</span>
            <span class="pill pill-track-core">${escapeHtml(status)}</span>
            ${bugBadge}
          </div>

          <div class="swimlane-stats">
            <span class="pill" style="background: var(--bg-card); font-family: var(--font-mono);">${doneCount}/${totalCount} done (${progressPct}%)</span>
            <div class="swimlane-progress-wrap" title="${progressPct}% completed">
              <div class="swimlane-progress-bar" style="width: ${progressPct}%; background: ${docColor.accent};"></div>
            </div>
            <div class="swimlane-actions">
              <button class="btn btn-secondary btn-sm" data-action="read-doc" data-slug="${escapeHtml(slug)}" title="Read Design Doc in Reader">
                <span>📄</span> Read Design Doc
              </button>
              <button class="btn btn-primary btn-sm" data-action="cut-task-for-doc" data-slug="${escapeHtml(slug)}" title="Cut Task from this Design Doc">
                <span>+</span> Cut Task
              </button>
            </div>
          </div>
        </div>

        <div class="swimlane-columns">
          <div class="swimlane-col" data-col-status="planned">
            <div class="swimlane-col-header">
              <span class="swimlane-col-title"><span class="status-indicator status-planned"></span> Planned</span>
              <span class="col-count">${planned.length}</span>
            </div>
            <div class="swimlane-card-list">
              ${planned.length > 0 ? planned.map(createCardHtml).join('') : '<div class="swimlane-empty">No planned tasks</div>'}
            </div>
          </div>

          <div class="swimlane-col" data-col-status="in-progress">
            <div class="swimlane-col-header">
              <span class="swimlane-col-title"><span class="status-indicator status-in-progress"></span> In Progress</span>
              <span class="col-count">${inProgress.length}</span>
            </div>
            <div class="swimlane-card-list">
              ${inProgress.length > 0 ? inProgress.map(createCardHtml).join('') : '<div class="swimlane-empty">No tasks in progress</div>'}
            </div>
          </div>

          <div class="swimlane-col swimlane-col-done ${isDoneColCollapsed ? 'is-collapsed' : ''}" data-col-status="done">
            <div class="swimlane-col-header is-clickable" data-action="toggle-done-col" data-slug="${escapeHtml(slug)}" title="Click to ${isDoneColCollapsed ? 'expand' : 'collapse'} Done column">
              <span class="swimlane-col-title"><span class="status-indicator status-done"></span> Done</span>
              <div class="col-header-right">
                <span class="col-count">${done.length}</span>
                <button type="button" class="col-collapse-btn" data-action="toggle-done-col" data-slug="${escapeHtml(slug)}" title="${isDoneColCollapsed ? 'Expand Done column' : 'Collapse Done column'}">
                  ${isDoneColCollapsed ? '▸' : '▾'}
                </button>
              </div>
            </div>
            ${isDoneColCollapsed ? `
              <div class="done-collapsed-preview" data-action="toggle-done-col" data-slug="${escapeHtml(slug)}" title="Click to expand ${done.length} completed task(s)">
                <div class="done-preview-info">
                  <span class="done-preview-check">✓</span>
                  <span class="done-preview-text">${done.length} task${done.length === 1 ? '' : 's'} completed</span>
                </div>
                <button type="button" class="btn-preview-expand" data-action="toggle-done-col" data-slug="${escapeHtml(slug)}">Show ▾</button>
              </div>
            ` : `
              <div class="swimlane-card-list">
                ${done.length > 0 ? done.map(createCardHtml).join('') : '<div class="swimlane-empty">No completed tasks</div>'}
              </div>
              ${done.length > 2 ? `
                <div class="done-collapse-footer">
                  <button type="button" class="btn-collapse-done-footer" data-action="toggle-done-col" data-slug="${escapeHtml(slug)}">
                    ▴ Collapse Done (${done.length})
                  </button>
                </div>
              ` : ''}
            `}
          </div>
        </div>
      </div>
    `);
  }

  // 3. Render Standalone Tasks & Ad-hoc Bugs Swimlane
  const allStandalone = state.tasks.filter(t => !t.design_slug || t.design_slug.trim().toLowerCase() === 'standalone');
  const standaloneFiltered = tasks.filter(t => !t.design_slug || t.design_slug.trim().toLowerCase() === 'standalone');

  const sPlanned = standaloneFiltered.filter(t => t.status === 'planned');
  const sInProgress = standaloneFiltered.filter(t => t.status === 'in-progress');
  const sDone = standaloneFiltered.filter(t => t.status === 'done');

  const sTotal = allStandalone.length;
  const sDoneCount = allStandalone.filter(t => t.status === 'done').length;
  const sBugs = allStandalone.filter(t => t.track === 'bug' && t.status !== 'done').length;
  const sProgress = sTotal === 0 ? 0 : Math.round((sDoneCount / sTotal) * 100);
  const sBugBadge = sBugs > 0 ? `<span class="pill pill-track-bug">🐛 ${sBugs} bug(s)</span>` : '';

  swimlanesHtml.push(`
    <div class="doc-swimlane swimlane-standalone" data-slug="standalone">
      <div class="swimlane-header">
        <div class="swimlane-info">
          <button class="swimlane-toggle-btn" title="Toggle Swimlane" aria-label="Toggle Swimlane">▼</button>
          <h3 class="swimlane-title" style="cursor: default;">
            ⚡ Standalone Tasks & Ad-hoc Bugs
          </h3>
          <span class="pill pill-standalone">Unassigned</span>
          ${sBugBadge}
        </div>

        <div class="swimlane-stats">
          <span class="pill" style="background: var(--bg-card); font-family: var(--font-mono);">${sDoneCount}/${sTotal} done (${sProgress}%)</span>
          <div class="swimlane-progress-wrap" title="${sProgress}% completed">
            <div class="swimlane-progress-bar" style="width: ${sProgress}%;"></div>
          </div>
          <div class="swimlane-actions">
            <button class="btn btn-primary btn-sm" data-action="cut-standalone-task">
              <span>+</span> New Standalone Task
            </button>
          </div>
        </div>
      </div>

      <div class="swimlane-columns">
        <div class="swimlane-col" data-col-status="planned">
          <div class="swimlane-col-header">
            <span class="swimlane-col-title"><span class="status-indicator status-planned"></span> Planned</span>
            <span class="col-count">${sPlanned.length}</span>
          </div>
          <div class="swimlane-card-list">
            ${sPlanned.length > 0 ? sPlanned.map(createCardHtml).join('') : '<div class="swimlane-empty">No planned tasks</div>'}
          </div>
        </div>

        <div class="swimlane-col" data-col-status="in-progress">
          <div class="swimlane-col-header">
            <span class="swimlane-col-title"><span class="status-indicator status-in-progress"></span> In Progress</span>
            <span class="col-count">${sInProgress.length}</span>
          </div>
          <div class="swimlane-card-list">
            ${sInProgress.length > 0 ? sInProgress.map(createCardHtml).join('') : '<div class="swimlane-empty">No tasks in progress</div>'}
          </div>
        </div>

        <div class="swimlane-col swimlane-col-done ${isDoneCollapsed('standalone') ? 'is-collapsed' : ''}" data-col-status="done">
          <div class="swimlane-col-header is-clickable" data-action="toggle-done-col" data-slug="standalone" title="Click to ${isDoneCollapsed('standalone') ? 'expand' : 'collapse'} Done column">
            <span class="swimlane-col-title"><span class="status-indicator status-done"></span> Done</span>
            <div class="col-header-right">
              <span class="col-count">${sDone.length}</span>
              <button type="button" class="col-collapse-btn" data-action="toggle-done-col" data-slug="standalone" title="${isDoneCollapsed('standalone') ? 'Expand Done column' : 'Collapse Done column'}">
                ${isDoneCollapsed('standalone') ? '▸' : '▾'}
              </button>
            </div>
          </div>
          ${isDoneCollapsed('standalone') ? `
            <div class="done-collapsed-preview" data-action="toggle-done-col" data-slug="standalone" title="Click to expand ${sDone.length} completed task(s)">
              <div class="done-preview-info">
                <span class="done-preview-check">✓</span>
                <span class="done-preview-text">${sDone.length} task${sDone.length === 1 ? '' : 's'} completed</span>
              </div>
              <button type="button" class="btn-preview-expand" data-action="toggle-done-col" data-slug="standalone">Show ▾</button>
            </div>
          ` : `
            <div class="swimlane-card-list">
              ${sDone.length > 0 ? sDone.map(createCardHtml).join('') : '<div class="swimlane-empty">No completed tasks</div>'}
            </div>
            ${sDone.length > 2 ? `
              <div class="done-collapse-footer">
                <button type="button" class="btn-collapse-done-footer" data-action="toggle-done-col" data-slug="standalone">
                  ▴ Collapse Done (${sDone.length})
                </button>
              </div>
            ` : ''}
          `}
        </div>
      </div>
    </div>
  `);

  dom.swimlanesList.innerHTML = swimlanesHtml.join('');

  // 4. Restore column and window scroll offsets
  dom.swimlanesList.querySelectorAll('.doc-swimlane').forEach(lane => {
    const slug = lane.dataset.slug || 'standalone';
    lane.querySelectorAll('.swimlane-col').forEach(col => {
      const colStatus = col.dataset.colStatus || 'col';
      const key = `${slug}__${colStatus}`;
      if (scrollOffsets.has(key)) {
        const list = col.querySelector('.swimlane-card-list');
        if (list) list.scrollTop = scrollOffsets.get(key);
      }
    });
  });

  if (windowScrollY > 0) {
    window.scrollTo({ top: windowScrollY, behavior: 'instant' });
  }
}

/**
 * Renders the Design Documents view.
 */
function renderDocs() {
  const windowScrollY = window.scrollY || document.documentElement.scrollTop;
  const docs = state.docs || [];
  const totalCount = docs.length;
  const finishedCount = docs.filter(isDocFinished).length;
  const activeCount = totalCount - finishedCount;

  if (dom.countDocsAll) dom.countDocsAll.textContent = totalCount;
  if (dom.countDocsActive) dom.countDocsActive.textContent = activeCount;
  if (dom.countDocsFinished) dom.countDocsFinished.textContent = finishedCount;

  // Filter docs based on active catalog tab
  let displayDocs = docs;
  if (state.activeDocsFilter === 'active') {
    displayDocs = docs.filter(isDocActive);
  } else if (state.activeDocsFilter === 'finished') {
    displayDocs = docs.filter(isDocFinished);
  }

  if (displayDocs.length === 0) {
    const filterMsg = state.activeDocsFilter === 'finished'
      ? 'No finished design documents yet.'
      : state.activeDocsFilter === 'active'
      ? 'No active design documents found.'
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
    const bugPill = stats.openBugs > 0 ? `<span class="pill pill-track-bug">🐛 ${stats.openBugs} open</span>` : '';
    const isFinished = isDocFinished(doc);
    const statusPillClass = isFinished ? 'pill-finished' : 'pill-track-core';
    const statusText = isFinished ? 'Finished ✓' : escapeHtml(doc.status || 'Draft');
    const docColor = getDocColor(doc);
    const docCodename = getDocCodename(doc);

    return `
      <article class="doc-card ${isFinished ? 'is-finished' : ''}" data-slug="${doc.slug}" style="border-top: 3px solid ${docColor.accent};">
        <div class="doc-card-top">
          <div class="doc-icon-slug">
            <span class="doc-codename-badge" style="background: ${docColor.bg}; color: ${docColor.accent}; border: 1px solid ${docColor.border};">${escapeHtml(docCodename)}</span>
            <span class="doc-slug">${escapeHtml(doc.slug)}</span>
          </div>
          <span class="pill ${statusPillClass}">${statusText}</span>
        </div>

        <h3 class="doc-title">${escapeHtml(doc.title)}</h3>

        <div class="doc-meta-row">
          <span>👤 ${escapeHtml(doc.author || 'manager-pm')}</span>
          ${doc.lastUpdated ? `<span>📅 ${escapeHtml(doc.lastUpdated)}</span>` : ''}
          ${bugPill}
        </div>

        <div class="doc-progress-section">
          <div class="doc-progress-stats">
            <span style="font-weight: 600; color: var(--text-primary);">${stats.done}/${stats.total} tasks complete</span>
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

/**
 * Lightweight, zero-dependency Markdown-to-HTML parser for Design Docs.
 */
function renderMarkdown(md) {
  if (!md) return '<p>No content.</p>';

  let html = escapeHtml(md);

  // 1. Code blocks with language
  html = html.replace(/```([a-z0-9_\-]+)?\n([\s\S]*?)```/gi, (match, lang, code) => {
    return `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
  });

  // 2. Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 3. Headings
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // 4. Horizontal rules
  html = html.replace(/^---$/gim, '<hr>');

  // 5. Blockquotes & Alerts
  html = html.replace(/^&gt;\s+\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n((?:&gt;.*(?:\n|$))*)/gim, (match, type, body) => {
    const cleanBody = body.replace(/^&gt;\s?/gm, '').trim();
    return `<blockquote class="alert alert-${type.toLowerCase()}"><strong>${type}</strong>: ${cleanBody}</blockquote>`;
  });
  html = html.replace(/^&gt;\s+(.*$)/gim, '<blockquote>$1</blockquote>');

  // 6. Interactive Checklists (- [x] / - [ ])
  let checklistIdx = 0;
  html = html.replace(/^[-*]\s+\[(x|X)\]\s+(.*$)/gim, (match, mark, text) => {
    const idx = checklistIdx++;
    return `<li class="task-item checked" data-checklist-idx="${idx}"><span class="checklist-check-icon">☑</span><span class="checklist-text">${text}</span></li>`;
  });
  html = html.replace(/^[-*]\s+\[\s?\]\s+(.*$)/gim, (match, text) => {
    const idx = checklistIdx++;
    return `<li class="task-item" data-checklist-idx="${idx}"><span class="checklist-check-icon">☐</span><span class="checklist-text">${text}</span></li>`;
  });

  // 7. Standard Lists
  html = html.replace(/^[-*]\s+(.*$)/gim, '<li>$1</li>');

  // 8. Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 9. Tables
  html = html.replace(/((?:\|.*\|\r?\n)+)/g, (match) => {
    const rows = match.trim().split('\n');
    let tableHtml = '<table>';
    let isHeader = true;

    for (const r of rows) {
      if (/^\|\s*[-:]+[-| :]*\|$/.test(r.trim())) {
        isHeader = false;
        continue;
      }
      const cells = r.split('|').slice(1, -1);
      const tag = isHeader ? 'th' : 'td';
      tableHtml += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
    }
    tableHtml += '</table>';
    return tableHtml;
  });

  // 10. Paragraphs
  html = html.replace(/\n\n+/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean empty paragraphs around tags
  html = html.replace(/<p>\s*<(h[1-4]|pre|blockquote|table|hr|li)/gi, '<$1');
  html = html.replace(/<\/(h[1-4]|pre|blockquote|table|hr|li)>\s*<\/p>/gi, '</$1>');

  return html;
}

/**
 * Opens the Design Doc Reader drawer.
 */
async function openDocReader(slug) {
  try {
    const res = await fetch(`/api/docs/${slug}`);
    if (!res.ok) throw new Error(`Document "${slug}" not found`);

    const data = await res.json();
    const doc = data.doc;
    state.activeDoc = doc;

    const isFinished = isDocFinished(doc);
    const docColor = getDocColor(doc);
    const docCodename = getDocCodename(doc);
    dom.readerTitle.innerHTML = `<span class="doc-codename-badge" style="background: ${docColor.bg}; color: ${docColor.accent}; border: 1px solid ${docColor.border}; margin-right: 0.5rem;">${escapeHtml(docCodename)}</span>${escapeHtml(doc.title || doc.slug)}`;
    dom.readerStatusPill.textContent = isFinished ? 'Finished ✓' : (doc.status || 'Draft');
    dom.readerStatusPill.className = `pill ${isFinished ? 'pill-finished' : 'pill-track-core'}`;
    dom.readerAuthor.textContent = doc.author ? `by ${doc.author}` : '';

    if (dom.readerFinishDocBtn) {
      dom.readerFinishDocBtn.style.display = isFinished ? 'none' : 'inline-flex';
      dom.readerFinishDocBtn.dataset.slug = doc.slug;
    }
    if (dom.readerReopenDocBtn) {
      dom.readerReopenDocBtn.style.display = isFinished ? 'inline-flex' : 'none';
      dom.readerReopenDocBtn.dataset.slug = doc.slug;
    }

    // Render markdown prose
    dom.readerProse.innerHTML = renderMarkdown(doc.content);

    // Render attached tasks in sidebar
    const tasks = doc.tasks || [];
    dom.readerTaskCount.textContent = tasks.length;
    dom.readerTaskList.innerHTML = tasks.length > 0
      ? tasks.map(t => {
          const isDone = t.status === 'done';
          return `
            <div class="task-card" data-id="${t.id}" style="padding: 0.75rem;">
              <div class="card-top">
                <span class="card-id">#${t.id}</span>
                <span class="pill pill-track-${t.track}">${getTrackIcon(t.track)} ${escapeHtml(t.track)}</span>
              </div>
              <div style="font-size: 0.82rem; font-weight: 600; color: ${isDone ? 'var(--text-muted)' : 'var(--text-primary)'};">${escapeHtml(t.title)}</div>
              <div class="card-footer" style="margin-top: 0.2rem; padding-top: 0.35rem;">
                <span style="font-family: var(--font-mono); font-size: 0.7rem; color: ${isDone ? 'var(--status-done)' : 'var(--status-in-progress)'};">
                  ${isDone ? '✓ DONE' : t.status === 'in-progress' ? '⚡ IN-PROGRESS' : '⏳ PLANNED'}
                </span>
              </div>
            </div>
          `;
        }).join('')
      : '<p style="color: var(--text-muted); font-size: 0.8rem; padding: 0.5rem;">No tasks cut from this design doc yet.</p>';

    dom.docReaderDrawer.classList.add('open');
    dom.docReaderDrawer.setAttribute('aria-hidden', 'false');
  } catch (err) {
    showToast(`Error opening design doc: ${err.message}`, 'error');
  }
}

/**
 * Closes the Design Doc Reader drawer.
 */
function closeDocReader() {
  dom.docReaderDrawer.classList.remove('open');
  dom.docReaderDrawer.setAttribute('aria-hidden', 'true');
  state.activeDoc = null;
}

function updateDrawerDocWidget(slug) {
  if (!slug) {
    dom.drawerDocWidget.style.display = 'none';
    return;
  }
  const doc = (state.docs || []).find(d => d.slug === slug);
  dom.drawerDocWidget.style.display = 'block';
  dom.drawerDocTitle.textContent = doc ? doc.title : slug;
  dom.drawerDocSub.textContent = doc
    ? `${doc.status || 'Active'} · ${doc.author ? 'by ' + doc.author : 'Incubator v5'}`
    : 'Design Document';
  dom.btnOpenDocFromTask.onclick = (e) => {
    e.preventDefault();
    openDocReader(slug);
  };
}

/**
 * Renders the task plan into the preview box and synchronizes the editor.
 */
function renderDrawerPlan(details) {
  const content = details && details.trim() ? details.trim() : '<p style="color: var(--text-muted); font-style: italic;">No plan or checklist recorded for this task.</p>';
  dom.drawerPlanContent.innerHTML = renderMarkdown(content);
  dom.drawerDetailsInput.value = details || '';
}

/**
 * Toggles between Interactive Plan view and Markdown Edit view.
 */
function setPlanTab(tab) {
  if (tab === 'interactive') {
    dom.tabPlanInteractive.classList.add('active');
    dom.tabPlanEdit.classList.remove('active');
    dom.drawerPlanPreview.style.display = 'block';
    dom.drawerPlanEditorWrap.style.display = 'none';
    // Sync any edits made in markdown textarea to preview
    renderDrawerPlan(dom.drawerDetailsInput.value);
  } else {
    dom.tabPlanInteractive.classList.remove('active');
    dom.tabPlanEdit.classList.add('active');
    dom.drawerPlanPreview.style.display = 'none';
    dom.drawerPlanEditorWrap.style.display = 'flex';
    dom.drawerDetailsInput.focus();
  }
}

/**
 * Toggles a checklist item directly when clicked in the interactive plan view.
 */
async function toggleTaskChecklistItem(itemIndex) {
  if (!state.selectedTaskId) return;

  try {
    const res = await fetch(`/api/tasks/${state.selectedTaskId}/toggle-checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: itemIndex })
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    const updatedTask = data.task;

    // Update local task state
    const taskIdx = state.tasks.findIndex(t => t.id === updatedTask.id);
    if (taskIdx !== -1) {
      state.tasks[taskIdx] = updatedTask;
    }

    renderDrawerPlan(updatedTask.details);
    showToast(`Checklist updated`, 'info');
  } catch (err) {
    showToast(`Failed to update checklist: ${err.message}`, 'error');
  }
}

/**
 * Opens task drawer for inspecting or editing.
 */
function openDrawer(taskId) {
  const task = state.tasks.find(t => t.id === Number(taskId));
  if (!task) return;

  state.selectedTaskId = task.id;

  dom.drawerId.textContent = `#${task.id}`;
  dom.drawerTrackBadge.textContent = `${getTrackIcon(task.track)} ${task.track}`;
  dom.drawerTrackBadge.className = `pill pill-track-${task.track}`;

  dom.drawerTitleInput.value = task.title || '';
  dom.drawerStatusSelect.value = task.status || 'planned';
  populateTrackSelect(dom.drawerTrackSelect, task.track || 'core');
  
  // Render Task Plan & Checklist (default to interactive view)
  renderDrawerPlan(task.details);
  setPlanTab('interactive');

  // Populate doc select options
  const docSlugs = new Set((state.docs || []).map(d => d.slug));
  if (task.design_slug && task.design_slug.trim()) {
    docSlugs.add(task.design_slug.trim());
  }

  let optionsHtml = '<option value="">-- None (Standalone Task / Bug) --</option>';
  for (const slug of docSlugs) {
    const doc = (state.docs || []).find(d => d.slug === slug);
    const title = doc ? `${doc.title} (${slug})` : slug;
    optionsHtml += `<option value="${escapeHtml(slug)}">${escapeHtml(title)}</option>`;
  }
  dom.drawerDocSelect.innerHTML = optionsHtml;
  dom.drawerDocSelect.value = task.design_slug || '';

  updateDrawerDocWidget(task.design_slug);
  dom.drawerDocSelect.onchange = () => updateDrawerDocWidget(dom.drawerDocSelect.value);

  dom.drawerCreatedAt.textContent = task.created_at || '--';
  dom.drawerUpdatedAt.textContent = task.updated_at || '--';

  dom.taskDrawer.classList.add('open');
  dom.taskDrawer.setAttribute('aria-hidden', 'false');
}

/**
 * Closes the slide-over task drawer.
 */
function closeDrawer() {
  dom.taskDrawer.classList.remove('open');
  dom.taskDrawer.setAttribute('aria-hidden', 'true');
  state.selectedTaskId = null;
}

/**
 * Saves edits made in the task drawer.
 */
async function saveDrawerTask() {
  if (!state.selectedTaskId) return;

  const payload = {
    title: dom.drawerTitleInput.value.trim(),
    status: dom.drawerStatusSelect.value,
    track: dom.drawerTrackSelect.value,
    design_slug: dom.drawerDocSelect.value.trim() || null,
    details: dom.drawerDetailsInput.value.trim()
  };

  try {
    const res = await fetch(`/api/tasks/${state.selectedTaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    showToast(`Updated Task #${state.selectedTaskId}`, 'success');
    closeDrawer();
    fetchData(true);
  } catch (err) {
    showToast(`Failed to update task: ${err.message}`, 'error');
  }
}

/**
 * Deletes the task currently opened in the drawer.
 */
async function deleteDrawerTask() {
  if (!state.selectedTaskId) return;
  if (!confirm(`Are you sure you want to delete Task #${state.selectedTaskId}?`)) return;

  try {
    const res = await fetch(`/api/tasks/${state.selectedTaskId}`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    showToast(`Deleted Task #${state.selectedTaskId}`, 'info');
    closeDrawer();
    fetchData(true);
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}

/**
 * Quick status transition from card action buttons.
 */
async function quickUpdateStatus(taskId, newStatus) {
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    showToast(`Task #${taskId} moved to ${newStatus}`, 'success');
    fetchData(true);
  } catch (err) {
    showToast(`Update error: ${err.message}`, 'error');
  }
}

/**
 * Populates a track <select> element with standard tracks, discovered board tracks,
 * and preserves selected/custom tracks.
 */
function populateTrackSelect(selectElement, selectedTrack = '') {
  if (!selectElement) return;

  const tracks = new Map();
  // 1. Industry standard tracks
  for (const item of INDUSTRY_TRACKS) {
    tracks.set(item.id, item.label);
  }

  // 2. Tracks discovered from board tasks
  (state.tasks || []).forEach(t => {
    if (t.track && !tracks.has(t.track)) {
      tracks.set(t.track, t.track);
    }
  });

  // 3. Current selectedTrack if custom
  if (selectedTrack && !tracks.has(selectedTrack)) {
    tracks.set(selectedTrack, selectedTrack);
  }

  let html = '';
  for (const [id, label] of tracks.entries()) {
    const icon = getTrackIcon(id);
    const displayLabel = icon ? `${icon} ${label}` : label;
    html += `<option value="${escapeHtml(id)}">${escapeHtml(displayLabel)}</option>`;
  }
  html += '<option value="__custom__">➕ Custom track...</option>';

  selectElement.innerHTML = html;
  selectElement.value = selectedTrack || 'core';
}

/**
 * Handles custom track entry if user chooses '+ Custom track...'.
 */
function handleTrackSelectChange(selectElement) {
  if (selectElement.value === '__custom__') {
    const custom = window.prompt('Enter custom track name (e.g. billing, ai, security):');
    const sanitized = custom ? custom.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') : '';
    if (sanitized) {
      // Add custom option right before '__custom__'
      const opt = document.createElement('option');
      opt.value = sanitized;
      opt.textContent = sanitized;
      selectElement.insertBefore(opt, selectElement.lastElementChild);
      selectElement.value = sanitized;
    } else {
      selectElement.value = 'core';
    }
  }
}

/**
 * Opens task creation modal.
 */
function openModal(isBug = false, defaultSlug = '') {
  dom.modalTitle.textContent = isBug ? '🐛 Log a Bug' : 'Create New Task';
  dom.taskTitleInput.value = '';
  dom.taskDetailsInput.value = '';
  dom.taskStatusSelect.value = 'planned';

  const defaultTrack = isBug ? 'bug' : 'core';
  populateTrackSelect(dom.taskTrackSelect, defaultTrack);

  // Populate doc select options: only active design docs
  const docSlugs = new Set((state.docs || []).filter(isDocActive).map(d => d.slug));
  if (defaultSlug && defaultSlug.trim()) {
    docSlugs.add(defaultSlug.trim());
  }

  let optionsHtml = '<option value="">-- None (Standalone Task / Bug) --</option>';
  for (const slug of docSlugs) {
    const doc = (state.docs || []).find(d => d.slug === slug);
    const title = doc ? `${doc.title} (${slug})` : slug;
    optionsHtml += `<option value="${escapeHtml(slug)}">${escapeHtml(title)}</option>`;
  }
  dom.taskDocSelect.innerHTML = optionsHtml;
  dom.taskDocSelect.value = defaultSlug || '';

  dom.taskDialog.showModal();
  dom.taskTitleInput.focus();
}

/**
 * Closes modal dialog.
 */
function closeModal() {
  dom.taskDialog.close();
}

/**
 * Handles submission of new task or bug.
 */
async function handleTaskFormSubmit(e) {
  e.preventDefault();

  const payload = {
    title: dom.taskTitleInput.value.trim(),
    design_slug: dom.taskDocSelect.value.trim() || null,
    track: dom.taskTrackSelect.value,
    status: dom.taskStatusSelect.value,
    details: dom.taskDetailsInput.value.trim()
  };

  if (!payload.title) return;

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();

    closeModal();
    showToast(`Created Task #${data.task?.id || ''}`, 'success');
    fetchData(true);
  } catch (err) {
    showToast(`Failed to create task: ${err.message}`, 'error');
  }
}

/**
 * Helper to escape HTML and prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Setup event listeners and keyboard shortcuts.
 */
function bindEvents() {
  // Search input
  dom.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    render();
  });

  // Helper to close all custom filter dropdowns
  function closeAllDropdowns() {
    if (dom.trackDropdownMenu) dom.trackDropdownMenu.classList.remove('is-open');
    if (dom.trackDropdownTrigger) dom.trackDropdownTrigger.setAttribute('aria-expanded', 'false');
    if (dom.docStatusDropdownMenu) dom.docStatusDropdownMenu.classList.remove('is-open');
    if (dom.docStatusDropdownTrigger) dom.docStatusDropdownTrigger.setAttribute('aria-expanded', 'false');
    if (dom.docDropdownMenu) dom.docDropdownMenu.classList.remove('is-open');
    if (dom.docDropdownTrigger) dom.docDropdownTrigger.setAttribute('aria-expanded', 'false');
    if (dom.kanbanDocDropdownMenu) dom.kanbanDocDropdownMenu.classList.remove('is-open');
    if (dom.kanbanDocDropdownTrigger) dom.kanbanDocDropdownTrigger.setAttribute('aria-expanded', 'false');
  }

  // Custom Track Dropdown Trigger
  if (dom.trackDropdownTrigger && dom.trackDropdownMenu) {
    dom.trackDropdownTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dom.trackDropdownMenu.classList.contains('is-open');
      closeAllDropdowns();
      if (!isOpen) {
        dom.trackDropdownMenu.classList.add('is-open');
        dom.trackDropdownTrigger.setAttribute('aria-expanded', 'true');
      }
    });

    dom.trackDropdownMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item || !item.dataset.value) return;
      state.activeTrack = item.dataset.value;
      closeAllDropdowns();
      render();
    });
  }

  // Custom Doc Status Dropdown Trigger (Toolbar)
  if (dom.docStatusDropdownTrigger && dom.docStatusDropdownMenu) {
    dom.docStatusDropdownTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dom.docStatusDropdownMenu.classList.contains('is-open');
      closeAllDropdowns();
      if (!isOpen) {
        dom.docStatusDropdownMenu.classList.add('is-open');
        dom.docStatusDropdownTrigger.setAttribute('aria-expanded', 'true');
      }
    });

    dom.docStatusDropdownMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item || !item.dataset.value) return;
      setDocStatusFilter(item.dataset.value);
      closeAllDropdowns();
    });
  }

  // Custom Design Doc Dropdown Trigger (Toolbar)
  if (dom.docDropdownTrigger && dom.docDropdownMenu) {
    dom.docDropdownTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dom.docDropdownMenu.classList.contains('is-open');
      closeAllDropdowns();
      if (!isOpen) {
        dom.docDropdownMenu.classList.add('is-open');
        dom.docDropdownTrigger.setAttribute('aria-expanded', 'true');
      }
    });

    dom.docDropdownMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item || !item.dataset.value) return;
      setDocFilter(item.dataset.value);
      closeAllDropdowns();
    });
  }

  // Custom Design Doc Dropdown Trigger (Kanban Bar)
  if (dom.kanbanDocDropdownTrigger && dom.kanbanDocDropdownMenu) {
    dom.kanbanDocDropdownTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dom.kanbanDocDropdownMenu.classList.contains('is-open');
      closeAllDropdowns();
      if (!isOpen) {
        dom.kanbanDocDropdownMenu.classList.add('is-open');
        dom.kanbanDocDropdownTrigger.setAttribute('aria-expanded', 'true');
      }
    });

    dom.kanbanDocDropdownMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item || !item.dataset.value) return;
      setDocFilter(item.dataset.value);
      closeAllDropdowns();
    });
  }

  // Close dropdowns on outside click or Escape
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown')) {
      closeAllDropdowns();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllDropdowns();
    }
  });

  // Track dropdown filter (legacy select fallback)
  if (dom.filterTrackSelect) {
    dom.filterTrackSelect.addEventListener('change', (e) => {
      state.activeTrack = e.target.value;
      render();
    });
  }

  // Quick Bug filter toggle button
  if (dom.btnQuickFilterBugs) {
    dom.btnQuickFilterBugs.addEventListener('click', () => {
      state.activeTrack = state.activeTrack === 'bug' ? 'all' : 'bug';
      render();
    });
  }

  // Design Doc dropdown filter (legacy select fallback)
  if (dom.filterDocSelect) {
    dom.filterDocSelect.addEventListener('change', (e) => {
      setDocFilter(e.target.value);
    });
  }

  // Design Doc filter pills in Flat Kanban header
  if (dom.kanbanDocPills) {
    dom.kanbanDocPills.addEventListener('click', (e) => {
      const pill = e.target.closest('.kanban-doc-pill');
      if (!pill || !pill.dataset.doc) return;
      setDocFilter(pill.dataset.doc);
    });
  }

  // Clear filter button in active filter banner
  if (dom.btnKanbanClearFilter) {
    dom.btnKanbanClearFilter.addEventListener('click', () => {
      setDocFilter('all');
    });
  }

  // Toggle Done columns globally
  if (dom.btnToggleDone) {
    dom.btnToggleDone.addEventListener('click', () => {
      toggleAllDone();
    });
  }

  // Toggle All Swimlanes collapse/expand
  let allCollapsed = false;
  if (dom.btnToggleAllSwimlanes) {
    dom.btnToggleAllSwimlanes.addEventListener('click', () => {
      allCollapsed = !allCollapsed;
      document.querySelectorAll('.doc-swimlane').forEach(el => {
        el.classList.toggle('is-collapsed', allCollapsed);
      });
      dom.btnToggleAllSwimlanes.querySelector('span').textContent = allCollapsed ? '↕' : '↕';
    });
  }

  // Refresh button
  dom.btnRefresh.addEventListener('click', () => fetchData(false));

  // View toggles

  if (dom.viewFleetBtn) dom.viewFleetBtn.addEventListener('click', () => setView('fleet'));
  dom.viewSwimlanesBtn.addEventListener('click', () => setView('swimlanes'));
  dom.viewKanbanBtn.addEventListener('click', () => setView('kanban'));
  dom.viewDocsBtn.addEventListener('click', () => setView('docs'));

  // Agent Switcher Dropdown Interaction
  if (dom.agentSwitcherBtn) {
    dom.agentSwitcherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dom.agentSwitcherDropdown.classList.toggle('is-open');
      if (dom.agentDropdownMenu) {
        dom.agentDropdownMenu.style.display = isOpen ? 'block' : 'none';
      }
    });
  }

  // Project Switcher Dropdown Interaction
  if (dom.projectSwitcherBtn) {
    dom.projectSwitcherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dom.projectSwitcherDropdown.classList.toggle('is-open');
      if (dom.projectDropdownMenu) {
        dom.projectDropdownMenu.style.display = isOpen ? 'block' : 'none';
      }
    });
  }

  if (dom.btnMenuFleet) {
    dom.btnMenuFleet.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dom.agentSwitcherDropdown) dom.agentSwitcherDropdown.classList.remove('is-open');
      if (dom.agentDropdownMenu) dom.agentDropdownMenu.style.display = 'none';
      setView('fleet');
    });
  }

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (dom.agentSwitcherDropdown && !dom.agentSwitcherDropdown.contains(e.target)) {
      dom.agentSwitcherDropdown.classList.remove('is-open');
      if (dom.agentDropdownMenu) dom.agentDropdownMenu.style.display = 'none';
    }
    if (dom.projectSwitcherDropdown && !dom.projectSwitcherDropdown.contains(e.target)) {
      dom.projectSwitcherDropdown.classList.remove('is-open');
      if (dom.projectDropdownMenu) dom.projectDropdownMenu.style.display = 'none';
    }
  });

  // Agent selection from dropdown menu
  if (dom.agentMenuList) {
    dom.agentMenuList.addEventListener('click', (e) => {
      const item = e.target.closest('.agent-menu-item');
      if (item && item.dataset.agentId) {
        e.stopPropagation();
        if (dom.agentSwitcherDropdown) dom.agentSwitcherDropdown.classList.remove('is-open');
        if (dom.agentDropdownMenu) dom.agentDropdownMenu.style.display = 'none';
        switchAgent(item.dataset.agentId);
      }
    });
  }

  // Project selection from dropdown menu
  if (dom.projectMenuList) {
    dom.projectMenuList.addEventListener('click', (e) => {
      const item = e.target.closest('.project-menu-item');
      if (item && item.dataset.projectId) {
        e.stopPropagation();
        if (dom.projectSwitcherDropdown) dom.projectSwitcherDropdown.classList.remove('is-open');
        if (dom.projectDropdownMenu) dom.projectDropdownMenu.style.display = 'none';
        switchProject(item.dataset.projectId);
      }
    });
  }

  // Document Clicks Delegation
  document.addEventListener('click', (e) => {
    // Fleet Project Pill click
    const projPill = e.target.closest('.fleet-proj-pill');
    if (projPill && projPill.dataset.agentId && projPill.dataset.projectId) {
      e.stopPropagation();
      state.activeAgentId = projPill.dataset.agentId;
      state.activeProjectId = projPill.dataset.projectId;
      setView('swimlanes');
      fetchData(false);
      return;
    }

    // Fleet Inspect Agent button click
    const inspectBtn = e.target.closest('[data-action="inspect-agent"]');
    if (inspectBtn) {
      e.stopPropagation();
      switchAgent(inspectBtn.dataset.agentId);
      return;
    }


    // Quick action buttons on task cards
    const actionBtn = e.target.closest('.btn-card-action');
    if (actionBtn) {
      e.stopPropagation();
      const id = Number(actionBtn.dataset.id);
      const action = actionBtn.dataset.action;
      const nextStatus = action === 'start' ? 'in-progress' : action === 'done' ? 'done' : 'in-progress';
      quickUpdateStatus(id, nextStatus);
      return;
    }

    // Toggle Done column in swimlanes
    const toggleDoneBtn = e.target.closest('[data-action="toggle-done-col"]');
    if (toggleDoneBtn) {
      e.stopPropagation();
      toggleDoneCol(toggleDoneBtn.dataset.slug);
      return;
    }

    // Filter to doc action
    const filterDocBtn = e.target.closest('[data-action="filter-doc"]');
    if (filterDocBtn) {
      e.stopPropagation();
      setDocFilter(filterDocBtn.dataset.slug);
      return;
    }

    // Clickable doc pill on card -> open Doc Reader
    const docPill = e.target.closest('.card-doc-pill');
    if (docPill) {
      e.stopPropagation();
      openDocReader(docPill.dataset.slug);
      return;
    }

    // Swimlane collapse/expand toggle
    const toggleBtn = e.target.closest('.swimlane-toggle-btn');
    if (toggleBtn) {
      e.stopPropagation();
      const swimlane = toggleBtn.closest('.doc-swimlane');
      if (swimlane) swimlane.classList.toggle('is-collapsed');
      return;
    }

    // Swimlane cut task for doc
    const cutTaskBtn = e.target.closest('[data-action="cut-task-for-doc"]');
    if (cutTaskBtn) {
      e.stopPropagation();
      openModal(false, cutTaskBtn.dataset.slug);
      return;
    }

    // Swimlane cut standalone task
    const cutStandaloneBtn = e.target.closest('[data-action="cut-standalone-task"]');
    if (cutStandaloneBtn) {
      e.stopPropagation();
      openModal(false, '');
      return;
    }

    // Card click -> open task drawer
    const card = e.target.closest('.task-card');
    if (card && !card.closest('#reader-task-list')) {
      openDrawer(card.dataset.id);
      return;
    }

    // Task inside reader sidebar click
    const readerCard = e.target.closest('#reader-task-list .task-card');
    if (readerCard) {
      openDrawer(readerCard.dataset.id);
      return;
    }

    // Read doc action
    const readDocBtn = e.target.closest('[data-action="read-doc"]');
    if (readDocBtn) {
      openDocReader(readDocBtn.dataset.slug);
      return;
    }

    // Doc Card click -> open Doc Reader
    const docCard = e.target.closest('.doc-card');
    if (docCard) {
      openDocReader(docCard.dataset.slug);
      return;
    }
  });

  // Task Drawer events
  dom.drawerBackdrop.addEventListener('click', closeDrawer);
  dom.drawerCloseBtn.addEventListener('click', closeDrawer);
  dom.drawerSaveBtn.addEventListener('click', saveDrawerTask);
  dom.drawerDeleteBtn.addEventListener('click', deleteDrawerTask);

  // Doc Reader Drawer events
  dom.docReaderBackdrop.addEventListener('click', closeDocReader);
  dom.docReaderCloseBtn.addEventListener('click', closeDocReader);
  dom.readerAddTaskBtn.addEventListener('click', () => {
    if (!state.activeDoc) return;
    const slug = state.activeDoc.slug;
    closeDocReader();
    openModal(false, slug);
  });

  // Doc lifecycle actions in Reader
  if (dom.readerFinishDocBtn) {
    dom.readerFinishDocBtn.addEventListener('click', () => {
      const slug = dom.readerFinishDocBtn.dataset.slug;
      if (slug) updateDocStatus(slug, 'Finished');
    });
  }

  if (dom.readerReopenDocBtn) {
    dom.readerReopenDocBtn.addEventListener('click', () => {
      const slug = dom.readerReopenDocBtn.dataset.slug;
      if (slug) updateDocStatus(slug, 'Active');
    });
  }

  // Design Docs Catalog Filter Tabs
  if (dom.docsFilterTabs) {
    dom.docsFilterTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.docs-filter-tab');
      if (!tab || !tab.dataset.filter) return;
      state.activeDocsFilter = tab.dataset.filter;
      dom.docsFilterTabs.querySelectorAll('.docs-filter-tab').forEach(t => {
        t.classList.toggle('active', t === tab);
      });
      renderDocs();
    });
  }

  // Modal events
  dom.btnNewTask.addEventListener('click', () => openModal(false));
  dom.btnLogBug.addEventListener('click', () => openModal(true));
  dom.modalCloseBtn.addEventListener('click', closeModal);
  dom.modalCancelBtn.addEventListener('click', closeModal);
  dom.taskForm.addEventListener('submit', handleTaskFormSubmit);
  dom.taskTrackSelect.addEventListener('change', () => handleTrackSelectChange(dom.taskTrackSelect));
  dom.drawerTrackSelect.addEventListener('change', () => handleTrackSelectChange(dom.drawerTrackSelect));

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    if (e.key === 'Escape') {
      if (dom.docReaderDrawer.classList.contains('open')) {
        closeDocReader();
      } else if (dom.taskDrawer.classList.contains('open')) {
        closeDrawer();
      } else if (dom.taskDialog.open) {
        closeModal();
      }
      return;
    }

    if (inInput) return;

    if (e.key === '/') {
      e.preventDefault();
      dom.searchInput.focus();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openModal(false);
    } else if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      openModal(true);
    } else if (e.key === '0') {
      setView('fleet');
    } else if (e.key === '1') {
      setView('swimlanes');
    } else if (e.key === '2') {
      setView('kanban');
    } else if (e.key === '3') {
      setView('docs');
    }
  });

  // Background Auto-Polling (every 3 seconds)
  setInterval(() => {
    if (state.isPolling && !document.hidden) {
      fetchData(true);
    }
  }, 3000);

  // Hash-based routing listener
  window.addEventListener('hashchange', () => {
    handleHashRoute();
  });
}

function handleHashRoute() {
  const hash = window.location.hash;
  if (hash === '#fleet') {
    setView('fleet');
  } else if (hash.startsWith('#agent=')) {
    const params = new URLSearchParams(hash.slice(1));
    const agentId = params.get('agent');
    const view = params.get('view') || 'swimlanes';
    if (agentId && agentId !== state.activeAgentId) {
      state.activeAgentId = agentId;
      fetchData(true);
    }
    setView(view);
  } else if (hash === '#kanban') {
    setView('kanban');
  } else if (hash === '#docs') {
    setView('docs');
  } else if (hash === '#swimlanes' || hash === '' || hash === '#') {
    setView('swimlanes');
  }
}

// Bootstrap
function startApp() {
  bindEvents();
  fetchData(false).then(() => {
    handleHashRoute();
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
