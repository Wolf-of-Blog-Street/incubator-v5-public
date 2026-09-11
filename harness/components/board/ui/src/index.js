import { state } from './store/state.js';
import { getFilteredTasks } from './store/selectors.js';
import { renderDocFilters, renderTrackFilters } from './components/filterBar.js';
import { renderSwimlanes, updateDoneToggleButton } from './views/swimlanesView.js';
import { renderKanban } from './views/kanbanView.js';
import { renderFleet } from './views/fleetView.js';
import { renderProjects } from './views/projectsView.js';
import { renderDocs } from './views/docsView.js';
import { setView, handleHashRoute } from './views/router.js';
import { fetchData, setDefaultRenderer } from './api/sync.js';
import { initLiveSync } from './api/sse.js';
import { bindEvents } from './events/delegation.js';

export { setView, fetchData };

/**
 * Master render coordinator.
 */
export function render() {
  const filtered = getFilteredTasks(state.tasks, state);
  renderTrackFilters();
  renderDocFilters(filtered);
  updateDoneToggleButton();

  if (state.activeView === 'fleet') {
    renderFleet();
  } else if (state.activeView === 'projects') {
    renderProjects();
  } else if (state.activeView === 'swimlanes') {
    renderSwimlanes(filtered);
  } else if (state.activeView === 'kanban') {
    renderKanban(filtered);
  } else if (state.activeView === 'docs') {
    renderDocs();
  }
}

/**
 * Bootstraps the application.
 */
export function startApp() {
  setDefaultRenderer(render);
  const sync = (silent = false) => fetchData(silent, render);
  bindEvents(sync, render);
  initLiveSync(() => {
    sync(true);
  });
  sync(false).then(() => {
    handleHashRoute((agentId) => sync(true), render);
  });
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
}
