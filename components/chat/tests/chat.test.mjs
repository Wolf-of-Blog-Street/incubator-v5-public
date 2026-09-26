import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolve, recipients, mentionsIn, validAddress } from '../lib/core.mjs';
import { parseContexts } from '../lib/directory.mjs';

const S = [
  { seat: 'agent-f-pm', handle: 'lead', context: 'wolf-den', seenAt: 3, surface: 's1' },
  { seat: 'agent-f-pm', handle: 'astra', context: 'wolf-way', seenAt: 2, surface: 's2' },
  { seat: 'agent-f-pm', handle: 'mail', context: 'wolf-email-marketing', seenAt: 1, surface: 's3' },
  { seat: 'manager-pm', handle: 'lead', context: '', seenAt: 5, surface: 's4', subscriptions: ['#fleet'] },
];
const keys = l => l.map(s => `${s.seat}/${s.handle}`);

test('addresses: seat, seat/context, seat/handle, bare handle', () => {
  assert.deepEqual(keys(resolve('@agent-f', S)), ['agent-f-pm/lead'], 'most recently seen session of the seat');
  assert.deepEqual(keys(resolve('@agent-f/wolf-way', S)), ['agent-f-pm/astra'], 'by context');
  assert.deepEqual(keys(resolve('@agent-f/mail', S)), ['agent-f-pm/mail'], 'by handle');
  assert.deepEqual(keys(resolve('@astra', S)), ['agent-f-pm/astra'], 'a bare handle');
  assert.deepEqual(keys(resolve('@manager-pm', S)), ['manager-pm/lead']);
  assert.deepEqual(resolve('@nobody', S), []);
});

test('who is pinged: the address, mentions in the text, channel subscribers, never the sender', () => {
  assert.deepEqual(keys(recipients({ from: 'manager-pm/lead', to: '@agent-f/wolf-den', text: 'cc @astra' }, S)), ['agent-f-pm/lead', 'agent-f-pm/astra']);
  assert.deepEqual(keys(recipients({ from: 'agent-f-pm/lead', to: '#fleet', text: 'hello' }, S)), ['manager-pm/lead']);
  assert.deepEqual(keys(recipients({ from: 'manager-pm/lead', to: '#fleet', text: 'mine' }, S)), [], 'the sender is never pinged');
  assert.deepEqual(mentionsIn('mail ops@example.com and @agent-f.'), ['@agent-f'], 'an email address is not a mention');
  assert.ok(validAddress('@agent-f/wolf-den') && validAddress('#fleet') && !validAddress('agent-f') && !validAddress('@'));
});

test('contexts are read from brain output', () => {
  const c = parseContexts('contexts (3):\n● wolf-den — Wolf Den: Build and run it.\n  youtube — YouTube: Ship videos.\n● focus — the bubble of happening — always active\n(active: 1)');
  assert.deepEqual(c.map(x => [x.slug, x.name, x.loaded]), [['wolf-den', 'Wolf Den', true], ['youtube', 'YouTube', false]]);
});

test('the service: register, send pings the right tab, unread waits, foreign origins are refused', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
  const tellLog = path.join(home, 'tell.log');
  const tell = path.join(home, 'tell.sh');
  fs.writeFileSync(tell, `#!/bin/sh\nprintf '%s|%s|%s\\n' "$1" "$2" "$3" >> ${tellLog}\n`);
  Object.assign(process.env, { CHAT_HOME: home, CHAT_TELL: tell, CHAT_AGENTS_ROOT: path.join(home, 'agents'), CHAT_PORT: '0' });
  const { serve } = await import('../chat.mjs?' + Date.now());
  const srv = serve(0); await new Promise(r => srv.once('listening', r));
  const port = srv.address().port;
  const post = (p, b, h = {}) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
  await post('/register', { seat: 'agent-f-pm', handle: 'lead', type: 'claude', model: 'claude-opus-5-5', context: 'wolf-den', workspace: 'w1', surface: 's1' });
  await post('/register', { seat: 'agent-c-pm', handle: 'lead', type: 'claude', model: 'x' }); // no cmux tab
  const r = await (await post('/send', { from: 'manager-pm/lead', to: '@agent-f/wolf-den', text: 'bug #611 is yours; @agent-c fyi' })).json();
  assert.deepEqual(r.pinged.sort(), ['agent-f-pm/lead', 'agent-c-pm/lead']);
  assert.equal(r.bridge, false, 'no bridge yet: both wait');
  // the bridge follows the stream and types into the tab of every pinged session that has one
  const { bridge } = await import('../chat.mjs?' + Date.now());
  bridge(port);
  await new Promise(res => setTimeout(res, 300));
  const r2 = await (await post('/send', { from: 'manager-pm/lead', to: '@agent-f/wolf-den', text: 'bug #611 is yours; @agent-c fyi' })).json();
  assert.equal(r2.bridge, true);
  assert.deepEqual(r2.waiting, ['agent-c-pm/lead'], 'no cmux tab: it waits');
  await new Promise(res => setTimeout(res, 500));
  assert.match(fs.readFileSync(tellLog, 'utf8'), /^w1\|s1\|\[chat @agent-f\/wolf-den from @manager-pm\/lead\] bug #611 is yours/);
  const unread = await (await post('/register', { seat: 'agent-c-pm', handle: 'lead' })).json();
  assert.equal(unread.unread.length, 2, 'waiting messages show at the next registration');
  const read = await (await fetch(`http://127.0.0.1:${port}/read?me=agent-c-pm/lead&unread=1`)).json();
  assert.equal(read.length, 2);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/read?me=agent-c-pm/lead&unread=1`)).json()).length, 0, 'read once, then gone from unread');
  assert.equal((await post('/send', { from: 'x/y', to: '#fleet', text: 'forged' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/send`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  srv.closeAllConnections(); srv.close();
  setTimeout(() => process.exit(0), 100).unref();
});
