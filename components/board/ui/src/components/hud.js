import { state, dom } from '../store/state.js';

/**
 * Updates top HUD progress bar and counters.
 */
export function updateHUD() {
  if (!state.summary) return;

  const { overallProgress, totalTasks, openBugs } = state.summary;

  if (dom.hudProgressBar) {
    dom.hudProgressBar.style.width = `${overallProgress || 0}%`;
  }
  if (dom.hudProgressText) {
    dom.hudProgressText.textContent = `${overallProgress || 0}%`;
  }
  if (dom.hudTotalTasks) {
    dom.hudTotalTasks.textContent = totalTasks || 0;
  }
  if (dom.hudTotalBugs) {
    dom.hudTotalBugs.textContent = openBugs || 0;
    if (openBugs > 0) {
      dom.hudTotalBugs.classList.add('has-bugs');
    } else {
      dom.hudTotalBugs.classList.remove('has-bugs');
    }
  }
}
