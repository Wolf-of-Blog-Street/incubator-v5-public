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
export function findLatestRunForTarget(target, runsDir = path.join(WORKSPACE_ROOT, '.runs')) {
  if (!fs.existsSync(runsDir)) return null;
  // Runs live in .runs/<run> and, for sweep after sweep, in .runs/sweeps/<target-slug>/<run>.
  const dirs = d => fs.existsSync(d) ? fs.readdirSync(d).map(n => path.join(d, n)).filter(f => fs.statSync(f).isDirectory()) : [];
  const runs = [...dirs(runsDir), ...dirs(path.join(runsDir, 'sweeps')).flatMap(dirs)]
    .map(f => ({ path: f, mtimeMs: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  // A sweep of a file or folder inside the component counts, and so does a target given with a longer prefix.
  const hits = t => typeof t === 'string' && (t === target || t.endsWith(`/${target}`) || t.includes(`${target}/`));
  for (const run of runs) {
    for (const name of ['deep-summary.json', 'summary.json']) {
      const file = path.join(run.path, name);
      if (!fs.existsSync(file)) continue;
      try { if (hits(JSON.parse(fs.readFileSync(file, 'utf8')).target)) return run.path; } catch { /* unreadable run: skip it */ }
    }
  }
  return null;
}

/**
 * Extracts bugs from a sweep run directory.
 */
export function extractBugsFromRun(runDir, componentTarget) {
  const bugs = [];
  if (!runDir || !fs.existsSync(runDir)) return bugs;

  // A run with a judge verdict: only what the judge stamped goes to the board, from every model.
  // Raw model candidates are never logged. The text scraping below is for runs older than the JSON verdict.
  for (const name of ['deep-summary.json', 'summary.json']) {
    const file = path.join(runDir, name);
    if (!fs.existsSync(file)) continue;
    let judge = null;
    try { judge = JSON.parse(fs.readFileSync(file, 'utf8')).judge; } catch { /* unreadable: try the next source */ }
    if (!judge) continue;
    // The judge failed: nothing from this run is verified, so nothing goes to the board. No fall back to raw candidates.
    if (judge.judge_error || !Array.isArray(judge.stamped_bugs)) { console.log(`  ⚠️ ${path.basename(runDir)}: unjudged run, no bugs logged`); return []; }
    return judge.stamped_bugs.map(b => ({
      source: name === 'deep-summary.json' ? 'deep-judge' : 'gemini-judge',
      id: b.id,
      severity: b.severity || 'HIGH',
      category: b.category || 'invariant',
      title: b.title,
      file: b.file || componentTarget,
      root_cause: b.root_cause || b.real_world_impact || '',
      failure_scenario: b.failure_scenario || '',
      recommended_fix: b.recommended_fix || b.suggested_fix || '',
      test_code: null
    }));
  }

  // 1. Astra findings: the deep sweep writes them to astra/ (older runs used deep/).
  const astraResultFile = [path.join(runDir, 'astra', 'astra_result.txt'), path.join(runDir, 'deep', 'astra_result.txt')].find(f => fs.existsSync(f)) || '';
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
