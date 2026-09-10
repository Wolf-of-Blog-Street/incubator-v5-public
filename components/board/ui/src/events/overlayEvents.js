import { state, dom, STORAGE_KEYS, setStoredPref, showToast } from '../store/state.js';
import {
  closeDrawer,
  saveDrawerTask,
  deleteDrawerTask,
  setPlanTab,
  toggleTaskChecklistItem,
  handleTrackSelectChange
} from '../components/drawer.js';
import { openDocReader, closeDocReader, renderDocs } from '../views/docsView.js';
import { openModal, closeModal, handleTaskFormSubmit } from '../components/modal.js';
import { updateDocStatus } from '../api/client.js';

/**
 * Attaches event listeners for overlays: Task Drawer, Doc Reader, and Task Modal.
 */
export function bindOverlayEvents(fetchData, render) {
  // 1. Task Drawer Events
  if (dom.drawerBackdrop) dom.drawerBackdrop.addEventListener('click', closeDrawer);
  if (dom.drawerCloseBtn) dom.drawerCloseBtn.addEventListener('click', closeDrawer);
  if (dom.drawerSaveBtn) dom.drawerSaveBtn.addEventListener('click', () => saveDrawerTask(() => fetchData(true)));
  if (dom.drawerDeleteBtn) dom.drawerDeleteBtn.addEventListener('click', () => deleteDrawerTask(() => fetchData(false)));

  if (dom.tabPlanInteractive) {
    dom.tabPlanInteractive.addEventListener('click', () => setPlanTab('interactive'));
  }
  if (dom.tabPlanEdit) {
    dom.tabPlanEdit.addEventListener('click', () => setPlanTab('edit'));
  }

  if (dom.btnOpenDocFromTask) {
    dom.btnOpenDocFromTask.addEventListener('click', () => {
      const slug = dom.drawerDocSelect?.value || '';
      if (slug) {
        closeDrawer();
        openDocReader(slug);
      } else {
        showToast('This task is not attached to a design doc.', 'info');
      }
    });
  }

  if (dom.drawerPlanContent) {
    dom.drawerPlanContent.addEventListener('click', (e) => {
      const item = e.target.closest('.task-item');
      if (item && item.dataset.checklistIdx !== undefined) {
        toggleTaskChecklistItem(Number(item.dataset.checklistIdx), render);
      }
    });
  }

  // 2. Doc Reader Events
  if (dom.docReaderBackdrop) dom.docReaderBackdrop.addEventListener('click', closeDocReader);
  if (dom.docReaderCloseBtn) dom.docReaderCloseBtn.addEventListener('click', closeDocReader);
  if (dom.readerAddTaskBtn) {
    dom.readerAddTaskBtn.addEventListener('click', () => {
      if (!state.activeDoc) return;
      const slug = state.activeDoc.slug;
      closeDocReader();
      openModal(false, slug);
    });
  }

  if (dom.readerFinishDocBtn) {
    dom.readerFinishDocBtn.addEventListener('click', () => {
      const slug = dom.readerFinishDocBtn.dataset.slug;
      if (slug) updateDocStatus(slug, 'Closed', () => fetchData(false));
    });
  }

  if (dom.readerReopenDocBtn) {
    dom.readerReopenDocBtn.addEventListener('click', () => {
      const slug = dom.readerReopenDocBtn.dataset.slug;
      if (slug) updateDocStatus(slug, 'Open', () => fetchData(false));
    });
  }

  if (dom.docsFilterTabs) {
    dom.docsFilterTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.docs-filter-tab');
      if (!tab || !tab.dataset.filter) return;
      state.activeDocsFilter = tab.dataset.filter;
      setStoredPref(STORAGE_KEYS.DOCS_CATALOG_FILTER, state.activeDocsFilter);
      dom.docsFilterTabs.querySelectorAll('.docs-filter-tab').forEach(t => {
        t.classList.toggle('active', t === tab);
      });
      renderDocs();
    });
  }

  if (dom.docsCatalogSubfilters) {
    dom.docsCatalogSubfilters.addEventListener('click', (e) => {
      const subtab = e.target.closest('.docs-subtab');
      if (!subtab || !subtab.dataset.subfilter) return;
      state.activeDocsCatalogSubFilter = subtab.dataset.subfilter;
      dom.docsCatalogSubfilters.querySelectorAll('.docs-subtab').forEach(st => {
        st.classList.toggle('active', st === subtab);
      });
      renderDocs();
    });
  }

  // 3. Modal Events
  if (dom.btnNewTask) dom.btnNewTask.addEventListener('click', () => openModal(false));
  if (dom.btnLogBug) dom.btnLogBug.addEventListener('click', () => openModal(true));
  if (dom.modalCloseBtn) dom.modalCloseBtn.addEventListener('click', closeModal);
  if (dom.modalCancelBtn) dom.modalCancelBtn.addEventListener('click', closeModal);
  if (dom.taskForm) dom.taskForm.addEventListener('submit', (e) => handleTaskFormSubmit(e, () => fetchData(true)));
  if (dom.taskTrackSelect) dom.taskTrackSelect.addEventListener('change', () => handleTrackSelectChange(dom.taskTrackSelect));
  if (dom.drawerTrackSelect) dom.drawerTrackSelect.addEventListener('change', () => handleTrackSelectChange(dom.drawerTrackSelect));
}
