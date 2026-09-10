import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRAIN_SCRIPT = path.resolve(__dirname, '../engine/brain.mjs');

test('brain engine initializes, creates nodes, and retrieves records', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'incubator-v5-brain-test-'));

  try {
    // 1. Initialize brain
    fs.mkdirSync(path.join(tmpHome, 'brain/__source'), { recursive: true });
    execFileSync(process.execPath, [BRAIN_SCRIPT, 'reindex', '--root', tmpHome], { encoding: 'utf8' });

    // 2. Create a node
    const createOut = execFileSync(
      process.execPath,
      [
        BRAIN_SCRIPT,
        'new',
        '--root',
        tmpHome,
        '--entity',
        'note',
        '--slug',
        'my-task',
        '--description',
        'Testing incubator-v5 brain integration',
      ],
      { encoding: 'utf8' }
    );
    assert.match(createOut, /created my-task/);

    // 3. List nodes
    const listOut = execFileSync(
      process.execPath,
      [BRAIN_SCRIPT, 'list', '--root', tmpHome],
      { encoding: 'utf8' }
    );
    assert.match(listOut, /my-task/);
    assert.match(listOut, /Testing incubator-v5 brain integration/);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
