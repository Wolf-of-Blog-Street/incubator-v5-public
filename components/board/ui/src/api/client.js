import { state, dom, showToast } from '../store/state.js';

/**
 * Fetches the multi-agent roster.
 */
export async function fetchRoster() {
  const res = await fetch('/api/v1/roster');
  if (!res.ok) throw new Error(`Roster API returned ${res.status}`);
  return await res.json();
}

/**
 * Fetches board summary, tasks, and design docs for active agent / project.
 */
export async function fetchBoardState(activeAgentId, activeProjectId) {
  const projectQuery = activeProjectId ? `&project=${encodeURIComponent(activeProjectId)}` : '';
  const agentQuery = activeAgentId ? `?agent=${encodeURIComponent(activeAgentId)}${projectQuery}` : (activeProjectId ? `?project=${encodeURIComponent(activeProjectId)}` : '');

  const [boardRes, tasksRes, docsRes] = await Promise.all([
    fetch(`/api/v1/board${agentQuery}`).then(r => r.ok ? r : fetch(`/api/board${agentQuery}`)),
    fetch(`/api/v1/tasks${agentQuery}`).then(r => r.ok ? r : fetch(`/api/tasks${agentQuery}`)),
    // No legacy /api/docs fallback: it ignores agent and project and would show the default agent's docs.
    fetch(`/api/v1/agents/${encodeURIComponent(activeAgentId)}/docs${activeProjectId ? `?project=${encodeURIComponent(activeProjectId)}` : ''}`)
  ]);

  if (!boardRes.ok || !tasksRes.ok) {
    throw new Error(`API returned ${boardRes.status} / ${tasksRes.status}`);
  }

  const summaryData = await boardRes.json();
  const tasksData = await tasksRes.json();
  const docsData = docsRes.ok ? await docsRes.json() : { docs: [] };

  return {
    summary: summaryData,
    tasks: tasksData.tasks || [],
    docs: docsData.docs || []
  };
}

/**
 * Quick status transition from card action buttons.
 */
export async function quickUpdateStatus(taskId, newStatus, onUpdated) {
  try {
    const params = new URLSearchParams();
    if (state.activeAgentId) params.set('agent', state.activeAgentId);
    if (state.activeProjectId) params.set('project', state.activeProjectId);
    const qs = params.toString() ? `?${params.toString()}` : '';

    const payload = {
      status: newStatus,
      agent: state.activeAgentId,
      project: state.activeProjectId
    };

    const res = await fetch(`/api/v1/tasks/${taskId}${qs}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.ok ? r : fetch(`/api/tasks/${taskId}${qs}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }));

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    showToast(`Task #${taskId} moved to ${newStatus}`, 'success');
    if (typeof onUpdated === 'function') onUpdated();
    return true;
  } catch (err) {
    showToast(`Update error: ${err.message}`, 'error');
    return false;
  }
}


/**
 * Updates a design doc's lifecycle status via the API.
 */
export async function updateDocStatus(slug, targetStatus, onUpdated) {
  try {
    const rawStatus = String(targetStatus || '').trim();
    const normalizedStatus = rawStatus.toLowerCase() === 'open' ? 'Active' : (rawStatus.toLowerCase() === 'closed' ? 'Closed' : rawStatus);
    const params = new URLSearchParams();
    if (state.activeAgentId) params.set('agent', state.activeAgentId);
    if (state.activeProjectId) params.set('project', state.activeProjectId);
    const qs = params.toString() ? `?${params.toString()}` : '';

    const payload = {
      status: normalizedStatus,
      agent: state.activeAgentId,
      project: state.activeProjectId
    };

    const res = await fetch(`/api/v1/docs/${encodeURIComponent(slug)}/status${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.ok ? r : fetch(`/api/docs/${encodeURIComponent(slug)}/status${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }));

    if (!res.ok) throw new Error(`Status update failed: ${res.status}`);
    const isClosedNow = ['closed', 'finished', 'archived', 'done'].includes(normalizedStatus.toLowerCase());
    showToast(`Design doc "${slug}" is now ${isClosedNow ? 'Closed 🏁' : 'Open 🟢'}!`, 'success');
    if (typeof onUpdated === 'function') onUpdated();
    return true;
  } catch (err) {
    showToast(`Error updating doc status: ${err.message}`, 'error');
    return false;
  }
}

/**
 * Creates a new task or bug.
 */
export async function createNewTask(payload) {
  const targetAgent = payload.agent || state.activeAgentId;
  const targetProject = payload.project || state.activeProjectId;
  const params = new URLSearchParams();
  if (targetAgent) params.set('agent', targetAgent);
  if (targetProject) params.set('project', targetProject);
  const qs = params.toString() ? `?${params.toString()}` : '';

  const fullPayload = {
    ...payload,
    agent: targetAgent,
    project: targetProject
  };

  const res = await fetch(`/api/v1/tasks${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fullPayload)
  }).then(r => r.ok ? r : fetch(`/api/tasks${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fullPayload)
  }));

  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return await res.json();
}

/**
 * Fetches the GitHub projects catalog and live agent seat inventory.
 */
export async function fetchProjects() {
  const res = await fetch('/api/v1/projects');
  if (!res.ok) throw new Error(`Projects API returned ${res.status}`);
  return await res.json();
}

/**
 * Registers a new project in the catalog.
 */
export async function createProject(payload) {
  const res = await fetch('/api/v1/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Server returned ${res.status}`);
  }
  return await res.json();
}

/**
 * Removes a project from the catalog.
 */
export async function deleteProject(projectId) {
  const res = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Server returned ${res.status}`);
  }
  return await res.json();
}

/**
 * Forces a re-scan of fleet agent workspace git remotes.
 */
export async function scanProjects() {
  const res = await fetch('/api/v1/projects/scan', {
    method: 'POST'
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Server returned ${res.status}`);
  }
  return await res.json();
}

