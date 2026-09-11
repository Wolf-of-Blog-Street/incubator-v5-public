// Industry Standard Tracks & Icons
export const INDUSTRY_TRACKS = [
  { id: 'core', label: 'core', icon: '⬡' },
  { id: 'engine', label: 'engine', icon: '⚙️' },
  { id: 'harness', label: 'harness', icon: '🛡️' },
  { id: 'sweeper', label: 'sweeper', icon: '🧹' },
  { id: 'feature', label: 'feature', icon: '✨' },
  { id: 'bug', label: 'bug', icon: '🐛' },
  { id: 'frontend', label: 'frontend', icon: '🎨' },
  { id: 'backend', label: 'backend', icon: '🔌' },
  { id: 'api', label: 'api', icon: '⚡' },
  { id: 'ux', label: 'ux', icon: '🪄' },
  { id: 'db', label: 'db', icon: '🗄️' },
  { id: 'infra', label: 'infra', icon: '☁️' },
  { id: 'docs', label: 'docs', icon: '📄' },
  { id: 'test', label: 'test', icon: '🧪' },
  { id: 'perf', label: 'perf', icon: '🚀' }
];

export function getTrackIcon(trackId) {
  if (!trackId) return '🏷️';
  const match = INDUSTRY_TRACKS.find(t => t.id === trackId);
  if (match && match.icon) return match.icon;
  if (trackId === 'security') return '🔒';
  if (trackId === 'ai' || trackId === 'model') return '🤖';
  return '🏷️';
}

export const DOC_COLOR_PALETTES = {
  sky: {
    accent: '#38bdf8',
    bg: 'rgba(56, 189, 248, 0.12)',
    bgHover: 'rgba(56, 189, 248, 0.22)',
    border: 'rgba(56, 189, 248, 0.35)',
    text: '#7dd3fc',
    glow: 'rgba(56, 189, 248, 0.25)'
  },
  purple: {
    accent: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.12)',
    bgHover: 'rgba(168, 85, 247, 0.22)',
    border: 'rgba(168, 85, 247, 0.35)',
    text: '#c084fc',
    glow: 'rgba(168, 85, 247, 0.25)'
  },
  emerald: {
    accent: '#10b981',
    bg: 'rgba(16, 185, 129, 0.12)',
    bgHover: 'rgba(16, 185, 129, 0.22)',
    border: 'rgba(16, 185, 129, 0.35)',
    text: '#34d399',
    glow: 'rgba(16, 185, 129, 0.25)'
  },
  amber: {
    accent: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.12)',
    bgHover: 'rgba(245, 158, 11, 0.22)',
    border: 'rgba(245, 158, 11, 0.35)',
    text: '#fbbf24',
    glow: 'rgba(245, 158, 11, 0.25)'
  },
  rose: {
    accent: '#f43f5e',
    bg: 'rgba(244, 63, 94, 0.12)',
    bgHover: 'rgba(244, 63, 94, 0.22)',
    border: 'rgba(244, 63, 94, 0.35)',
    text: '#fb7185',
    glow: 'rgba(244, 63, 94, 0.25)'
  },
  indigo: {
    accent: '#6366f1',
    bg: 'rgba(99, 102, 241, 0.12)',
    bgHover: 'rgba(99, 102, 241, 0.22)',
    border: 'rgba(99, 102, 241, 0.35)',
    text: '#818cf8',
    glow: 'rgba(99, 102, 241, 0.25)'
  },
  teal: {
    accent: '#14b8a6',
    bg: 'rgba(20, 184, 166, 0.12)',
    bgHover: 'rgba(20, 184, 166, 0.22)',
    border: 'rgba(20, 184, 166, 0.35)',
    text: '#2dd4bf',
    glow: 'rgba(20, 184, 166, 0.25)'
  },
  orange: {
    accent: '#f97316',
    bg: 'rgba(249, 115, 22, 0.12)',
    bgHover: 'rgba(249, 115, 22, 0.22)',
    border: 'rgba(249, 115, 22, 0.35)',
    text: '#fb923c',
    glow: 'rgba(249, 115, 22, 0.25)'
  }
};

export const PALETTE_KEYS = Object.keys(DOC_COLOR_PALETTES);

export const HEX_TO_PALETTE = {
  '#38bdf8': 'sky',
  '#a855f7': 'purple',
  '#8b5cf6': 'purple',
  '#10b981': 'emerald',
  '#f59e0b': 'amber',
  '#f43f5e': 'rose',
  '#6366f1': 'indigo',
  '#14b8a6': 'teal',
  '#f97316': 'orange'
};

export function resolveColorPalette(colorSpec, slug = '') {
  if (!colorSpec) {
    let hash = 0;
    for (let i = 0; i < slug.length; i++) {
      hash = (hash * 31 + slug.charCodeAt(i)) & 0xffffffff;
    }
    const key = PALETTE_KEYS[Math.abs(hash) % PALETTE_KEYS.length];
    return DOC_COLOR_PALETTES[key];
  }

  const clean = colorSpec.toLowerCase().trim();
  if (DOC_COLOR_PALETTES[clean]) {
    return DOC_COLOR_PALETTES[clean];
  }
  if (HEX_TO_PALETTE[clean]) {
    return DOC_COLOR_PALETTES[HEX_TO_PALETTE[clean]];
  }

  if (clean.startsWith('#')) {
    for (const p of Object.values(DOC_COLOR_PALETTES)) {
      if (p.accent.toLowerCase() === clean) return p;
    }
    return {
      accent: clean,
      bg: `${clean}1f`,
      bgHover: `${clean}38`,
      border: `${clean}55`,
      text: clean,
      glow: `${clean}40`
    };
  }

  return DOC_COLOR_PALETTES.indigo;
}

