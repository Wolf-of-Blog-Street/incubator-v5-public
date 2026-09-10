import { isDocClosed } from './state.js';

let cachedDocsRef = null;
let cachedDocsMap = new Map();

/**
 * Returns a Map of design docs keyed by slug for O(1) lookups.
 */
export function getDocLookupMap(docs = []) {
  if (docs === cachedDocsRef && cachedDocsMap.size === docs.length) {
    return cachedDocsMap;
  }
  cachedDocsMap = new Map();
  for (const doc of docs) {
    if (doc && doc.slug) {
      cachedDocsMap.set(doc.slug, doc);
    }
  }
  cachedDocsRef = docs;
  return cachedDocsMap;
}

/**
 * Filters the active task list based on search, track, doc and lifecycle.
 */
export function getFilteredTasks(tasks = [], state = {}) {
  const searchQuery = (state.searchQuery || '').toLowerCase().trim();
  const activeTrack = state.activeTrack || 'all';
  const activeDocFilter = state.activeDocFilter || 'all';
  const lifecycle = state.activeDocLifecycleFilter || 'open';

  return tasks.filter(task => {
    // 1. Search query filter
    if (searchQuery) {
      const matchTitle = (task.title || '').toLowerCase().includes(searchQuery);
      const matchSlug = (task.design_slug || '').toLowerCase().includes(searchQuery);
      const matchDetails = (task.details || '').toLowerCase().includes(searchQuery);
      const matchId = String(task.id).includes(searchQuery);
      if (!matchTitle && !matchSlug && !matchDetails && !matchId) return false;
    }

    // 2. Track filter
    if (activeTrack !== 'all') {
      if (task.track !== activeTrack) return false;
    }

    // 3. Design Doc filter
    if (activeDocFilter !== 'all') {
      if (activeDocFilter === 'standalone') {
        if (task.design_slug && task.design_slug.trim() && task.design_slug.toLowerCase() !== 'standalone') {
          return false;
        }
      } else {
        if (task.design_slug !== activeDocFilter) return false;
      }
    }

    // 4. Doc lifecycle: hide tasks of closed docs unless a doc is picked by name or lifecycle is 'all'
    if (activeDocFilter === 'all' && lifecycle === 'open' && task.design_slug && task.design_slug.trim() && task.design_slug.toLowerCase() !== 'standalone' && isDocClosed(task.design_slug)) return false;

    return true;
  });
}
