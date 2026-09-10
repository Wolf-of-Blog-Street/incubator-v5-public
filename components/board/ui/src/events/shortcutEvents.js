import { dom } from '../store/state.js';
import { closeAllDropdowns } from '../components/filterBar.js';
import { closeDrawer } from '../components/drawer.js';
import { closeDocReader } from '../views/docsView.js';
import { openModal, closeModal } from '../components/modal.js';
import { setView } from '../views/router.js';

/**
 * Attaches global keyboard shortcuts.
 */
export function bindShortcutEvents(render) {
  window.addEventListener('keydown', (e) => {
    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    if (e.key === 'Escape') {
      closeAllDropdowns();
      if (dom.docReaderDrawer?.classList.contains('open')) {
        closeDocReader();
      } else if (dom.taskDrawer?.classList.contains('open')) {
        closeDrawer();
      } else if (dom.taskDialog?.open) {
        closeModal();
      } else if (dom.addProjectDialog?.open) {
        dom.addProjectDialog.close();
      }
      return;
    }

    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.classList.contains('task-card')) {
      e.preventDefault();
      document.activeElement.click();
      return;
    }

    if (inInput) return;

    if (e.key === '/') {
      e.preventDefault();
      if (dom.searchInput) dom.searchInput.focus();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openModal(false);
    } else if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      openModal(true);
    } else if (e.key === '0') {
      setView('fleet', render);
    } else if (e.key === '1') {
      setView('projects', render);
    } else if (e.key === '2') {
      setView('swimlanes', render);
    } else if (e.key === '3') {
      setView('kanban', render);
    } else if (e.key === '4') {
      setView('docs', render);
    }
  });
}
