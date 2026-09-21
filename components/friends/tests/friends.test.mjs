import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  getFriendsCatalog,
  isBinaryAvailable,
  resolveFriendCommand,
  isJjRepository,
  withJjIsolation,
  spawnFriendProcess,
  DEFAULT_FRIENDS_CATALOG
} from '../engine/friends.mjs';

describe('Friends Engine — Unit Tests', () => {

  test('catalog contains default providers (claude, codex, kimi, opencode)', () => {
    const catalog = getFriendsCatalog();
    assert.ok(catalog.claude, 'claude provider exists');
    assert.ok(catalog.codex, 'codex provider exists');
    assert.ok(catalog.kimi, 'kimi provider exists');
    assert.ok(catalog.opencode, 'opencode provider exists');
    assert.ok(catalog.grok, 'grok provider exists');
    assert.ok(catalog['lean-opus-4-5'], 'lean-opus-4-5 provider exists');
    assert.equal(catalog.grok.binary, 'grok');
    assert.equal(catalog['lean-opus-4-5'].binary, 'claude');
    assert.equal(catalog['lean-opus-4-5'].defaultModel, 'claude-opus-4-5');
    assert.ok(catalog['lean-opus-4-5'].defaultFlags.includes('--strict-mcp-config'), 'lean opus loads no MCP servers');
    assert.equal(catalog.claude.binary, 'claude');
    assert.equal(catalog.codex.binary, 'codex');
  });

  test('custom catalog merges with defaults', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'friends-test-'));
    const customPath = path.join(tmpDir, 'custom.json');
    fs.writeFileSync(customPath, JSON.stringify({
      custom_agent: {
        binary: 'custom_bin',
        displayName: 'Custom Agent',
        defaultModel: 'custom-v1'
      },
      claude: {
        defaultModel: 'claude-custom-opus'
      }
    }));

    try {
      const catalog = getFriendsCatalog(customPath);
      assert.ok(catalog.custom_agent, 'custom provider merged');
      assert.equal(catalog.custom_agent.binary, 'custom_bin');
      assert.equal(catalog.claude.defaultModel, 'claude-custom-opus', 'default overridden');
      assert.ok(catalog.codex, 'untouched default preserved');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('isBinaryAvailable accurately identifies system binaries', () => {
    assert.equal(isBinaryAvailable('node'), true, 'node binary is available');
    assert.equal(isBinaryAvailable('non_existent_binary_xyz_12345'), false, 'missing binary is false');
  });

  test('resolveFriendCommand synthesizes command and flags', () => {
    const res = resolveFriendCommand('claude', {
      prompt: 'Refactor test suite',
      model: 'opus',
      extraFlags: ['--verbose']
    });

    assert.equal(res.binary, 'claude');
    assert.ok(res.args.includes('--dangerously-skip-permissions'), 'includes default flags');
    assert.ok(res.args.includes('--model'), 'includes model flag');
    assert.ok(res.args.includes('claude-opus-4-8') || res.args.includes('opus'), 'includes resolved or overridden model');
    assert.ok(res.args.includes('--verbose'), 'includes extra flags');
    assert.ok(res.args.includes('-p'), 'includes prompt flag');
    assert.ok(res.args.includes('Refactor test suite'), 'includes prompt text');

    // Test Codex alias resolution: astra -> gpt-6-astra, sol -> gpt-5.6-sol, luna -> gpt-5.5
    const astraCmd = resolveFriendCommand('codex', { prompt: 'Design UI', model: 'astra' });
    assert.ok(astraCmd.args.includes('gpt-6-astra'), 'resolves astra to gpt-6-astra');

    const solCmd = resolveFriendCommand('codex', { prompt: 'Optimize code', model: 'sol' });
    assert.ok(solCmd.args.includes('gpt-5.6-sol'), 'resolves sol to gpt-5.6-sol');

    const lunaCmd = resolveFriendCommand('codex', { prompt: 'Review code', model: 'luna' });
    assert.ok(lunaCmd.args.includes('gpt-5.5'), 'resolves luna to gpt-5.5');

    // Test Claude alias resolution: fable-5.1 -> claude-fable-5-1
    const fableCmd = resolveFriendCommand('claude', { prompt: 'Debug issue', model: 'fable-5.1' });
    assert.ok(fableCmd.args.includes('claude-fable-5-1'), 'resolves fable-5.1 to claude-fable-5-1');
  });

  test('resolveFriendCommand throws for unknown provider', () => {
    assert.throws(
      () => resolveFriendCommand('imaginary_agent', { prompt: 'hi' }),
      /Unknown friend provider "imaginary_agent"/
    );
  });

  test('spawnFriendProcess captures stdout, stderr, exitCode, and duration', async () => {
    const res = await spawnFriendProcess('node', ['-e', 'console.log("hello friend"); console.error("diagnostic note");']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /hello friend/);
    assert.match(res.stderr, /diagnostic note/);
    assert.ok(res.durationMs >= 0);
  });

  test('spawnFriendProcess enforces timeout limit', async () => {
    await assert.rejects(
      async () => {
        await spawnFriendProcess('node', ['-e', 'setTimeout(() => {}, 5000)'], {
          timeoutMs: 100
        });
      },
      /Friend process timed out after 100ms/
    );
  });

  test('--timeout: 0, a negative value and junk all mean no timer; a positive value is kept', async () => {
    const { parseTimeoutMs } = await import('../engine/friends.mjs');
    assert.deepEqual(['0', '-1', 'abc', undefined, '60000'].map(parseTimeoutMs), [0, 0, 0, 0, 60000]);
  });

  test('spawnFriendProcess allows timeoutMs = 0 to disable timeout', async () => {
    const res = await spawnFriendProcess('node', ['-e', 'console.log("zero-timeout works")'], {
      timeoutMs: 0
    });
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /zero-timeout works/);
  });

  test('isBinaryAvailable returns false for directory paths', () => {
    assert.equal(isBinaryAvailable(process.cwd()), false, 'directory is not an executable binary');
  });

  test('withJjIsolation gracefully falls back when noJj is requested', async () => {
    const result = await withJjIsolation(process.cwd(), { noJj: true }, async ({ isIsolated }) => {
      assert.equal(isIsolated, false);
      return 'direct execution complete';
    });

    assert.equal(result.result, 'direct execution complete');
    assert.equal(result.isIsolated, false);
  });

  test('withJjIsolation serializes concurrent executions on the same cwd', async () => {
    const executionOrder = [];
    const p1 = withJjIsolation(process.cwd(), { noJj: false }, async () => {
      await new Promise(r => setTimeout(r, 50));
      executionOrder.push('first');
    });
    const p2 = withJjIsolation(process.cwd(), { noJj: false }, async () => {
      executionOrder.push('second');
    });

    await Promise.all([p1, p2]);
    assert.deepEqual(executionOrder, ['first', 'second']);
  });

  test('isJjRepository returns boolean without throwing', () => {
    const inJj = isJjRepository(process.cwd());
    assert.equal(typeof inJj, 'boolean');
  });
});

