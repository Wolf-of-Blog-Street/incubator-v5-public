import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openBoard } from '../engine/board.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '../tools/board.mjs');

test('board engine manages stage tasks across pair and runner modes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-board-test-'));
  const dbPath = path.join(tmpDir, 'test-board.sqlite');

  try {
    const board = openBoard(dbPath);

    // 1. Add tasks across tracks and modes
    const id1 = board.addItem({
      title: 'Page structure SQLite schema',
      design_slug: 'page-structure',
      track: 'db',
      mode: 'pair',
    });
    const id2 = board.addItem({
      title: 'Block and section assembly pipeline',
      design_slug: 'page-structure',
      track: 'pipeline',
      mode: 'pair',
    });
    const id3 = board.addItem({
      title: 'Visual section inspection viewer',
      design_slug: 'page-structure',
      track: 'ux',
      mode: 'runner',
    });

    assert.equal(id1, 1);
    assert.equal(id2, 2);
    assert.equal(id3, 3);

    // 2. Query stage summary
    let summary = board.getStageSummary('page-structure');
    assert.equal(summary.total, 3);
    assert.equal(summary.done, 0);
    assert.equal(summary.percentComplete, 0);

    // 3. Update status to in-progress and done
    board.updateItem(id1, { status: 'done' });
    board.updateItem(id2, { status: 'in-progress' });

    const item1 = board.getItem(id1);
    assert.equal(item1.status, 'done');
    assert.equal(item1.mode, 'pair');

    summary = board.getStageSummary('page-structure');
    assert.equal(summary.done, 1);
    assert.equal(summary.inProgress, 1);
    assert.equal(summary.planned, 1);
    assert.equal(summary.percentComplete, 33);

    // 4. Test filtering
    const runnerTasks = board.listItems({ mode: 'runner' });
    assert.equal(runnerTasks.length, 1);
    assert.equal(runnerTasks[0].title, 'Visual section inspection viewer');

    board.close();

    // 5. Test CLI functionality and bug creation
    const cliBugOut = execFileSync(
      process.execPath,
      [CLI_PATH, 'bug', 'Null pointer on empty payload', '--doc', 'page-structure', '--db', dbPath],
      { encoding: 'utf8' }
    );
    assert.match(cliBugOut, /🐛 Bug #4 logged/);

    const cliListOut = execFileSync(
      process.execPath,
      [CLI_PATH, 'list', '--db', dbPath],
      { encoding: 'utf8' }
    );
    assert.match(cliListOut, /Stage \/ Design: page-structure/);
    assert.match(cliListOut, /\[🐛 bug\]/);
    assert.match(cliListOut, /🐛 1 bug\(s\)/);

    // 6. Test closeDesignDoc
    const boardReopen = openBoard(dbPath);
    const incompleteClose = boardReopen.closeDesignDoc('page-structure');
    assert.equal(incompleteClose.closed, false);
    assert.match(incompleteClose.error, /task\(s\) still open/);

    // Complete remaining tasks
    boardReopen.updateItem(2, { status: 'done' });
    boardReopen.updateItem(3, { status: 'done' });
    boardReopen.updateItem(4, { status: 'done' });

    const completeClose = boardReopen.closeDesignDoc('page-structure');
    assert.equal(completeClose.closed, true);
    assert.equal(completeClose.percentComplete, 100);
    boardReopen.close();

    // Test CLI close-doc
    const cliCloseOut = execFileSync(
      process.execPath,
      [CLI_PATH, 'close-doc', 'page-structure', '--db', dbPath],
      { encoding: 'utf8' }
    );
    assert.match(cliCloseOut, /Design Doc "page-structure" is CLOSED!/);

    // 7. Test defensive validation (dogfood sweeper findings)
    assert.throws(() => {
      board.addItem({ title: 12345 });
    }, /Task title is required/);

    assert.throws(() => {
      board.addItem({ title: 'Valid', track: 'invalid_track' });
    }, /Invalid track: invalid_track/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
