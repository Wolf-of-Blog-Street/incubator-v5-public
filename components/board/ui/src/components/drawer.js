import {
  state,
  dom,
  getTrackIcon,
  INDUSTRY_TRACKS,
  showToast
} from '../store/state.js';
import { renderMarkdown, escapeHtml } from '../utils/markdown.js';
import { openDocReader } from '../views/docsView.js';

export function populateTrackSelect(selectElement, selectedTrack = '') {
  if (!selectElement) return;

  const tracks = new Map();
  for (const item of INDUSTRY_TRACKS) {
    tracks.set(item.id, item.label);
  }

  (state.tasks || []).forEach(t => {
    if (t.track && !tracks.has(t.track)) {
      tracks.set(t.track, t.track);
    }
  });

  if (selectedTrack && !tracks.has(selectedTrack)) {
    tracks.set(selectedTrack, selectedTrack);
  }

  let html = '';
  for (const [id, label] of tracks.entries()) {
    const icon = getTrackIcon(id);
    const displayLabel = icon ? `${icon} ${label}` : label;
    html += `<option value="${escapeHtml(id)}">${escapeHtml(displayLabel)}</option>`;
  }
  html += '<option value="__custom__">➕ Custom track...</option>';

  selectElement.innerHTML = html;
  selectElement.value = selectedTrack || 'core';
}

export function handleTrackSelectChange(selectElement) {
  if (selectElement.value === '__custom__') {
    const custom = window.prompt('Enter custom track name (e.g. billing, ai, security):');
    const sanitized = custom ? custom.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') : '';
    if (sanitized) {
      const opt = document.createElement('option');
      opt.value = sanitized;
      opt.textContent = sanitized;
      selectElement.insertBefore(opt, selectElement.lastElementChild);
      selectElement.value = sanitized;
    } else {
      selectElement.value = 'core';
    }
  }
}

export function updateDrawerDocWidget(slug) {
  if (!dom.drawerDocWidget) return;
  if (!slug) {
    dom.drawerDocWidget.style.display = 'none';
    return;
  }
  const doc = (state.docs || []).find(d => d.slug === slug);
  dom.drawerDocWidget.style.display = 'block';
  dom.drawerDocTitle.textContent = doc ? doc.title : slug;
  dom.drawerDocSub.textContent = doc
    ? `${doc.status || 'Active'} · ${doc.author ? 'by ' + doc.author : 'Incubator v5'}`
    : 'Design Document';
  if (dom.btnOpenDocFromTask) {
    dom.btnOpenDocFromTask.onclick = (e) => {
      e.preventDefault();
      openDocReader(slug);
    };
  }
}

export function renderDrawerPlan(details) {
  if (!dom.drawerPlanContent || !dom.drawerDetailsInput) return;
  const content = details && details.trim() ? details.trim() : '<p style="color: var(--text-muted); font-style: italic;">No plan or checklist recorded for this task.</p>';
  dom.drawerPlanContent.innerHTML = renderMarkdown(content);
  dom.drawerDetailsInput.value = details || '';
}

export function setPlanTab(tab) {
  if (!dom.tabPlanInteractive || !dom.tabPlanEdit) return;
  if (tab === 'interactive') {
    dom.tabPlanInteractive.classList.add('active');
    dom.tabPlanEdit.classList.remove('active');
    if (dom.drawerPlanPreview) dom.drawerPlanPreview.style.display = 'block';
    if (dom.drawerPlanEditorWrap) dom.drawerPlanEditorWrap.style.display = 'none';
    if (dom.drawerDetailsInput) renderDrawerPlan(dom.drawerDetailsInput.value);
  } else {
    dom.tabPlanInteractive.classList.remove('active');
    dom.tabPlanEdit.classList.add('active');
    if (dom.drawerPlanPreview) dom.drawerPlanPreview.style.display = 'none';
    if (dom.drawerPlanEditorWrap) dom.drawerPlanEditorWrap.style.display = 'flex';
    if (dom.drawerDetailsInput) dom.drawerDetailsInput.focus();
  }
}

export async function toggleTaskChecklistItem(itemIndex, onRefresh) {
  const targetId = state.selectedTaskTenant?.taskId || state.selectedTaskId;
  if (!targetId) return;
  const agentId = state.selectedTaskTenant?.agentId || state.activeAgentId;
  const projectId = state.selectedTaskTenant?.projectId || state.activeProjectId;
  const params = new URLSearchParams();
  if (agentId) params.set('agent', agentId);
  if (projectId) params.set('project', projectId);
  const qs = params.toString() ? `?${params.toString()}` : '';

  try {
    const payload = { index: itemIndex, agent: agentId, project: projectId };
    const res = await fetch(`/api/v1/tasks/${targetId}/toggle-checklist${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.ok ? r : fetch(`/api/tasks/${targetId}/toggle-checklist${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }));

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    const updatedTask = data.task;

    const taskIdx = state.tasks.findIndex(t => t.id === updatedTask.id);
    if (taskIdx !== -1) {
      state.tasks[taskIdx] = updatedTask;
    }

    renderDrawerPlan(updatedTask.details);
    showToast('Checklist updated', 'info');
    if (typeof onRefresh === 'function') onRefresh();
  } catch (err) {
    showToast(`Failed to update checklist: ${err.message}`, 'error');
  }
}

