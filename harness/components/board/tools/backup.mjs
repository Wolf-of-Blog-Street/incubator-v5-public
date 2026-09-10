#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.flags[key] = argv[++i];
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function computeFileHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Creates an online snapshot backup of all fleet databases and roster configuration.
 * @param {Object} options
 * @param {string} [options.outDir] - Directory where backup snapshot should be stored
 * @param {string} [options.boardsDir] - Directory containing SQLite database files
 * @param {string} [options.rosterPath] - Path to roster.json
 * @returns {Object} Backup summary with manifest details
 */
export function createFleetBackup(options = {}) {
  const boardsDir = path.resolve(options.boardsDir || process.env.BOARDS_DIR || 'boards');
  const rosterPath = path.resolve(options.rosterPath || process.env.FALCON_ROSTER_PATH || 'config/roster.json');
  const baseOutDir = path.resolve(options.outDir || 'backups');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotName = `snapshot-${timestamp}`;
  const snapshotDir = path.join(baseOutDir, snapshotName);

  fs.mkdirSync(snapshotDir, { recursive: true });

  const manifest = {
    version: '5.0.0',
    timestamp: new Date().toISOString(),
    snapshotDir,
    files: []
  };

  // 1. Snapshot all SQLite databases in boardsDir
  if (fs.existsSync(boardsDir)) {
    const files = fs.readdirSync(boardsDir);
    for (const file of files) {
      if (!file.endsWith('.sqlite')) continue;
      const srcDbPath = path.join(boardsDir, file);
      const destDbPath = path.join(snapshotDir, file);

      // Ensure destination file is absent before VACUUM INTO
      if (fs.existsSync(destDbPath)) {
        fs.rmSync(destDbPath, { force: true });
      }

      const srcSize = fs.statSync(srcDbPath).size;
      if (srcSize === 0) {
        // Zero-byte DB, copy directly
        fs.copyFileSync(srcDbPath, destDbPath);
      } else {
        try {
          const db = new DatabaseSync(srcDbPath);
          try {
            db.exec('PRAGMA wal_checkpoint(PASSIVE);');
          } catch (_) {}
          // SQLite VACUUM INTO performs a live, atomic, non-blocking snapshot
          db.exec(`VACUUM INTO '${destDbPath.replace(/'/g, "''")}'`);
          db.close();
        } catch (err) {
          // If VACUUM INTO fails, checkpoint TRUNCATE and retry or copy WAL
          try {
            const db = new DatabaseSync(srcDbPath);
            db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
            db.exec(`VACUUM INTO '${destDbPath.replace(/'/g, "''")}'`);
            db.close();
          } catch (retryErr) {
            fs.copyFileSync(srcDbPath, destDbPath);
            const walSrc = `${srcDbPath}-wal`;
            const walDest = `${destDbPath}-wal`;
            if (fs.existsSync(walSrc)) {
              fs.copyFileSync(walSrc, walDest);
            }
            const shmSrc = `${srcDbPath}-shm`;
            const shmDest = `${destDbPath}-shm`;
            if (fs.existsSync(shmSrc)) {
              fs.copyFileSync(shmSrc, shmDest);
            }
          }
        }
      }

      const stat = fs.statSync(destDbPath);
      manifest.files.push({
        name: file,
        type: 'database',
        size: stat.size,
        sha256: computeFileHash(destDbPath)
      });
    }
  }

  // 2. Backup roster configuration
  if (fs.existsSync(rosterPath)) {
    const destRosterPath = path.join(snapshotDir, 'roster.json');
    fs.copyFileSync(rosterPath, destRosterPath);
    const stat = fs.statSync(destRosterPath);
    manifest.files.push({
      name: 'roster.json',
      type: 'config',
      size: stat.size,
      sha256: computeFileHash(destRosterPath)
    });
  }

  // 3. Write manifest.json
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return manifest;
}

export function runCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);

  if (parsed.flags.help || parsed._[0] === 'help') {
    console.log(`
🛡️  Incubator v5 Fleet Backup Utility (backup.mjs)

Usage:
  backup.mjs [options]

Options:
  --out <dir>           Output directory for backups (default: backups/)
  --boards-dir <dir>    Path to boards directory (default: boards/ or $BOARDS_DIR)
  --roster <path>       Path to roster.json (default: config/roster.json or $FALCON_ROSTER_PATH)
  --json                Output raw JSON manifest
  --help                Show this help text
`);
    return;
  }

  try {
    const manifest = createFleetBackup({
      outDir: parsed.flags.out,
      boardsDir: parsed.flags['boards-dir'],
      rosterPath: parsed.flags.roster
    });

    if (parsed.flags.json) {
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }

    console.log(`\n📦 Fleet Backup Completed Successfully!`);
    console.log(`📂 Snapshot: ${manifest.snapshotDir}`);
    console.log(`📑 Total Files Archived: ${manifest.files.length}`);
    for (const f of manifest.files) {
      console.log(`  • ${f.name} (${f.type}) - ${f.size} bytes [sha256: ${f.sha256.slice(0, 10)}...]`);
    }
    console.log('');
  } catch (err) {
    console.error(`\n❌ Backup Failed: ${err.message}\n`);
    process.exit(1);
  }
}

const isDirectExecution = process.argv[1] && (
  process.argv[1] === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__filename) ||
  (fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename))
);

if (isDirectExecution) {
  runCli();
}
