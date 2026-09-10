import { state, dom, isDocOpen, showToast } from '../store/state.js';
import { escapeHtml } from '../utils/markdown.js';
import { populateTrackSelect } from './drawer.js';
import { createNewTask } from '../api/client.js';

/**
 * Opens task or bug creation modal dialog.
 */
export function openModal(isBug = false, defaultSlug = '') {
  if (!dom.taskDialog) return;

  if (dom.modalTitle) dom.modalTitle.textContent = isBug ? '🐛 Log a Bug' : 'Create New Task';
  if (dom.taskTitleInput) dom.taskTitleInput.value = '';
  if (dom.taskDetailsInput) dom.taskDetailsInput.value = '';
  if (dom.taskStatusSelect) dom.taskStatusSelect.value = 'planned';

  const defaultTrack = isBug ? 'bug' : 'core';
  populateTrackSelect(dom.taskTrackSelect, defaultTrack);

  // Strictly only open design docs
  const docSlugs = new Set((state.docs || []).filter(isDocOpen).map(d => d.slug));
  const validDefaultSlug = (defaultSlug && defaultSlug.trim() && isDocOpen(defaultSlug.trim())) ? defaultSlug.trim() : '';
  if (validDefaultSlug) {
    docSlugs.add(validDefaultSlug);
  }

  let optionsHtml = '<option value="">-- None (Standalone Task / Bug) --</option>';
  for (const slug of docSlugs) {
    const doc = (state.docs || []).find(d => d.slug === slug);
    const title = doc ? `${doc.title} (${slug})` : slug;
    optionsHtml += `<option value="${escapeHtml(slug)}">${escapeHtml(title)}</option>`;
  }

  if (dom.taskDocSelect) {
    dom.taskDocSelect.innerHTML = optionsHtml;
    dom.taskDocSelect.value = validDefaultSlug;
  }

  dom.taskDialog.showModal();
  if (dom.taskTitleInput) dom.taskTitleInput.focus();
}

/**
 * Closes modal dialog.
 */
export function closeModal() {
  if (dom.taskDialog && dom.taskDialog.open) {
    dom.taskDialog.close();
  }
}

/**
 * Handles submission of new task or bug form.
 */
export async function handleTaskFormSubmit(e, onCreated) {
  e.preventDefault();

  const payload = {
    title: dom.taskTitleInput.value.trim(),
    design_slug: dom.taskDocSelect.value.trim() || null,
    track: dom.taskTrackSelect.value,
    status: dom.taskStatusSelect.value,
    details: dom.taskDetailsInput.value.trim()
  };

  if (!payload.title) return;

  try {
    const data = await createNewTask(payload);
    closeModal();
    showToast(`Created Task #${data.task?.id || ''}`, 'success');
    if (typeof onCreated === 'function') onCreated();
  } catch (err) {
    showToast(`Failed to create task: ${err.message}`, 'error');
  }
}
