import {
  state,
  dom,
  STORAGE_KEYS,
  setStoredPref
} from '../../store/state.js';

/**
 * Closes all open filter dropdown menus.
 */
export function closeAllDropdowns() {
  dom.trackDropdownMenu?.classList.remove('is-open');
  dom.trackDropdownTrigger?.setAttribute('aria-expanded', 'false');
  dom.docDropdownMenu?.classList.remove('is-open');
  dom.docDropdownTrigger?.setAttribute('aria-expanded', 'false');
}

/**
 * Sets the active Design Doc filter and triggers a re-render.
 * @param {string} slug
 * @param {Function} [onRender]
 */
export function setDocFilter(slug, onRender) {
  state.activeDocFilter = slug ?? 'all';
  setStoredPref(STORAGE_KEYS.DOC_FILTER, state.activeDocFilter);
  if (typeof onRender === 'function') onRender();
}

/**
 * Sets the active Design Doc lifecycle filter ('open' | 'all').
 * @param {string} lifecycle
 * @param {Function} [onRender]
 */
export function setDocLifecycleFilter(lifecycle, onRender) {
  state.activeDocLifecycleFilter = lifecycle === 'all' ? 'all' : 'open';
  setStoredPref(STORAGE_KEYS.DOC_LIFECYCLE_FILTER, state.activeDocLifecycleFilter);
  if (typeof onRender === 'function') onRender();
}
