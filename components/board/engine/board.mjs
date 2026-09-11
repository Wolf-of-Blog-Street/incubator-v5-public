import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { reconcileDocStatusSync } from '../api/services/docService.mjs';

// Suppress Node's experimental SQLite warning
{
  const prior = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w && w.name === 'ExperimentalWarning' && /SQLite/i.test(String(w.message))) return;
    for (const l of prior) l(w);
  });
}

export const VALID_STATUSES = ['planned', 'in-progress', 'review', 'done', 'blocked'];
export const VALID_MODES = ['pair', 'runner'];
export const DEFAULT_TRACKS = [
  'core',
  'feature',
  'bug',
  'frontend',
  'backend',
  'api',
  'ux',
  'db',
  'infra',
  'docs',
  'test',
  'eval',
  'perf'
];
export const VALID_TRACKS = [...DEFAULT_TRACKS, 'pipeline', 'engine', 'harness', 'sweeper', 'runner'];

export function generateDefaultTaskPlan(title, track = 'core', brief = null) {
  return [
    `## Objective`,
    `${brief && brief.trim() ? brief.trim() : title}`,
    ``,
    `> **Pair-Programmer Mode**: All tasks are executed in pair-programmer mode.`,
    `> - **Dev 1 (Implementer)**: Does the first 3 parts (design, implementation, verification). Leaves task in \`in-review\` for Dev 2.`,
    `> - **Dev 2 (Pair / Reviewer)**: Reviews the work, adds review notes to the task, and moves to \`done\` upon passing.`,
    `> - **Cycle**: This cycle repeats until the task is complete. Dev 1 implements and fixes, Dev 2 reviews and approves.`,
    ``,
    `## Plan & Subtasks`,
    `- [ ] 1. Initial design and analysis for [${track}] ${title}. Investigate what parts of the codebase this change will touch and plan out your work. (Dev 1)`,
    `- [ ] 2. Implementation: focus on the work. Don't invent useless tests to "verify". (Dev 1)`,
    `- [ ] 3. Code verification: test that it works. Don't use useless unit tests here either. Verify it the way a real user would. After verification leave the task in in-review for the operator, don't move to done until after pair-review. (Dev 1)`,
    `- [ ] 4. Pair review & approval: review the work according to the same rules (no useless tests, verify like a real user would). Add review notes to the task. If it passes, move to done. If there is a fault, note that in the review notes. (Dev 2)`
  ].join('\n');
}

