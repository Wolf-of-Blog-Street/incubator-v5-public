import { state, dom } from '../store/state.js';
import { updateActiveAgentHeader, renderProjectSwitcherMenu } from '../components/switcher.js';

/**
 * Sets the active view ('fleet' | 'projects' | 'swimlanes' | 'kanban' | 'docs') and updates DOM.
 */
export function setView(viewName, onRender) {
  state.activeView = viewName;

  if (dom.viewFleetBtn) dom.viewFleetBtn.classList.toggle('active', viewName === 'fleet');
  if (dom.viewProjectsBtn) dom.viewProjectsBtn.classList.toggle('active', viewName === 'projects');
  if (dom.viewSwimlanesBtn) dom.viewSwimlanesBtn.classList.toggle('active', viewName === 'swimlanes');
  if (dom.viewKanbanBtn) dom.viewKanbanBtn.classList.toggle('active', viewName === 'kanban');
  if (dom.viewDocsBtn) dom.viewDocsBtn.classList.toggle('active', viewName === 'docs');

  if (dom.fleetView) dom.fleetView.style.display = viewName === 'fleet' ? 'flex' : 'none';
  if (dom.projectsView) dom.projectsView.style.display = viewName === 'projects' ? 'flex' : 'none';
  if (dom.swimlanesView) dom.swimlanesView.style.display = viewName === 'swimlanes' ? 'flex' : 'none';
  if (dom.kanbanView) dom.kanbanView.style.display = viewName === 'kanban' ? 'flex' : 'none';
  if (dom.docsView) dom.docsView.style.display = viewName === 'docs' ? 'flex' : 'none';

  const filterToolbar = document.querySelector('.filter-toolbar');
  if (filterToolbar) {
    filterToolbar.style.display = (viewName === 'fleet' || viewName === 'projects' || viewName === 'docs') ? 'none' : 'flex';
  }

  if (dom.btnToggleAllSwimlanes) {
    dom.btnToggleAllSwimlanes.style.display = viewName === 'swimlanes' ? 'inline-flex' : 'none';
  }
  if (dom.btnToggleDone) {
    dom.btnToggleDone.style.display = (viewName === 'swimlanes' || viewName === 'kanban') ? 'inline-flex' : 'none';
  }

  const currentAgent = (state.roster || []).find(a => a.id === state.activeAgentId);
  updateActiveAgentHeader(currentAgent);
  renderProjectSwitcherMenu();

  // Synchronize URL hash
  if (viewName === 'fleet') {
    history.replaceState(null, '', '#fleet');
  } else if (viewName === 'projects') {
    history.replaceState(null, '', '#projects');
  } else {
    history.replaceState(null, '', `#agent=${encodeURIComponent(state.activeAgentId)}&view=${viewName}`);
  }

  if (typeof onRender === 'function') {
    onRender();
  }
}

/**
 * Parses current URL hash and activates matching view/agent state.
 */
export function handleHashRoute(onAgentChanged, onRender) {
  const hash = window.location.hash;
  if (hash === '#fleet') {
    setView('fleet', onRender);
  } else if (hash === '#projects') {
    setView('projects', onRender);
  } else if (hash.startsWith('#agent=')) {
    const params = new URLSearchParams(hash.slice(1));
    const agentId = params.get('agent');
    const view = params.get('view') || 'swimlanes';
    if (agentId && agentId !== state.activeAgentId) {
      state.activeAgentId = agentId;
      if (typeof onAgentChanged === 'function') {
        onAgentChanged(agentId);
      }
    }
    setView(view, onRender);
  } else if (hash === '#kanban') {
    setView('kanban', onRender);
  } else if (hash === '#docs') {
    setView('docs', onRender);
  } else if (hash === '#swimlanes' || hash === '' || hash === '#') {
    setView('swimlanes', onRender);
  }
}
