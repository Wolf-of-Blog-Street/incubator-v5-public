import { state, dom, setStoredPref, STORAGE_KEYS } from '../store/state.js';
import {
  closeAllDropdowns,
  setDocFilter,
  setDocLifecycleFilter
} from '../components/filterBar.js';
import { toggleAllDone, updateToggleAllLabel } from '../views/swimlanesView.js';

/**
 * Attaches filter bar, search, and toolbar controls.
 */
export function bindFilterEvents(fetchData, render) {
  // 1. Search input
  if (dom.searchInput) {
    dom.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      render();
    });
  }

  // 2. Filter Bar Controls
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
      setStoredPref(STORAGE_KEYS.TRACK_FILTER, state.activeTrack);
      closeAllDropdowns();
      render();
    });
  }

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
      if (!item?.dataset.value) return;
      if (item.dataset.lifecycle) setDocLifecycleFilter(item.dataset.lifecycle);
      setDocFilter(item.dataset.value, render);
      closeAllDropdowns();
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown')) {
      closeAllDropdowns();
    }
  });

  if (dom.btnToggleDone) {
    dom.btnToggleDone.addEventListener('click', () => {
      toggleAllDone(render);
    });
  }

  if (dom.btnToggleAllSwimlanes) {
    dom.btnToggleAllSwimlanes.addEventListener('click', () => {
      const collapse = !!document.querySelector('.doc-swimlane:not(.is-collapsed)');
      document.querySelectorAll('.doc-swimlane').forEach(el => el.classList.toggle('is-collapsed', collapse));
      updateToggleAllLabel();
    });
  }

  if (dom.btnRefresh) {
    dom.btnRefresh.addEventListener('click', () => fetchData(false));
  }
}