export function openDrawer(taskId, initialTab = 'interactive') {
  const task = state.tasks.find(t => t.id === Number(taskId));
  if (!task || !dom.taskDrawer) return;

  state.selectedTaskId = task.id;
  state.selectedTaskTenant = {
    agentId: state.activeAgentId,
    projectId: state.activeProjectId,
    taskId: task.id
  };

  if (dom.drawerId) dom.drawerId.textContent = `#${task.id}`;
  if (dom.drawerTrackBadge) {
    dom.drawerTrackBadge.textContent = task.track;
    dom.drawerTrackBadge.className = `pill pill-track-${task.track}`;
  }

  if (dom.drawerTitleInput) dom.drawerTitleInput.value = task.title || '';
  if (dom.drawerStatusSelect) dom.drawerStatusSelect.value = task.status || 'planned';
  populateTrackSelect(dom.drawerTrackSelect, task.track || 'core');

  renderDrawerPlan(task.details);
  setPlanTab(initialTab);

  const docSlugs = new Set((state.docs || []).map(d => d.slug));
  if (task.design_slug && task.design_slug.trim()) {
    docSlugs.add(task.design_slug.trim());
  }

  let optionsHtml = '<option value="">-- None (Standalone Task / Bug) --</option>';
  for (const slug of docSlugs) {
    const doc = (state.docs || []).find(d => d.slug === slug);
    const title = doc ? `${doc.title} (${slug})` : slug;
    optionsHtml += `<option value="${escapeHtml(slug)}">${escapeHtml(title)}</option>`;
  }
  if (dom.drawerDocSelect) {
    dom.drawerDocSelect.innerHTML = optionsHtml;
    dom.drawerDocSelect.value = task.design_slug || '';
    dom.drawerDocSelect.onchange = () => updateDrawerDocWidget(dom.drawerDocSelect.value);
  }

  updateDrawerDocWidget(task.design_slug);

  if (dom.drawerCreatedAt) dom.drawerCreatedAt.textContent = task.created_at || '--';
  if (dom.drawerUpdatedAt) dom.drawerUpdatedAt.textContent = task.updated_at || '--';

  dom.taskDrawer.classList.add('open');
  dom.taskDrawer.setAttribute('aria-hidden', 'false');
}

export function closeDrawer() {
  if (dom.taskDrawer) {
    dom.taskDrawer.classList.remove('open');
    dom.taskDrawer.setAttribute('aria-hidden', 'true');
  }
  state.selectedTaskId = null;
  state.selectedTaskTenant = null;
}

export async function saveDrawerTask(onSaved) {
  const targetId = state.selectedTaskTenant?.taskId || state.selectedTaskId;
  if (!targetId) return;
  const agentId = state.selectedTaskTenant?.agentId || state.activeAgentId;
  const projectId = state.selectedTaskTenant?.projectId || state.activeProjectId;
  const params = new URLSearchParams();
  if (agentId) params.set('agent', agentId);
  if (projectId) params.set('project', projectId);
  const qs = params.toString() ? `?${params.toString()}` : '';

  const payload = {
    title: dom.drawerTitleInput.value.trim(),
    status: dom.drawerStatusSelect.value,
    track: dom.drawerTrackSelect.value,
    design_slug: dom.drawerDocSelect.value.trim() || null,
    details: dom.drawerDetailsInput.value.trim(),
    agent: agentId,
    project: projectId
  };

  try {
    const res = await fetch(`/api/v1/tasks/${targetId}${qs}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.ok ? r : fetch(`/api/tasks/${targetId}${qs}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }));

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    showToast(`Updated Task #${targetId}`, 'success');
    closeDrawer();
    if (typeof onSaved === 'function') onSaved();
  } catch (err) {
    showToast(`Failed to update task: ${err.message}`, 'error');
  }
}

export async function deleteDrawerTask(onDeleted) {
  const targetId = state.selectedTaskTenant?.taskId || state.selectedTaskId;
  if (!targetId) return;
  if (!confirm(`Are you sure you want to delete Task #${targetId}?`)) return;

  const agentId = state.selectedTaskTenant?.agentId || state.activeAgentId;
  const projectId = state.selectedTaskTenant?.projectId || state.activeProjectId;
  const params = new URLSearchParams();
  if (agentId) params.set('agent', agentId);
  if (projectId) params.set('project', projectId);
  const qs = params.toString() ? `?${params.toString()}` : '';

  try {
    const res = await fetch(`/api/v1/tasks/${targetId}${qs}`, {
      method: 'DELETE'
    }).then(r => r.ok ? r : fetch(`/api/tasks/${targetId}${qs}`, {
      method: 'DELETE'
    }));

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    showToast(`Deleted Task #${targetId}`, 'info');
    closeDrawer();
    if (typeof onDeleted === 'function') onDeleted();
  } catch (err) {
    showToast(`Delete failed: ${err.message}`, 'error');
  }
}
