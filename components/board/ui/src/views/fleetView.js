import { state, dom } from '../store/state.js';
import { escapeHtml } from '../utils/markdown.js';

export function renderFleet() {
  if (!dom.fleetGrid || !dom.fleetSummaryMetrics) return;

  const windowScrollY = window.scrollY || document.documentElement.scrollTop;

  const totalSeats = state.roster.length;
  const totalTasks = state.roster.reduce((sum, a) => sum + (a.stats?.totalTasks || 0), 0);
  const totalDone = state.roster.reduce((sum, a) => sum + (a.stats?.doneTasks || 0), 0);
  const totalInProgress = state.roster.reduce((sum, a) => sum + (a.stats?.inProgressTasks || 0), 0);
  const totalBugs = state.roster.reduce((sum, a) => sum + (a.stats?.openBugs || 0), 0);
  const overallProgress = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;

  dom.fleetSummaryMetrics.innerHTML = `
    <div class="fleet-summary-card">
      <span class="fleet-summary-label">ACTIVE SEATS</span>
      <span class="fleet-summary-val">${totalSeats}</span>
    </div>
    <div class="fleet-summary-card">
      <span class="fleet-summary-label">FLEET PROGRESS</span>
      <span class="fleet-summary-val progress">${overallProgress}%</span>
    </div>
    <div class="fleet-summary-card">
      <span class="fleet-summary-label">TOTAL TASKS</span>
      <span class="fleet-summary-val">${totalTasks}</span>
    </div>
    <div class="fleet-summary-card">
      <span class="fleet-summary-label">IN PROGRESS</span>
      <span class="fleet-summary-val" style="color: var(--status-in-progress);">${totalInProgress}</span>
    </div>
    <div class="fleet-summary-card">
      <span class="fleet-summary-label">OPEN BUGS</span>
      <span class="fleet-summary-val bugs">${totalBugs}</span>
    </div>
  `;

  if (state.roster.length === 0) {
    dom.fleetGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 3rem; text-align: center;">
        <span class="empty-icon" style="font-size: 2.5rem;">🌐</span>
        <h3 style="margin-top: 0.5rem; color: var(--text-primary);">No Agent Seats Discovered</h3>
        <p style="color: var(--text-muted); font-size: 0.85rem;">Run local agents with FALCON_BOARD_URL configured to connect seats to Falcon Manager.</p>
      </div>
    `;
    return;
  }

  dom.fleetGrid.innerHTML = state.roster.map(agent => {
    const stats = agent.stats || { totalTasks: 0, doneTasks: 0, inProgressTasks: 0, plannedTasks: 0, openBugs: 0, progressPct: 0 };
    const stages = agent.stages || [];
    const activeStage = stages.find(s => s.progress < 100) || stages[stages.length - 1] || null;
    const stageTitle = activeStage ? (activeStage.title || activeStage.slug) : 'All Stages Complete';
    const stagePct = activeStage ? activeStage.progress : 100;

    const tagsHtml = (agent.tags || []).map(tag => `
      <span class="fleet-tag-chip">#${escapeHtml(tag)}</span>
    `).join('');

    const projectsHtml = (agent.projects || []).map(p => {
      const pStats = p.stats || {};
      const pct = pStats.progressPct ?? 0;
      return `
        <button type="button" class="fleet-proj-pill" data-agent-id="${escapeHtml(agent.id)}" data-project-id="${escapeHtml(p.id)}" title="Open ${escapeHtml(p.name || p.id)} Project Board">
          <span class="proj-icon">📁</span>
          <span class="proj-name">${escapeHtml(p.name || p.id)}</span>
          <span class="proj-pct">${pct}%</span>
        </button>
      `;
    }).join('');

    return `
      <div class="fleet-agent-card" data-agent-id="${escapeHtml(agent.id)}">
        <div class="fleet-card-top">
          <div class="fleet-agent-header">
            <span class="fleet-agent-avatar">${escapeHtml(agent.icon || '🤖')}</span>
            <div class="fleet-agent-details">
              <span class="fleet-agent-name">${escapeHtml(agent.name || agent.id)}</span>
              <span class="fleet-agent-id">${escapeHtml(agent.id)}</span>
            </div>
          </div>
          <span class="fleet-status-pill online">ONLINE</span>
        </div>

        ${tagsHtml ? `<div class="fleet-tags-wrap">${tagsHtml}</div>` : ''}

        ${projectsHtml ? `
          <div class="fleet-projects-section">
            <span class="fleet-projects-label">WORKSPACE PROJECTS</span>
            <div class="fleet-projects-wrap">${projectsHtml}</div>
          </div>
        ` : ''}

        <div class="fleet-milestone-box">
          <div class="fleet-milestone-header">
            <span class="fleet-milestone-label">ACTIVE MILESTONE</span>
            <span class="fleet-milestone-pct">${stagePct}%</span>
          </div>
          <span class="fleet-milestone-title" title="${escapeHtml(stageTitle)}">${escapeHtml(stageTitle)}</span>
          <div class="fleet-card-progress">
            <div class="fleet-card-progress-bar" style="width: ${stagePct}%;"></div>
          </div>
        </div>

        <div class="fleet-metrics-strip">
          <div class="fleet-metric-pill">
            <span class="label">TOTAL</span>
            <span class="count">${stats.totalTasks}</span>
          </div>
          <div class="fleet-metric-pill">
            <span class="label">DONE</span>
            <span class="count" style="color: var(--accent-emerald);">${stats.doneTasks}</span>
          </div>
          <div class="fleet-metric-pill">
            <span class="label">ACTIVE</span>
            <span class="count" style="color: var(--status-in-progress);">${stats.inProgressTasks}</span>
          </div>
          <div class="fleet-metric-pill bugs">
            <span class="label">BUGS</span>
            <span class="count">${stats.openBugs}</span>
          </div>
        </div>

        <div class="fleet-card-actions">
          <button type="button" class="fleet-inspect-btn" data-action="inspect-agent" data-agent-id="${escapeHtml(agent.id)}">
            <span>Inspect Board</span> ↗
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (windowScrollY > 0) {
    window.scrollTo({ top: windowScrollY, behavior: 'instant' });
  }
}
