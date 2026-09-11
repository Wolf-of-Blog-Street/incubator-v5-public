import { state, dom } from '../store/state.js';
import { switchAgent, switchProject } from '../components/switcher.js';
import { setView, handleHashRoute } from '../views/router.js';

/**
 * Attaches view switcher, agent/project switcher, hash route, and background sync listeners.
 */
export function bindNavigationEvents(fetchData, render) {
  const closeAgentMenu = () => {
    dom.agentSwitcherDropdown?.classList.remove('is-open');
    dom.agentSwitcherBtn?.setAttribute('aria-expanded', 'false');
    if (dom.agentDropdownMenu) dom.agentDropdownMenu.style.display = 'none';
  };
  const closeProjectMenu = () => {
    dom.projectSwitcherDropdown?.classList.remove('is-open');
    dom.projectSwitcherBtn?.setAttribute('aria-expanded', 'false');
    if (dom.projectDropdownMenu) dom.projectDropdownMenu.style.display = 'none';
  };

  // 1. View Switcher Buttons
  if (dom.viewFleetBtn) dom.viewFleetBtn.addEventListener('click', () => setView('fleet', render));
  if (dom.viewProjectsBtn) dom.viewProjectsBtn.addEventListener('click', () => setView('projects', render));
  if (dom.viewSwimlanesBtn) dom.viewSwimlanesBtn.addEventListener('click', () => setView('swimlanes', render));
  if (dom.viewKanbanBtn) dom.viewKanbanBtn.addEventListener('click', () => setView('kanban', render));
  if (dom.viewDocsBtn) dom.viewDocsBtn.addEventListener('click', () => setView('docs', render));

  // 2. Agent & Project Switchers
  if (dom.agentSwitcherBtn) {
    dom.agentSwitcherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dom.agentSwitcherDropdown.classList.toggle('is-open');
      dom.agentSwitcherBtn.setAttribute('aria-expanded', isOpen);
      if (dom.agentDropdownMenu) {
        dom.agentDropdownMenu.style.display = isOpen ? 'block' : 'none';
      }
    });
  }

  if (dom.projectSwitcherBtn) {
    dom.projectSwitcherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dom.projectSwitcherDropdown.classList.toggle('is-open');
      dom.projectSwitcherBtn.setAttribute('aria-expanded', isOpen);
      if (dom.projectDropdownMenu) {
        dom.projectDropdownMenu.style.display = isOpen ? 'block' : 'none';
      }
    });
  }

  if (dom.btnMenuFleet) {
    dom.btnMenuFleet.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAgentMenu();
      setView('fleet', render);
    });
  }

  document.addEventListener('click', (e) => {
    if (dom.agentSwitcherDropdown && !dom.agentSwitcherDropdown.contains(e.target)) closeAgentMenu();
    if (dom.projectSwitcherDropdown && !dom.projectSwitcherDropdown.contains(e.target)) closeProjectMenu();
  });

  if (dom.agentMenuList) {
    dom.agentMenuList.addEventListener('click', (e) => {
      const item = e.target.closest('.agent-menu-item');
      if (item && item.dataset.agentId) {
        e.stopPropagation();
        closeAgentMenu();
        switchAgent(item.dataset.agentId, () => fetchData(false));
      }
    });
  }

  if (dom.projectMenuList) {
    dom.projectMenuList.addEventListener('click', (e) => {
      const item = e.target.closest('.project-menu-item');
      if (item && item.dataset.projectId) {
        e.stopPropagation();
        closeProjectMenu();
        switchProject(item.dataset.projectId, () => fetchData(false));
      }
    });
  }

  // 3. Re-sync on Focus and Visibility Change
  window.addEventListener('focus', () => {
    fetchData(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      fetchData(false);
    }
  });

  // 4. Auto-polling fallback (2.5s)
  setInterval(() => {
    if (state.isPolling && !document.hidden) {
      fetchData(true);
    }
  }, 2500);

  // 5. Hash Route Change
  window.addEventListener('hashchange', () => {
    handleHashRoute((_agentId) => fetchData(true), render);
  });
}
