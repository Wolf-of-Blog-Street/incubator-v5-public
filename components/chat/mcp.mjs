// chat mcp — the fleet chat as MCP tools on stdio, for Claude Code, Codex and agy. Same identity rules as the CLI.
import readline from 'node:readline';
import { api, whoAmI, fmtMsg, renderWho } from './chat.mjs';

const TOOLS = [
  { name: 'chat_send', description: 'Send a message in the fleet chat. to: @seat, @seat/context, @seat/handle, @handle or #channel. A mentioned agent is pinged live.',
    inputSchema: { type: 'object', required: ['to', 'text'], properties: { to: { type: 'string' }, text: { type: 'string' } } } },
  { name: 'chat_read', description: 'Read the fleet chat. unread: only what is for you and not read yet.',
    inputSchema: { type: 'object', properties: { channel: { type: 'string' }, unread: { type: 'boolean' }, since: { type: 'string', description: 'e.g. 30m, 2h, 1d' } } } },
  { name: 'chat_who', description: 'Who is online (seat/handle, type, model, working on) and every seat with its contexts: use it to find who to talk to.',
    inputSchema: { type: 'object', properties: { refresh: { type: 'boolean' } } } },
  { name: 'chat_register', description: 'Register this session: who you are and what you are working on. Do it when you come online and when you change context.',
    inputSchema: { type: 'object', required: ['type', 'model'], properties: { type: { type: 'string', enum: ['claude', 'codex', 'agy'] }, model: { type: 'string' }, context: { type: 'string' }, handle: { type: 'string' }, subscribe: { type: 'string' } } } },
];

async function callTool(name, a) {
  const me = await whoAmI({ handle: a.handle });
  if (name === 'chat_send') { const r = await api.say(me, a.to, a.text); return `sent #${r.id}; pinged ${r.pinged.join(', ') || 'nobody'}`; }
  if (name === 'chat_read') return (await api.read(me, a)).map(fmtMsg).join('\n') || '(nothing)';
  if (name === 'chat_who') return renderWho(await api.who(a.refresh));
  if (name === 'chat_register') { const r = await api.register(me, a); return `registered @${r.registered.seat}/${r.registered.handle}; unread ${r.unread.length}\n` + r.unread.slice(-10).map(fmtMsg).join('\n'); }
  throw new Error(`unknown tool ${name}`);
}

export function runMcp() {
  const out = v => process.stdout.write(JSON.stringify(v) + '\n');
  readline.createInterface({ input: process.stdin }).on('line', async line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id === undefined) return; // notifications
    if (m.method === 'initialize') return out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fleet-chat', version: '1' } } });
    if (m.method === 'tools/list') return out({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
    if (m.method === 'tools/call') {
      try { out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: await callTool(m.params.name, m.params.arguments || {}) }] } }); }
      catch (e) { out({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: e.message }] } }); }
      return;
    }
    out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `unknown method ${m.method}` } });
  });
}
