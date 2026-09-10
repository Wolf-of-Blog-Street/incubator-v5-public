import fs from 'node:fs';
import path from 'node:path';

/**
 * Parses user stories, goals, and interface contracts from a design doc markdown.
 * 
 * @param {string} content Markdown content of the design doc or spec
 * @param {string} filePath Source path of the spec
 * @returns {Array<Object>} List of structured user stories
 */
export function parseStoriesFromSpec(content, filePath = '') {
  const stories = [];
  const lines = content.split('\n');
  const baseName = path.basename(filePath, '.md');

  // 1. Extract goals (- [ ] or - [x] items)
  let inGoals = false;
  let inContracts = false;
  let contractLines = [];
  let storyIndex = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^##\s+2\.\s+Goals/i.test(trimmed) || /^##\s+Goals/i.test(trimmed)) {
      inGoals = true;
      inContracts = false;
      continue;
    } else if (/^##\s+3\.\s+Data Models/i.test(trimmed) || /^##\s+Interface Contracts/i.test(trimmed) || /^##\s+3\.\s+/i.test(trimmed)) {
      inGoals = false;
      inContracts = true;
      continue;
    } else if (/^##\s+/i.test(trimmed)) {
      inGoals = false;
      inContracts = false;
    }

    if (inGoals) {
      const match = trimmed.match(/^-\s*\[([ xX])\]\s*(?:\*\*(.*?)\*\*:\s*)?(.*)$/);
      if (match) {
        const title = match[2] || `Goal ${storyIndex}`;
        const desc = match[3] || match[0];
        stories.push({
          id: `STORY-${storyIndex++}`,
          title: title.trim(),
          actor: 'Operator / System Agent',
          action: desc.trim(),
          expected_outcome: `The system must satisfy: ${desc.trim()}`,
          source: path.basename(filePath)
        });
      }
    }

    if (inContracts) {
      if (trimmed.startsWith('```') || contractLines.length > 0) {
        contractLines.push(line);
      }
    }
  }

  // If no checkbox goals were found, extract from high level headings
  if (stories.length === 0) {
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : baseName;
    stories.push({
      id: 'STORY-1',
      title: `Core Spec: ${title}`,
      actor: 'Operator / Agent',
      action: `Execute operations defined in ${baseName}`,
      expected_outcome: `The target component successfully implements the functionality and contracts defined in ${baseName}.`,
      source: path.basename(filePath)
    });
  }

  return stories;
}

/**
 * Searches for a design doc or documentation file matching the given target path.
 * 
 * @param {string} targetPath File or directory path of the target
 * @param {string} baseDir Base directory
 * @returns {string|null} Resolved spec path if found
 */
export function autoDiscoverSpec(targetPath, baseDir = process.cwd()) {
  const targetAbs = path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath);
  const targetBase = path.basename(targetAbs);
  const searchDirs = [
    path.join(baseDir, 'docs/design'),
    path.join(baseDir, '../docs/design'),
    path.join(baseDir, 'design'),
    path.join(baseDir, 'docs'),
    targetAbs,
    path.dirname(targetAbs)
  ];

  // 1. Check for README.md in target directory or parent
  const localReadme = path.join(fs.existsSync(targetAbs) && fs.statSync(targetAbs).isDirectory() ? targetAbs : path.dirname(targetAbs), 'README.md');
  if (fs.existsSync(localReadme)) {
    return localReadme;
  }

  // 2. Scan design doc directories
  for (const dir of searchDirs) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith('.md') && file !== 'INDEX.md') {
          const filePath = path.join(dir, file);
          try {
            const text = fs.readFileSync(filePath, 'utf8');
            // Check if doc mentions the target component or path
            if (
              file.includes(targetBase) ||
              text.includes(`components/${targetBase}`) ||
              text.includes(targetPath) ||
              text.includes(`\`${targetBase}\``)
            ) {
              return filePath;
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }

  return null;
}

/**
 * Resolves user stories for the sweep target from explicit text, a spec path, or auto-discovery.
 * 
 * @param {Object} options
 * @param {string} options.target Target path
 * @param {string} [options.storyText] Raw user story text
 * @param {string} [options.specPath] Path to explicit spec file
 * @param {string} [options.baseDir] Base directory
 * @returns {Object} { specSource: string|null, stories: Array<Object> }
 */
export function resolveStories({ target, storyText = null, specPath = null, baseDir = process.cwd() }) {
  // 1. Explicit story text provided
  if (storyText && typeof storyText === 'string' && storyText.trim().length > 0) {
    const rawStories = storyText.split(/\n\s*---\s*\n|\n\s*;\s*\n/).filter(s => s.trim().length > 0);
    const stories = rawStories.map((s, idx) => ({
      id: `US-${idx + 1}`,
      title: `User Story ${idx + 1}`,
      actor: 'User / Agent Operator',
      action: s.trim(),
      expected_outcome: s.trim(),
      source: 'CLI Argument (--story)'
    }));
    return { specSource: 'CLI Argument (--story)', stories };
  }

  // 2. Explicit spec file provided
  if (specPath) {
    const resolvedSpec = path.isAbsolute(specPath) ? specPath : path.resolve(baseDir, specPath);
    if (!fs.existsSync(resolvedSpec)) {
      throw new Error(`Specified spec file does not exist: ${specPath}`);
    }
    const content = fs.readFileSync(resolvedSpec, 'utf8');
    const stories = parseStoriesFromSpec(content, resolvedSpec);
    return { specSource: resolvedSpec, stories };
  }

  // 3. Auto-discovery
  const discovered = autoDiscoverSpec(target, baseDir);
  if (discovered) {
    const content = fs.readFileSync(discovered, 'utf8');
    const stories = parseStoriesFromSpec(content, discovered);
    return { specSource: discovered, stories };
  }

  // 4. Default baseline story inferred from target
  const targetBase = path.basename(target);
  return {
    specSource: 'Auto-Inferred Baseline',
    stories: [
      {
        id: 'US-DEFAULT-01',
        title: `Functional Execution of ${targetBase}`,
        actor: 'Developer / Automated Seat',
        action: `Invoke and execute operations of ${targetBase} in realistic multi-directory / multi-agent environments.`,
        expected_outcome: `The component must fulfill its declared APIs and CLI commands, discover required environment configurations, and avoid silent failures or offline degradation.`,
        source: 'Auto-Inferred Baseline'
      }
    ]
  };
}

/**
 * Formats user stories into clean markdown for LLM prompt injection.
 * 
 * @param {Array<Object>} stories List of story objects
 * @param {string} specSource Origin of the stories
 * @returns {string} Formatted markdown block
 */
export function formatStoriesContext(stories, specSource = 'N/A') {
  const lines = [];
  lines.push(`## 🎯 User Stories & Intended Functionality`);
  lines.push(`_Source: \`${specSource}\`_`);
  lines.push('');
  lines.push(`Your audit must evaluate whether the code fulfills these real-world user stories. Do NOT look for theoretical edge cases or cosmetic nitpicks. Mentally simulate an operator or agent executing each story step-by-step.`);
  lines.push('');

  for (const s of stories) {
    lines.push(`### [${s.id}] ${s.title}`);
    lines.push(`- **Actor**: ${s.actor}`);
    lines.push(`- **Action / Workflow**: ${s.action}`);
    lines.push(`- **Expected Outcome**: ${s.expected_outcome}`);
    lines.push('');
  }

  return lines.join('\n');
}
