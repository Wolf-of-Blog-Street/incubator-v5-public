import { state } from '../store/state.js';
import { setView } from '../views/router.js';
import { switchAgent } from '../components/switcher.js';
import { openDrawer } from '../components/drawer.js';
import { openModal } from '../components/modal.js';
import { openDocReader } from '../views/docsView.js';
import { toggleDoneCol, updateToggleAllLabel } from '../views/swimlanesView.js';
import { setDocFilter } from '../components/filterBar.js';
import { quickUpdateStatus, updateDocStatus } from '../api/client.js';
import {
  openAddProjectModal,
  closeAddProjectModal,
  handleAddProjectSubmit,
  handleDeleteProject,
  handleScanProjects
} from '../views/projectsView.js';

/**
 * Attaches global document click delegation for dynamic elements:
 * cards, fleet pills, doc reader triggers, swimlanes, and doc actions.
 */
export function bindClickDelegation(fetchData, render) {
  document.addEventListener('click', (e) => {
    // 1. Fleet Project Pill
    const projPill = e.target.closest('.fleet-proj-pill');
    if (projPill && projPill.dataset.agentId && projPill.dataset.projectId) {
      e.stopPropagation();
      state.activeAgentId = projPill.dataset.agentId;
      state.activeProjectId = projPill.dataset.projectId;
      setView('swimlanes', render);
      fetchData(false);
      return;
    }

    // 2. Fleet Inspect Agent
    const inspectBtn = e.target.closest('[data-action="inspect-agent"]');
    if (inspectBtn) {
      e.stopPropagation();
      switchAgent(inspectBtn.dataset.agentId, () => fetchData(false));
      return;
    }

    // 3. Card Action Button
    const actionBtn = e.target.closest('.btn-card-action');
    if (actionBtn) {
      e.stopPropagation();
      const id = Number(actionBtn.dataset.id);
      const action = actionBtn.dataset.action;
      if (action === 'edit-plan') {
        openDrawer(id, 'edit');
      } else {
        const NEXT_STATUS = {
          start: 'in-progress',
          review: 'review',
          done: 'done'
        };
        const nextStatus = NEXT_STATUS[action] ?? 'in-progress';
        quickUpdateStatus(id, nextStatus, () => fetchData(true));
      }
      return;
    }

    // 4. Card Plan Preview / Pill
    const planPreview = e.target.closest('.card-plan-preview, .card-plan-pill, [data-action="view-plan"]');
    if (planPreview) {
      e.stopPropagation();
      const id = Number(planPreview.dataset.id);
      const action = planPreview.dataset.action;
      openDrawer(id, action === 'edit-plan' ? 'edit' : 'interactive');
      return;
    }

    // 7. Toggle Done Column in Swimlane
    const toggleDoneBtn = e.target.closest('[data-action="toggle-done-col"]');
    if (toggleDoneBtn) {
      e.stopPropagation();
      toggleDoneCol(toggleDoneBtn.dataset.slug, render);
      return;
    }

    // 8. Filter to doc action
    const filterDocBtn = e.target.closest('[data-action="filter-doc"]');
    if (filterDocBtn) {
      e.stopPropagation();
      setDocFilter(filterDocBtn.dataset.slug, render);
      return;
    }

    // 9. Clickable doc pill -> open Doc Reader
    const docPill = e.target.closest('.card-doc-pill');
    if (docPill) {
      e.stopPropagation();
      openDocReader(docPill.dataset.slug);
      return;
    }

    // 10. Swimlane collapse/expand
    const toggleBtn = e.target.closest('.swimlane-toggle-btn');
    if (toggleBtn) {
      e.stopPropagation();
      const swimlane = toggleBtn.closest('.doc-swimlane');
      if (swimlane) swimlane.classList.toggle('is-collapsed');
      updateToggleAllLabel();
      return;
    }

    // 11. Cut task for doc
    const cutTaskBtn = e.target.closest('[data-action="cut-task-for-doc"]');
    if (cutTaskBtn) {
      e.stopPropagation();
      openModal(false, cutTaskBtn.dataset.slug);
      return;
    }

    // 12. Cut standalone task
    const cutStandaloneBtn = e.target.closest('[data-action="cut-standalone-task"]');
    if (cutStandaloneBtn) {
      e.stopPropagation();
      openModal(false, '');
      return;
    }

    // 13. Card click -> open task drawer
    const card = e.target.closest('.task-card');
    if (card && !card.closest('#reader-task-list')) {
      openDrawer(Number(card.dataset.id));
      return;
    }

    // 14. Reader sidebar card click
    const readerCard = e.target.closest('#reader-task-list .task-card');
    if (readerCard) {
      openDrawer(Number(readerCard.dataset.id));
      return;
    }

    // 15. Close doc action
    const closeDocBtn = e.target.closest('[data-action="close-doc"], [data-action="card-close-doc"]');
    if (closeDocBtn) {
      e.stopPropagation();
      updateDocStatus(closeDocBtn.dataset.slug, 'Closed', () => fetchData(false));
      return;
    }

    // 16. Open doc action
    const openDocBtn = e.target.closest('[data-action="open-doc"], [data-action="card-open-doc"]');
    if (openDocBtn) {
      e.stopPropagation();
      updateDocStatus(openDocBtn.dataset.slug, 'Open', () => fetchData(false));
      return;
    }

    // 17. Read doc action / Doc Card click
    const readDocBtn = e.target.closest('[data-action="read-doc"]');
    if (readDocBtn) {
      openDocReader(readDocBtn.dataset.slug);
      return;
    }

    const docCard = e.target.closest('.doc-card');
    if (docCard && !e.target.closest('.btn-doc-lifecycle, [data-action^="card-"]')) {
      openDocReader(docCard.dataset.slug);
      return;
    }

    // 18. Inspect project board button
    const inspectProj = e.target.closest('[data-action="inspect-project-board"]');
    if (inspectProj && inspectProj.dataset.agentId) {
      e.stopPropagation();
      state.activeAgentId = inspectProj.dataset.agentId;
      if (inspectProj.dataset.projectId) {
        state.activeProjectId = inspectProj.dataset.projectId;
      }
      setView('swimlanes', render);
      fetchData(false);
      return;
    }

    // 19. Delete project from catalog
    const delProj = e.target.closest('[data-action="delete-project"]');
    if (delProj && delProj.dataset.projectId) {
      e.stopPropagation();
      handleDeleteProject(delProj.dataset.projectId, () => {
        fetchData(true);
        render();
      });
      return;
    }

    // 20. Add project trigger button
    const addProjBtn = e.target.closest('#btn-add-project, #btn-empty-add-project');
    if (addProjBtn) {
      e.stopPropagation();
      openAddProjectModal();
      return;
    }

    // 21. Re-scan projects trigger button
    const scanBtn = e.target.closest('#btn-refresh-projects-scan');
    if (scanBtn) {
      e.stopPropagation();
      handleScanProjects(() => render());
      return;
    }

    // 22. Close project modal buttons
    const closeProjModal = e.target.closest('#project-modal-close-btn, #project-modal-cancel-btn');
    if (closeProjModal) {
      e.stopPropagation();
      closeAddProjectModal();
      return;
    }

    // 23. Project filter chips
    const projChip = e.target.closest('.proj-filter-chip');
    if (projChip && projChip.dataset.filter) {
      e.stopPropagation();
      document.querySelectorAll('.proj-filter-chip').forEach(c => c.classList.remove('active'));
      projChip.classList.add('active');
      state.projectsFilter = projChip.dataset.filter;
      render();
      return;
    }
  });

  // Attach Form & Search Listeners once
  const addProjectForm = document.getElementById('add-project-form');
  if (addProjectForm && !addProjectForm._bound) {
    addProjectForm._bound = true;
    addProjectForm.addEventListener('submit', (e) => {
      handleAddProjectSubmit(e, () => {
        fetchData(true);
        render();
      });
    });
  }

  const searchInput = document.getElementById('projects-search-input');
  if (searchInput && !searchInput._bound) {
    searchInput._bound = true;
    searchInput.addEventListener('input', (e) => {
      state.projectsSearchQuery = e.target.value;
      render();
    });
  }
}
