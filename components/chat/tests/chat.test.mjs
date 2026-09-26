import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolve, recipients, mentionsIn, validAddress, contextTokens, limitFor, parseTokens } from '../lib/core.mjs';
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

test('the context watch: tokens from a transcript tail, limits from kickoff.json', () => {
  const turn = (u, extra = {}) => JSON.stringify({ type: 'assistant', message: { usage: u }, ...extra });
  const tail = ['{"cut line', turn({ input_tokens: 1, cache_read_input_tokens: 500000, cache_creation_input_tokens: 9 }),
    turn({ input_tokens: 5, cache_read_input_tokens: 5 }, { isSidechain: true }), JSON.stringify({ type: 'user', message: {} })].join('\n');
  assert.equal(contextTokens(tail), 500010, 'the last main-thread turn; a subagent turn does not count');
  assert.equal(contextTokens('{"cut'), 0);
  assert.deepEqual(['700k', '0.5m', 600000, 'x'].map(parseTokens), [700000, 500000, 600000, NaN]);
  const s = { seat: 'agent-f-pm', handle: 'astra' };
  assert.equal(limitFor({}, s), 700000, 'default 700k');
  assert.equal(limitFor({ default: '650k', 'agent-f-pm': '500k' }, s), 500000, 'the seat beats the default');
  assert.equal(limitFor({ 'agent-f-pm': '500k', 'agent-f-pm/astra': '600k' }, s), 600000, 'the session beats the seat');
  assert.equal(limitFor({ 'agent-f-pm': 'off' }, s), 0, 'off: not watched');
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
  // a handle belongs to one tab: another tab cannot take it, and a tab keeps one registration
  assert.equal((await post('/register', { seat: 'agent-f-pm', handle: 'lead', surface: 's9', workspace: 'w1' })).status, 409);
  assert.equal((await post('/register', { seat: 'agent-f-pm', handle: 'bhw', surface: 's9', workspace: 'w1' })).status, 200);
  assert.equal((await post('/register', { seat: 'agent-f-pm', handle: 'wobs', surface: 's9', workspace: 'w1' })).status, 200);
  const who = await (await fetch(`http://127.0.0.1:${port}/whoami?surface=s9`)).json();
  assert.equal(who.handle, 'wobs', 'the tab is known by its latest registration');
  assert.ok(!(await (await fetch(`http://127.0.0.1:${port}/who`)).json()).sessions.some(x => x.handle === 'bhw'), 'the old handle of that tab is gone');
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/whoami?surface=s1`)).json()).handle, 'lead', 'the lead kept its row');
  // a handed-in kickoff prompt is stored and marked on the session until the bridge restarts the tab
  await post('/register', { seat: 'agent-f-pm', handle: 'lead', transcript: '/t/a.jsonl' });
  const k = await (await post('/kickoff', { from: 'agent-f-pm/lead', text: 'I am resuming work on Wolf Den.' })).json();
  assert.equal(fs.readFileSync(k.file, 'utf8'), 'I am resuming work on Wolf Den.');
  let lead = (await (await fetch(`http://127.0.0.1:${port}/who`)).json()).sessions.find(x => x.handle === 'lead' && x.seat === 'agent-f-pm');
  assert.equal(lead.kickoff.file, k.file); assert.equal(lead.transcript, '/t/a.jsonl');
  assert.equal((await post('/kickoff', { from: 'agent-c-pm/lead', text: 'x' })).status, 400, 'no cmux tab: nothing could restart it');
  await post('/kickoff/done', { key: 'agent-f-pm/lead' });
  lead = (await (await fetch(`http://127.0.0.1:${port}/who`)).json()).sessions.find(x => x.handle === 'lead' && x.seat === 'agent-f-pm');
  assert.equal(lead.kickoff, undefined);
  assert.equal((await post('/send', { from: 'x/y', to: '#fleet', text: 'forged' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/send`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  srv.closeAllConnections(); srv.close();
  setTimeout(() => process.exit(0), 100).unref();
});
