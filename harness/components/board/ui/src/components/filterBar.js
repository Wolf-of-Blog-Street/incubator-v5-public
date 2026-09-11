/**
 * FilterBar Component Facade
 * Provides unified access to filter state mutators and rendering sub-modules.
 */
export {
  closeAllDropdowns,
  setDocFilter,
  setDocLifecycleFilter
} from './filterBar/filterState.js';

export {
  renderDocFilters
} from './filterBar/docDropdownRenderer.js';

export {
  renderTrackFilters
} from './filterBar/trackLifecycleRenderer.js';
