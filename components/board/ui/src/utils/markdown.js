export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function hasImplementationPlan(task) {
  if (!task || !task.details || typeof task.details !== 'string') return false;
  const trimmed = task.details.trim();
  if (!trimmed) return false;

  // Check if it's identical to the untouched default auto-scaffolded template
  const isDefaultBugTemplate = trimmed.includes('<!-- Observed buggy behavior, reproduction steps, or error stack -->') &&
    trimmed.includes('- [ ] 1. Identify failure point and edge case') &&
    trimmed.includes('- [ ] 2. Implement fix and guard checks');
  if (isDefaultBugTemplate) return false;

  const isDefaultTaskTemplate = trimmed.includes('<!-- Clear summary of deliverables for:') &&
    trimmed.includes('- [ ] 1. Design & scaffold implementation') &&
    trimmed.includes('- [ ] 2. Implement core logic / component') &&
    trimmed.includes('- [ ] 3. Wire UI and verify edge cases');
  if (isDefaultTaskTemplate) return false;

  // If it has substantial markdown details or custom plan text (length > 10 chars), consider it planned
  return trimmed.length > 10;
}

export function getPlanObjective(task) {
  if (!task || !task.details || typeof task.details !== 'string') return '';
  const text = task.details.trim();
  if (!text) return '';

  // 1. Try to find content under ### Objective or ### Defect Summary
  const objMatch = text.match(/###\s+(?:Objective|Defect Summary|Goal|Summary)\s*\n([\s\S]*?)(?=\n###|$)/i);
  if (objMatch && objMatch[1]) {
    // Strip markdown comments
    const clean = objMatch[1].replace(/<!--[\s\S]*?-->/g, '').trim();
    const firstLine = clean.split('\n').map(l => l.trim()).filter(Boolean)[0];
    if (firstLine && !firstLine.startsWith('- [')) return firstLine;
  }

  // 2. Try first non-header, non-comment line
  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('<!--') && !l.endsWith('-->'));
  
  if (lines.length > 0) {
    const candidate = lines[0].replace(/^[-*]\s+\[.\]\s+/, '').replace(/^[-*]\s+/, '').trim();
    if (candidate) return candidate;
  }

  return '';
}

export function renderMarkdown(md) {
  if (!md) return '<p>No content.</p>';

  let html = escapeHtml(md);

  // 1. Code blocks with language
  html = html.replace(/```([a-z0-9_\-]+)?\n([\s\S]*?)```/gi, (match, lang, code) => {
    return `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
  });

  // 2. Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 3. Headings
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // 4. Horizontal rules
  html = html.replace(/^---$/gim, '<hr>');

  // 5. Blockquotes & Alerts
  html = html.replace(/^&gt;\s+\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n((?:&gt;.*(?:\n|$))*)/gim, (match, type, body) => {
    const cleanBody = body.replace(/^&gt;\s?/gm, '').trim();
    return `<blockquote class="alert alert-${type.toLowerCase()}"><strong>${type}</strong>: ${cleanBody}</blockquote>`;
  });
  html = html.replace(/^&gt;\s+(.*$)/gim, '<blockquote>$1</blockquote>');

  // 6. Interactive Checklists (- [x] / - [ ])
  let checklistIdx = 0;
  html = html.replace(/^[-*]\s+\[(x|X)\]\s+(.*$)/gim, (match, mark, text) => {
    const idx = checklistIdx++;
    return `<li class="task-item checked" data-checklist-idx="${idx}"><span class="checklist-check-icon">☑</span><span class="checklist-text">${text}</span></li>`;
  });
  html = html.replace(/^[-*]\s+\[\s?\]\s+(.*$)/gim, (match, text) => {
    const idx = checklistIdx++;
    return `<li class="task-item" data-checklist-idx="${idx}"><span class="checklist-check-icon">☐</span><span class="checklist-text">${text}</span></li>`;
  });

  // 7. Standard Lists
  html = html.replace(/^[-*]\s+(.*$)/gim, '<li>$1</li>');

  // 8. Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 9. Tables
  html = html.replace(/((?:\|.*\|\r?\n)+)/g, (match) => {
    const rows = match.trim().split('\n');
    let tableHtml = '<table>';
    let isHeader = true;

    for (const r of rows) {
      if (/^\|\s*[-:]+[-| :]*\|$/.test(r.trim())) {
        isHeader = false;
        continue;
      }
      const cells = r.split('|').slice(1, -1);
      const tag = isHeader ? 'th' : 'td';
      tableHtml += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
    }
    tableHtml += '</table>';
    return tableHtml;
  });

  // 10. Paragraphs
  html = html.replace(/\n\n+/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean empty paragraphs around tags
  html = html.replace(/<p>\s*<(h[1-4]|pre|blockquote|table|hr|li)/gi, '<$1');
  html = html.replace(/<\/(h[1-4]|pre|blockquote|table|hr|li)>\s*<\/p>/gi, '</$1>');

  return html;
}