export function openBoard(dbPath, options = {}) {
  if (!dbPath) throw new Error('dbPath is required');

  const isMemory = dbPath === ':memory:';
  const resolvedPath = isMemory ? ':memory:' : path.resolve(dbPath);
  if (!isMemory) {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      design_slug TEXT,
      track       TEXT NOT NULL DEFAULT 'core',
      title       TEXT NOT NULL,
      details     TEXT,
      status      TEXT NOT NULL DEFAULT 'planned',
      mode        TEXT NOT NULL DEFAULT 'pair',
      gate        TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_design_slug ON items(design_slug);
    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
  `);

  return {
    docsDir: options.docsDir || null,
    rootDir: options.rootDir || null,
    resolvedDocsDir: options.resolvedDocsDir || null,
    resolvedSyncDocsDir: options.resolvedSyncDocsDir || null,
    targetAgent: options.targetAgent || null,
    targetProject: options.targetProject || null,

    addItem({ design_slug = null, track = 'core', title, details = null, status = 'planned', mode = 'pair', gate = null }) {
      if (typeof title !== 'string' || !title.trim()) throw new Error('Task title is required');
      if (!VALID_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}. Expected: ${VALID_STATUSES.join(', ')}`);
      if (!VALID_MODES.includes(mode)) throw new Error(`Invalid mode: ${mode}. Expected: ${VALID_MODES.join(', ')}`);
      if (track && !VALID_TRACKS.includes(track)) throw new Error(`Invalid track: ${track}. Expected: ${VALID_TRACKS.join(', ')}`);

      // Every job carries the pair-programmer checklist. Caller-supplied details become the objective
      // unless they already contain a plan section (re-imports, explicit checklists).
      const hasPlan = /^##\s*Plan\s*&\s*Subtasks/im.test(details || '');
      const effectiveDetails = hasPlan ? details.trim() : generateDefaultTaskPlan(title.trim(), track, details);
      const now = new Date().toISOString();
      let newId;
      if (gate !== null && gate !== undefined) {
        const stmt = db.prepare(`
          INSERT INTO items (design_slug, track, title, details, status, mode, gate, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const res = stmt.run(design_slug || null, track || 'core', title.trim(), effectiveDetails, status, mode, gate, now, now);
        newId = Number(res.lastInsertRowid);
      } else {
        const stmt = db.prepare(`
          INSERT INTO items (design_slug, track, title, details, status, mode, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const res = stmt.run(design_slug || null, track || 'core', title.trim(), effectiveDetails, status, mode, now, now);
        newId = Number(res.lastInsertRowid);
      }

      if (design_slug) {
        try {
          reconcileDocStatusSync(design_slug, {
            board: this,
            docsDir: this.docsDir,
            rootDir: this.rootDir,
            resolvedDocsDir: this.resolvedDocsDir,
            resolvedSyncDocsDir: this.resolvedSyncDocsDir,
            targetAgent: this.targetAgent,
            targetProject: this.targetProject
          });
        } catch (_) {}
      }

      return newId;
    },

    toggleChecklistItem(id, itemIndex) {
      if (!id) throw new Error('Task id is required');
      const item = this.getItem(id);
      if (!item) throw new Error(`Task #${id} not found`);

      let details = item.details || '';
      let matchIdx = 0;
      let toggled = false;

      // Match markdown checklist items: - [ ] or - [x]
      const updatedDetails = details.replace(/^(\s*[-*]\s*\[)([\sxX])(\].*)$/gm, (fullMatch, prefix, mark, suffix) => {
        if (matchIdx === itemIndex) {
          toggled = true;
          const newMark = (mark.trim().toLowerCase() === 'x') ? ' ' : 'x';
          matchIdx++;
          return `${prefix}${newMark}${suffix}`;
        }
        matchIdx++;
        return fullMatch;
      });

      if (!toggled) {
        throw new Error(`Checklist item index ${itemIndex} not found in Task #${id}`);
      }

      return this.updateItem(id, { details: updatedDetails });
    },

    updateItem(id, updates) {
      if (!id) throw new Error('Task id is required');
      const item = this.getItem(id);
      if (!item) throw new Error(`Task #${id} not found`);

      const fields = [];
      const values = [];

      if (updates.title !== undefined) {
        if (typeof updates.title !== 'string' || !updates.title.trim()) throw new Error('Task title cannot be empty');
        fields.push('title = ?');
        values.push(updates.title.trim());
      }
      if (updates.design_slug !== undefined) {
        fields.push('design_slug = ?');
        values.push(updates.design_slug || null);
      }
      if (updates.track !== undefined) {
        if (!VALID_TRACKS.includes(updates.track)) {
          throw new Error(`Invalid track: ${updates.track}. Expected: ${VALID_TRACKS.join(', ')}`);
        }
        fields.push('track = ?');
        values.push(updates.track);
      }
      if (updates.details !== undefined) {
        fields.push('details = ?');
        values.push(updates.details);
      }
      if (updates.status !== undefined) {
        if (!VALID_STATUSES.includes(updates.status)) {
          throw new Error(`Invalid status: ${updates.status}. Expected: ${VALID_STATUSES.join(', ')}`);
        }
        fields.push('status = ?');
        values.push(updates.status);
      }
      if (updates.mode !== undefined) {
        if (!VALID_MODES.includes(updates.mode)) {
          throw new Error(`Invalid mode: ${updates.mode}. Expected: ${VALID_MODES.join(', ')}`);
        }
        fields.push('mode = ?');
        values.push(updates.mode);
      }
      if (updates.gate !== undefined) {
        fields.push('gate = ?');
        values.push(updates.gate);
      }

      if (fields.length === 0) return item;

      fields.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(id);

      db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      const updatedItem = this.getItem(id);

      try {
        if (item.design_slug) {
          reconcileDocStatusSync(item.design_slug, {
            board: this,
            docsDir: this.docsDir,
            rootDir: this.rootDir,
            resolvedDocsDir: this.resolvedDocsDir,
            resolvedSyncDocsDir: this.resolvedSyncDocsDir,
            targetAgent: this.targetAgent,
            targetProject: this.targetProject
          });
        }
        if (updatedItem.design_slug && updatedItem.design_slug !== item.design_slug) {
          reconcileDocStatusSync(updatedItem.design_slug, {
            board: this,
            docsDir: this.docsDir,
            rootDir: this.rootDir,
            resolvedDocsDir: this.resolvedDocsDir,
            resolvedSyncDocsDir: this.resolvedSyncDocsDir,
            targetAgent: this.targetAgent,
            targetProject: this.targetProject
          });
        }
      } catch (_) {}

      return updatedItem;
    },

    getItem(id) {
      const stmt = db.prepare('SELECT * FROM items WHERE id = ?');
      return stmt.get(id) || null;
    },

    deleteItem(id) {
      const oldItem = this.getItem(id);
      const stmt = db.prepare('DELETE FROM items WHERE id = ?');
      const res = stmt.run(id);

      if (oldItem && oldItem.design_slug) {
        try {
          reconcileDocStatusSync(oldItem.design_slug, {
            board: this,
            docsDir: this.docsDir,
            rootDir: this.rootDir,
            resolvedDocsDir: this.resolvedDocsDir,
            resolvedSyncDocsDir: this.resolvedSyncDocsDir,
            targetAgent: this.targetAgent,
            targetProject: this.targetProject
          });
        } catch (_) {}
      }

      return res.changes > 0;
    },

    listItems({ design_slug, status, mode, track } = {}) {
      const conditions = [];
      const params = [];

      if (design_slug !== undefined) {
        if (design_slug === null) {
          conditions.push('design_slug IS NULL');
        } else {
          conditions.push('design_slug = ?');
          params.push(design_slug);
        }
      }
      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }
      if (mode) {
        conditions.push('mode = ?');
        params.push(mode);
      }
      if (track) {
        conditions.push('track = ?');
        params.push(track);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const stmt = db.prepare(`SELECT * FROM items ${whereClause} ORDER BY id ASC`);
      return stmt.all(...params);
    },

    getStageSummary(design_slug) {
      const items = this.listItems({ design_slug });
      const total = items.length;
      const done = items.filter((i) => i.status === 'done').length;
      const inProgress = items.filter((i) => i.status === 'in-progress').length;
      const planned = items.filter((i) => i.status === 'planned').length;
      const review = items.filter((i) => i.status === 'review').length;
      const blocked = items.filter((i) => i.status === 'blocked').length;

      return {
        design_slug,
        total,
        done,
        inProgress,
        planned,
        review,
        blocked,
        percentComplete: total === 0 ? 0 : Math.round((done / total) * 100),
      };
    },

    getBoardSummary() {
      const allItems = this.listItems();
      const stageMap = {};
      const standaloneItems = [];

      for (const item of allItems) {
        const slug = item.design_slug ? item.design_slug.trim() : '';
        if (!slug || slug.toLowerCase() === 'standalone') {
          standaloneItems.push(item);
        } else {
          if (!stageMap[slug]) stageMap[slug] = [];
          stageMap[slug].push(item);
        }
      }

      const stages = Object.entries(stageMap).map(([stage, items]) => {
        const total = items.length;
        const done = items.filter((i) => i.status === 'done').length;
        const inProgress = items.filter((i) => i.status === 'in-progress').length;
        const planned = items.filter((i) => i.status === 'planned').length;
        const review = items.filter((i) => i.status === 'review').length;
        const blocked = items.filter((i) => i.status === 'blocked').length;
        const bugs = items.filter((i) => i.track === 'bug').length;
        const openBugs = items.filter((i) => i.track === 'bug' && i.status !== 'done').length;
        const progress = total === 0 ? 0 : Math.round((done / total) * 100);
        return {
          design_slug: stage,
          slug: stage,
          total,
          done,
          inProgress,
          planned,
          review,
          blocked,
          bugs,
          openBugs,
          progress,
          percentComplete: progress,
        };
      });

      const totalTasks = allItems.length;
      const totalDone = allItems.filter((i) => i.status === 'done').length;
      const openBugs = allItems.filter((i) => i.track === 'bug' && i.status !== 'done').length;
      const totalBugs = allItems.filter((i) => i.track === 'bug').length;
      const overallPercent = totalTasks === 0 ? 0 : Math.round((totalDone / totalTasks) * 100);

      const standaloneTotal = standaloneItems.length;
      const standaloneDone = standaloneItems.filter((i) => i.status === 'done').length;
      const standalone = {
        total: standaloneTotal,
        done: standaloneDone,
        inProgress: standaloneItems.filter((i) => i.status === 'in-progress').length,
        planned: standaloneItems.filter((i) => i.status === 'planned').length,
        bugs: standaloneItems.filter((i) => i.track === 'bug').length,
        openBugs: standaloneItems.filter((i) => i.track === 'bug' && i.status !== 'done').length,
        progress: standaloneTotal === 0 ? 0 : Math.round((standaloneDone / standaloneTotal) * 100),
      };

      return {
        totalTasks,
        totalDone,
        openBugs,
        totalBugs,
        overallProgress: overallPercent,
        overallPercentComplete: overallPercent,
        stages,
        standalone,
      };
    },

    closeDesignDoc(designSlug, { force = false } = {}) {
      if (!designSlug) throw new Error('designSlug is required');
      const items = this.listItems({ design_slug: designSlug });
      if (items.length === 0) {
        return {
          closed: true,
          designSlug,
          total: 0,
          done: 0,
          percentComplete: 100,
          openTasks: [],
        };
      }

      const total = items.length;
      const done = items.filter((i) => i.status === 'done').length;
      const openTasks = items.filter((i) => i.status !== 'done');

      if (openTasks.length > 0 && !force) {
        return {
          closed: false,
          designSlug,
          total,
          done,
          percentComplete: Math.round((done / total) * 100),
          openTasks,
          error: `Cannot close design doc "${designSlug}": ${openTasks.length} task(s) still open. Use --force to close anyway.`
        };
      }

      try {
        reconcileDocStatusSync(designSlug, {
          board: this,
          docsDir: this.docsDir,
          rootDir: this.rootDir,
          resolvedDocsDir: this.resolvedDocsDir,
          resolvedSyncDocsDir: this.resolvedSyncDocsDir,
          targetAgent: this.targetAgent,
          targetProject: this.targetProject,
          forceClose: true
        });
      } catch (_) {}

      return {
        closed: true,
        designSlug,
        total,
        done,
        percentComplete: Math.round((done / total) * 100),
        openTasks: []
      };
    },

    reopenDesignDoc(designSlug) {
      if (!designSlug) throw new Error('designSlug is required');
      const items = this.listItems({ design_slug: designSlug });
      try {
        reconcileDocStatusSync(designSlug, {
          board: this,
          docsDir: this.docsDir,
          rootDir: this.rootDir,
          resolvedDocsDir: this.resolvedDocsDir,
          resolvedSyncDocsDir: this.resolvedSyncDocsDir,
          targetAgent: this.targetAgent,
          targetProject: this.targetProject,
          forceReopen: true
        });
      } catch (_) {}
      return {
        reopened: true,
        designSlug,
        total: items.length
      };
    },

    close() {
      db.close();
    },
  };
}
