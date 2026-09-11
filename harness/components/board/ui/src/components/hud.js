import { state, dom, isDocClosed } from '../store/state.js';

/**
 * Updates top HUD progress bar and counters.
 */
export function updateHUD() {
  const tasks = state.tasks || [];
  const isStandalone = t => !t.design_slug || !t.design_slug.trim() || t.design_slug.toLowerCase() === 'standalone';

  // Scope tasks to open boards and standalone (exclude closed docs)
  let scopedTasks = tasks.filter(t => isStandalone(t) || !isDocClosed(t.design_slug));

  if (state.activeDocFilter === 'standalone') {
    scopedTasks = scopedTasks.filter(isStandalone);
  } else if (state.activeDocFilter && state.activeDocFilter !== 'all') {
    scopedTasks = scopedTasks.filter(t => t.design_slug === state.activeDocFilter);
  }

  const total = scopedTasks.length;
  const done = scopedTasks.filter(t => t.status === 'done').length;
  const openBugs = scopedTasks.filter(t => t.track === 'bug' && t.status !== 'done').length;
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);

  if (dom.hudProgressBar) {
    dom.hudProgressBar.style.width = `${progress}%`;
  }
  if (dom.hudProgressText) {
    dom.hudProgressText.textContent = `${progress}%`;
  }
  if (dom.hudTotalTasks) {
    dom.hudTotalTasks.textContent = total;
  }
  if (dom.hudTotalBugs) {
    dom.hudTotalBugs.textContent = openBugs;
    if (openBugs > 0) {
      dom.hudTotalBugs.classList.add('has-bugs');
    } else {
      dom.hudTotalBugs.classList.remove('has-bugs');
    }
  }
}
