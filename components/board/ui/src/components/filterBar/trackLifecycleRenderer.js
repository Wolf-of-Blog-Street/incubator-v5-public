import {
  state,
  dom,
  INDUSTRY_TRACKS
} from '../../store/state.js';
import { escapeHtml } from '../../utils/markdown.js';

/**
 * Dynamically renders the compact Track filter dropdown in the toolbar.
 */
export function renderTrackFilters() {
  const totalTasks = (state.tasks || []).length;
  const presentTracks = new Set((state.tasks || []).map(t => t.track).filter(Boolean));

  let activeTrackLabel = `All tracks (${totalTasks})`;
  if (state.activeTrack !== 'all') {
    const matched = INDUSTRY_TRACKS.find(item => item.id === state.activeTrack);
    const count = (state.tasks || []).filter(t => t.track === state.activeTrack).length;
    const labelName = matched ? matched.label : state.activeTrack;
    activeTrackLabel = `${labelName} (${count})`;
  }

  if (dom.trackDropdownLabel) {
    dom.trackDropdownLabel.textContent = activeTrackLabel;
    dom.trackDropdownLabel.title = activeTrackLabel;
  }

  const rendered = new Set();
  const trackItems = [];

  for (const item of INDUSTRY_TRACKS) {
    const isTopTrack = ['bug', 'core', 'engine', 'harness', 'sweeper', 'feature', 'frontend', 'backend', 'api', 'ux', 'db', 'infra', 'docs', 'test', 'perf'].includes(item.id);
    if (presentTracks.has(item.id) || isTopTrack) {
      const count = (state.tasks || []).filter(t => t.track === item.id).length;
      trackItems.push({ id: item.id, label: item.label, count });
      rendered.add(item.id);
    }
  }

  for (const track of presentTracks) {
    if (!rendered.has(track)) {
      const count = (state.tasks || []).filter(t => t.track === track).length;
      trackItems.push({ id: track, label: track, count });
    }
  }

  if (dom.trackDropdownMenu) {
    let menuHtml = `
      <button type="button" class="dropdown-item ${state.activeTrack === 'all' ? 'is-selected' : ''}" data-value="all">
        <div class="dropdown-item-left">
          <span class="dropdown-item-check">✓</span>
          <span>All tracks</span>
        </div>
        <span class="dropdown-item-count">${totalTasks}</span>
      </button>
    `;

    for (const t of trackItems) {
      const isSelected = state.activeTrack === t.id ? 'is-selected' : '';
      menuHtml += `
        <button type="button" class="dropdown-item ${isSelected}" data-value="${escapeHtml(t.id)}">
          <div class="dropdown-item-left">
            <span class="dropdown-item-check">✓</span>
            <span>${escapeHtml(t.label)}</span>
          </div>
          <span class="dropdown-item-count">${t.count}</span>
        </button>
      `;
    }

    dom.trackDropdownMenu.innerHTML = menuHtml;
  }
}
