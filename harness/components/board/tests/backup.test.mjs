import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createFleetBackup } from '../tools/backup.mjs';

const pExec = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUP_CLI_PATH = path.resolve(__dirname, '../tools/backup.mjs');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-backup-test-'));
}

test('backup utility: creates atomic, non-blocking snapshots of databases and roster', async () => {
  const tmpDir = createTempDir();
  const boardsDir = path.join(tmpDir, 'boards');
  const configDir = path.join(tmpDir, 'config');
  const backupsDir = path.join(tmpDir, 'backups');
  fs.mkdirSync(boardsDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });

  // 1. Create SQLite databases with test data
  const db1Path = path.join(boardsDir, 'agent-1.default.sqlite');
  const db2Path = path.join(boardsDir, 'agent-2.telemetry.sqlite');

  const db1 = new DatabaseSync(db1Path);
  db1.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT);');
  db1.exec("INSERT INTO items (title) VALUES ('Task 1'), ('Task 2');");
  db1.close();

  const db2 = new DatabaseSync(db2Path);
  db2.exec('CREATE TABLE metrics (name TEXT, val REAL);');
  db2.exec("INSERT INTO metrics (name, val) VALUES ('cpu', 42.5);");
  db2.close();

  // 2. Create roster.json
  const rosterPath = path.join(configDir, 'roster.json');
  fs.writeFileSync(rosterPath, JSON.stringify({ version: '5.0.0', agents: [{ id: 'agent-1' }] }, null, 2), 'utf8');

  try {
    // 3. Programmatic backup
    const manifest = createFleetBackup({
      outDir: backupsDir,
      boardsDir,
      rosterPath
    });

    assert.strictEqual(manifest.version, '5.0.0');
    assert.strictEqual(manifest.files.length, 3); // 2 dbs + 1 roster

    const db1Backup = manifest.files.find(f => f.name === 'agent-1.default.sqlite');
    const db2Backup = manifest.files.find(f => f.name === 'agent-2.telemetry.sqlite');
    const rosterBackup = manifest.files.find(f => f.name === 'roster.json');

    assert.ok(db1Backup);
    assert.ok(db2Backup);
    assert.ok(rosterBackup);

    // Verify backed up database integrity
    const backedUpDb1Path = path.join(manifest.snapshotDir, 'agent-1.default.sqlite');
    const verifyDb1 = new DatabaseSync(backedUpDb1Path);
    const rows = verifyDb1.prepare('SELECT count(*) as count FROM items').get();
    assert.strictEqual(rows.count, 2);
    verifyDb1.close();

    // 4. CLI Execution with --json
    const { stdout: cliOut } = await pExec(
      process.execPath,
      [
        BACKUP_CLI_PATH,
        '--out', backupsDir,
        '--boards-dir', boardsDir,
        '--roster', rosterPath,
        '--json'
      ]
    );

    const cliManifest = JSON.parse(cliOut);
    assert.strictEqual(cliManifest.version, '5.0.0');
    assert.strictEqual(cliManifest.files.length, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