test('voice pack: system prompt is opening line, standard preamble, then the pack verbatim', async () => {
  const { buildVoiceSystemPrompt, loadVoicePack, resolveFriendCommand, VOICE_OPENING, VOICE_PREAMBLE } = await import('../engine/friends.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-'));
  try {
    fs.mkdirSync(path.join(tmp, 'data/opus-writer/voice-pack'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'data/opus-writer/voice-pack/tom-sales.md'), 'Sample one.\nSample two.\n');
    const pack = loadVoicePack('tom-sales', tmp);
    assert.equal(pack.name, 'tom-sales');
    const sys = buildVoiceSystemPrompt(pack.text);
    assert.equal(sys, `${VOICE_OPENING}\n\n${VOICE_PREAMBLE}\n\nSample one.\nSample two.\n`);
    assert.equal(VOICE_OPENING, 'Write in this voice.');
    assert.match(VOICE_PREAMBLE, /^These voice styles are for you to understand the style/);
    assert.match(VOICE_PREAMBLE, /adapt their style to the task you have\.$/);

    const cmd = resolveFriendCommand('lean-opus-4-5', { prompt: 'job', systemPrompt: sys });
    assert.deepEqual(cmd.args, ['--strict-mcp-config', '--dangerously-skip-permissions', '--tools', '', '--setting-sources', 'user', '--model', 'claude-opus-4-5', '--system-prompt', sys, '-p', 'job']);
    assert.throws(() => resolveFriendCommand('grok', { prompt: 'job', systemPrompt: sys }), /does not support a system prompt/);
    assert.throws(() => loadVoicePack('missing', tmp), /not found/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
