#!/usr/bin/env node
import readline from 'node:readline';
import { createBoardClient } from './client.mjs';
import { getFriendsCatalog, isBinaryAvailable, dispatchFriend } from '../../friends/engine/friends.mjs';

const TOOLS = [
  {
    name: 'board_list',
    description: 'Lists tasks on the project board with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        doc: { type: 'string', description: 'Filter by parent design doc slug' },
        status: { type: 'string', enum: ['planned', 'in-progress', 'review', 'done', 'blocked'] },
        track: { type: 'string', description: 'Filter by track (e.g. core, feature, bug, frontend, backend, api, ux)' }
      }
    }
  },
  {
    name: 'board_add',
    description: 'Creates a new task or bug on the project board.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Title of the task' },
        doc: { type: 'string', description: 'Parent design doc slug' },
        track: { type: 'string', default: 'core', description: 'Track (core, feature, bug, api, etc.)' },
        details: { type: 'string', description: 'Detailed task plan and checklist in markdown' },
        status: { type: 'string', default: 'planned', enum: ['planned', 'in-progress', 'done'] }
      }
    }
  },
  {
    name: 'board_update',
    description: 'Updates a task status, track, title, or plan details.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'number', description: 'Task ID' },
        status: { type: 'string', enum: ['planned', 'in-progress', 'review', 'done', 'blocked'] },
        title: { type: 'string', description: 'New task title' },
        track: { type: 'string', description: 'New track' },
        details: { type: 'string', description: 'Updated markdown plan details' }
      }
    }
  },
  {
    name: 'board_toggle_checklist',
    description: 'Toggles a checklist item checkbox on a task plan.',
    inputSchema: {
      type: 'object',
      required: ['id', 'index'],
      properties: {
        id: { type: 'number', description: 'Task ID' },
        index: { type: 'number', description: '0-based index of checklist item' }
      }
    }
  },
  {
    name: 'board_sync_doc',
    description: 'Synchronizes a local design doc blueprint to the Falcon Manager central board.',
    inputSchema: {
      type: 'object',
      required: ['slug'],
      properties: {
        slug: { type: 'string', description: 'Design doc slug (e.g. falcon-manager-board-roster)' },
        file: { type: 'string', description: 'Optional explicit path to markdown file' }
      }
    }
  },
  {
    name: 'friend_list',
    description: 'Lists registered secondary AI agents/CLIs (Claude, Codex, etc.) and their system availability.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'friend_dispatch',
    description: 'Dispatches a secondary model friend inside an isolated Jujutsu revision (jj new).',
    inputSchema: {
      type: 'object',
      required: ['friend', 'prompt'],
      properties: {
        friend: { type: 'string', description: 'Provider ID (e.g. "claude", "codex", "kimi", "opencode")' },
        prompt: { type: 'string', description: 'Task instructions or prompt for the friend' },
        model: { type: 'string', description: 'Optional model override' },
        effort: { type: 'string', description: 'Optional reasoning effort level' },
        no_jj: { type: 'boolean', description: 'If true, bypasses Jujutsu isolation' },
        timeout_ms: { type: 'number', description: 'Execution timeout in ms' }
      }
    }
  }
];

export function createMcpServer(options = {}) {
  const client = createBoardClient(options);

  async function handleToolCall(name, args = {}) {
    switch (name) {
      case 'board_list': {
        const tasks = await client.listItems({
          design_slug: args.doc,
          status: args.status,
          track: args.track
        });
        return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
      }
      case 'board_add': {
        const id = await client.addItem({
          title: args.title,
          design_slug: args.doc || null,
          track: args.track || 'core',
          details: args.details || null,
          status: args.status || 'planned'
        });
        return { content: [{ type: 'text', text: `Created task #${id}: "${args.title}"` }] };
      }
      case 'board_update': {
        const { id, ...updates } = args;
        const task = await client.updateItem(id, updates);
        return { content: [{ type: 'text', text: `Updated task #${id} [${task.status}]: "${task.title}"` }] };
      }
      case 'board_toggle_checklist': {
        const task = await client.toggleChecklistItem(args.id, args.index);
        return { content: [{ type: 'text', text: `Toggled checklist item ${args.index} on task #${args.id}` }] };
      }
      case 'board_sync_doc': {
        const res = await client.syncDoc(args.slug, args.file);
        return { content: [{ type: 'text', text: `Synced design doc "${args.slug}" to central board` }] };
      }
      case 'friend_list': {
        const catalog = getFriendsCatalog();
        const items = Object.entries(catalog).map(([id, p]) => ({
          id,
          displayName: p.displayName,
          binary: p.binary,
          available: isBinaryAvailable(p.binary),
          defaultModel: p.defaultModel,
          defaultEffort: p.defaultEffort
        }));
        return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
      }
      case 'friend_dispatch': {
        const report = await dispatchFriend(args.friend, {
          prompt: args.prompt,
          model: args.model,
          effort: args.effort,
          noJj: args.no_jj,
          timeoutMs: args.timeout_ms
        });
        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  function handleMessage(msg) {
    if (msg.method === 'initialize') {
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'incubator-board', version: '5.0.0' }
      };
    }
    if (msg.method === 'tools/list') {
      return { tools: TOOLS };
    }
    if (msg.method === 'tools/call') {
      return handleToolCall(msg.params.name, msg.params.arguments);
    }
    return null;
  }

  return {
    handleMessage,
    handleToolCall,
    close: () => client.close()
  };
}

// Stdio CLI Runner
if (process.argv[1] && process.argv[1].endsWith('mcp-server.mjs')) {
  const server = createMcpServer();
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      const res = await server.handleMessage(msg);
      if (res !== null && msg.id !== undefined) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: res }) + '\n');
      }
    } catch (err) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: err.message }
      }) + '\n');
    }
  });

  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}
