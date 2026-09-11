#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBoard } from '../../board/engine/board.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');

const COMPONENT_DESIGN_SLUGS = {
  'components/board': 'falcon-manager-board-roster',
  'components/friends': 'friends-account-management',
  'components/harness': 'fleet-manager-orchestration',
  'components/docs': 'v5-foundation',
  'components/brain': 'v5-foundation',
  'components/sweeper': 'v5-foundation',
};

/**
 * Finds the latest run directory in .runs matching a specific target component.
 */
function findLatestRunForTarget(target) {
  const runsDir = path.join(WORKSPACE_ROOT, '.runs');
  if (!fs.existsSync(runsDir)) return null;

  const entries = fs.readdirSync(runsDir)
    .map(name => {
      const fullPath = path.join(runsDir, name);
      const stat = fs.statSync(fullPath);
      return { name, path: fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const entry of entries) {
    const summaryPath = path.join(entry.path, 'deep-summary.md');
    const baselinePath = path.join(entry.path, 'baseline', 'summary.md');
    if (fs.existsSync(summaryPath)) {
      const content = fs.readFileSync(summaryPath, 'utf8');
      if (content.includes(`Target: \`${target}\``) || content.includes(`Target**: \`${target}\``)) {
        return entry.path;
      }
    } else if (fs.existsSync(baselinePath)) {
      const content = fs.readFileSync(baselinePath, 'utf8');
      if (content.includes(`Target: \`${target}\``) || content.includes(`Target**: \`${target}\``)) {
        return entry.path;
      }
    }
  }

  return null;
}

/**
 * Extracts bugs from a sweep run directory.
 */
function extractBugsFromRun(runDir, componentTarget) {
  const bugs = [];
  if (!runDir || !fs.existsSync(runDir)) return bugs;

  // 1. Check deep/astra_result.txt
  const astraResultFile = path.join(runDir, 'deep', 'astra_result.txt');
  if (fs.existsSync(astraResultFile)) {
    const raw = fs.readFileSync(astraResultFile, 'utf8');
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, raw];
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      const findings = parsed.findings || [];
      for (const f of findings) {
        bugs.push({
          source: 'astra-high',
          id: f.id,
          severity: f.severity || 'HIGH',
          category: f.category || 'security',
          title: f.title,
          file: f.file || componentTarget,
          root_cause: f.root_cause || '',
          failure_scenario: f.failure_scenario || '',
          recommended_fix: f.recommended_fix || '',
          test_code: f.test_code || null
        });
      }
    } catch {
      // Ignored
    }
  }

  // 2. Check baseline summary for stamped bugs
  const baselineSummary = path.join(runDir, 'baseline', 'summary.md');
  if (fs.existsSync(baselineSummary)) {
    const content = fs.readFileSync(baselineSummary, 'utf8');
    // Simple extraction of stamped bugs
    const stampedSection = content.split('## 🚨 Stamped Bugs')[1]?.split(/\n## /)[0] || '';
    if (stampedSection && !stampedSection.includes('_No critical or invariant bugs stamped')) {
      const bugBlocks = stampedSection.split(/### \[(CRITICAL|HIGH|MEDIUM|LOW)\]/g);
      for (let i = 1; i < bugBlocks.length; i += 2) {
        const severity = bugBlocks[i];
        const block = bugBlocks[i + 1] || '';
        const titleMatch = block.match(/^([^\n]+)/);
        const title = titleMatch ? titleMatch[1].trim().replace(/\(`[^`]+`\)$/, '').trim() : 'Stamped Invariant Violation';
        const fileMatch = block.match(/- \*\*Location\*\*: `([^`]+)`/);
        const rootCauseMatch = block.match(/- \*\*Root Cause\*\*: ([^\n]+)/);
        const fixMatch = block.match(/- \*\*Recommended Action\*\*: ([^\n]+)/);

        bugs.push({
          source: 'gemini-judge',
          id: `BASE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          severity,
          category: 'invariant',
          title,
          file: fileMatch ? fileMatch[1] : componentTarget,
          root_cause: rootCauseMatch ? rootCauseMatch[1].trim() : '',
          failure_scenario: '',
          recommended_fix: fixMatch ? fixMatch[1].trim() : '',
          test_code: null
        });
      }
    }
  }

  return bugs;
}

export async function collectAndLog({ dbPath = path.join(WORKSPACE_ROOT, 'boards/incubator-v5.sqlite'), dryRun = false } = {}) {
  const board = openBoard(dbPath);
  const existingTasks = board.listItems();
  const existingTitles = new Set(existingTasks.map(t => t.title.toLowerCase().trim()));

  const components = [
    'components/board',
    'components/brain',
    'components/docs',
    'components/friends',
    'components/harness',
    'components/sweeper'
  ];

  const report = [];

  for (const comp of components) {
    const runDir = findLatestRunForTarget(comp);
    const bugs = extractBugsFromRun(runDir, comp);
    const slug = COMPONENT_DESIGN_SLUGS[comp] || 'v5-foundation';
    const logged = [];

    for (const b of bugs) {
      const compShort = path.basename(comp);
      const cardTitle = `[${compShort}] ${b.title}`;
      if (existingTitles.has(cardTitle.toLowerCase().trim())) {
        logged.push({ ...b, status: 'already_exists', cardTitle });
        continue;
      }

      const details = [
        `**Component**: \`${comp}\``,
        `**Auditor**: \`${b.source}\` (${b.severity})`,
        `**File/Location**: \`${b.file}\``,
        `**Root Cause**: ${b.root_cause}`,
        b.failure_scenario ? `**Failure Scenario**: ${b.failure_scenario}` : '',
        `**Recommended Fix**: ${b.recommended_fix}`,
        b.test_code ? `\n\`\`\`javascript\n${b.test_code}\n\`\`\`` : ''
      ].filter(Boolean).join('\n\n');

      if (!dryRun) {
        const id = board.addItem({
          design_slug: slug,
          track: 'bug',
          title: cardTitle,
          details,
          status: 'planned',
          mode: 'runner'
        });
        existingTitles.add(cardTitle.toLowerCase().trim());
        logged.push({ ...b, id, status: 'created', cardTitle });
      } else {
        logged.push({ ...b, id: 'DRY-RUN', status: 'dry_run', cardTitle });
      }
    }

    report.push({
      component: comp,
      runDir,
      totalBugsFound: bugs.length,
      loggedBugs: logged
    });
  }

  board.close();
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('collect-and-log-bugs.mjs')) {
  collectAndLog().then(report => {
    console.log(JSON.stringify(report, null, 2));
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