export function getDocColor(slugOrDoc) {
  const doc = typeof slugOrDoc === 'string' ? (state.docs || []).find(d => d.slug === slugOrDoc) : slugOrDoc;
  const slug = (typeof slugOrDoc === 'string' ? slugOrDoc : doc?.slug) || '';
  return resolveColorPalette(doc?.color, slug);
}

export function getDocCodename(slugOrDoc) {
  const doc = typeof slugOrDoc === 'string' ? (state.docs || []).find(d => d.slug === slugOrDoc) : slugOrDoc;
  if (doc?.codename) return doc.codename;
  const slug = (typeof slugOrDoc === 'string' ? slugOrDoc : doc?.slug) || '';
  if (!slug || slug === 'standalone') return '#standalone';

  const idx = (state.docs || []).findIndex(d => d.slug === slug);
  if (idx >= 0) return `#d-${idx + 1}`;

  return `#${slug}`;
}

export const STORAGE_KEYS = {
  DOC_LIFECYCLE_FILTER: 'incubator_v5_doc_lifecycle_filter',
  DOC_FILTER: 'incubator_v5_doc_filter',
  TRACK_FILTER: 'incubator_v5_track_filter',
  DOCS_CATALOG_FILTER: 'incubator_v5_docs_catalog_filter',
  COLLAPSE_DONE: 'incubator_v5_collapse_done'
};

export function getStoredPref(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return (val !== null && val !== undefined) ? val : fallback;
  } catch (_) {
    return fallback;
  }
}

export function setStoredPref(key, value) {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  } catch (_) {}
}

export const CLOSED_DOC_STATUSES = ['closed', 'archived', 'finished', 'done'];

export function isDocClosed(slugOrDoc) {
  if (!slugOrDoc) return false;
  const slug = typeof slugOrDoc === 'string' ? slugOrDoc : slugOrDoc.slug;
  const doc = typeof slugOrDoc === 'string' ? (state.docs || []).find(d => d.slug === slugOrDoc) : slugOrDoc;
  if (!doc) return false;
  const status = (doc.status || '').toLowerCase().trim();
  return CLOSED_DOC_STATUSES.includes(status) || doc.isFinished === true;
}

export function isDocFinished(slugOrDoc) {
  return isDocClosed(slugOrDoc);
}

export function isDocOpen(slugOrDoc) {
  return !isDocClosed(slugOrDoc);
}

export function isDocActive(slugOrDoc) {
  return !isDocClosed(slugOrDoc);
}

export function getDocSubState(slugOrDoc) {
  const slug = typeof slugOrDoc === 'string' ? slugOrDoc : slugOrDoc?.slug;
  const doc = typeof slugOrDoc === 'string' ? (state.docs || []).find(d => d.slug === slugOrDoc) : slugOrDoc;

  if (doc && doc.taskStats) {
    const { total, done } = doc.taskStats;
    const docTasks = (state.tasks || []).filter(t => t.design_slug === slug);
    const hasInProgress = docTasks.some(t => t.status === 'in-progress' || t.status === 'review');
    const hasToDo = docTasks.some(t => t.status === 'planned' || t.status === 'todo');

    return {
      total,
      done,
      hasInProgress,
      hasToDo,
      allFinished: total > 0 && done === total
    };
  }

  const docTasks = (state.tasks || []).filter(t => t.design_slug === slug);
  const total = docTasks.length;
  const done = docTasks.filter(t => t.status === 'done').length;
  const hasInProgress = docTasks.some(t => t.status === 'in-progress' || t.status === 'review');
  const hasToDo = docTasks.some(t => t.status === 'planned' || t.status === 'todo');

  return {
    total,
    done,
    hasInProgress,
    hasToDo,
    allFinished: total > 0 && done === total
  };
}

export function showToast(message, type = 'info') {
  const container = dom.toastContainer || document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px) scale(0.95)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// Application Central Reactive State
export const state = {
  tasks: [],
  summary: null,
  docs: [],
  activeDoc: null,
  activeTrack: getStoredPref(STORAGE_KEYS.TRACK_FILTER, 'all'),
  activeDocFilter: getStoredPref(STORAGE_KEYS.DOC_FILTER, 'all'),
  // A stored 'closed' has no control left to clear it, so it reads as 'all'
  activeDocLifecycleFilter: getStoredPref(STORAGE_KEYS.DOC_LIFECYCLE_FILTER, 'open') === 'open' ? 'open' : 'all',
  searchQuery: '',
  activeView: 'swimlanes',
  selectedTaskId: null,
  collapseDone: getStoredPref(STORAGE_KEYS.COLLAPSE_DONE, 'true') === 'true',
  collapsedDoneOverrides: {},
  isPolling: true,
  lastSyncTime: Date.now(),
  activeAgentId: 'manager-pm',
  activeProjectId: null,
  roster: [],
  defaultAgentId: 'manager-pm',
  activeDocsFilter: getStoredPref(STORAGE_KEYS.DOCS_CATALOG_FILTER, 'open'),
  activeDocsCatalogSubFilter: 'all',
  projectsCatalog: [],
  projectsStats: null,
  projectsFilter: 'all',
  projectsSearchQuery: ''
};

if (typeof window !== 'undefined') {
  window.__board_state = state;
}

// Resilient DOM element cache proxy with lazy fallback
const domCache = {};
export const dom = new Proxy(domCache, {
  get(target, prop) {
    if (prop in target && target[prop] && target[prop].isConnected !== false) {
      return target[prop];
    }
    if (typeof document === 'undefined') return null;

    // Check by exact ID
    let el = document.getElementById(prop);
    if (!el) {
      // Convert camelCase to kebab-case
      const kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
      el = document.getElementById(kebab);
    }
    if (el) {
      target[prop] = el;
    }
    return el;
  }
});
