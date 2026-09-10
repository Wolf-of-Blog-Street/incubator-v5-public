#!/usr/bin/env node

/**
 * Incubator v5 — Friends CLI (friend.mjs)
 *
 * Multi-Model Sub-Agent & Secondary CLI Dispatcher.
 * Dispatches secondary engines (Claude Code, Codex, Kimi, etc.)
 * inside isolated child revisions in Jujutsu (jj new).
 *
 * Usage:
 *   friend list [--json]
 *   friend check <provider>
 *   friend run <provider> "prompt" [--model <m>] [--effort <e>] [--no-jj] [--timeout <ms>]
 */

import path from 'node:path';
import {
  getFriendsCatalog,
  isBinaryAvailable,
  dispatchFriend,
  isJjRepository
} from '../engine/friends.mjs';

function parseArgs(rawArgs) {
  const args = {
    command: null,
    provider: null,
    prompt: null,
    json: false,
    noJj: false,
    autoAbandon: false,
    model: null,
    effort: null,
    timeoutMs: 180000,
    cwd: process.cwd(),
    configPath: null,
    extraFlags: []
  };

  const positional = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--no-jj') {
      args.noJj = true;
    } else if (arg === '--auto-abandon') {
      args.autoAbandon = true;
    } else if (arg === '-m' || arg === '--model') {
      args.model = rawArgs[++i] || null;
    } else if (arg === '-e' || arg === '--effort') {
      args.effort = rawArgs[++i] || null;
    } else if (arg === '--timeout') {
      args.timeoutMs = rawArgs[i + 1] ? (parseInt(rawArgs[++i], 10) || 180000) : 180000;
    } else if (arg === '--cwd') {
      args.cwd = rawArgs[i + 1] ? path.resolve(rawArgs[++i]) : process.cwd();
    } else if (arg === '--config') {
      args.configPath = rawArgs[i + 1] ? path.resolve(rawArgs[++i]) : null;
    } else if (arg === '-p' || arg === '--prompt') {
      args.prompt = rawArgs[++i] || null;
    } else if (arg.startsWith('-')) {
      args.extraFlags.push(arg);
    } else {
      positional.push(arg);
    }
  }

  args.command = positional[0] || 'help';
  args.provider = positional[1] || null;
  if (!args.prompt && positional.length > 2) {
    args.prompt = positional.slice(2).join(' ');
  }

  return args;
}

function printHelp() {
  console.log(`
🤝 Incubator v5 Friends CLI (friend.mjs)

Commands:
  list                          List available friend providers and binary availability
  check <friend>                Verify installation and binary status of a friend
  run <friend> "<prompt>"       Dispatch a friend inside an isolated Jujutsu revision (jj new)

Options:
  -p, --prompt <text>           The prompt or mandate to execute
  -m, --model <name>            Override default model (e.g. gpt-6-astra, sonnet)
  -e, --effort <level>          Override reasoning effort (e.g. high, ultra)
  --no-jj                       Bypass Jujutsu change isolation (execute in current working copy)
  --auto-abandon                Abandon the Jujutsu change if execution fails
  --timeout <ms>                Process execution timeout in milliseconds (default: 180000)
  --cwd <path>                  Target working directory (default: current directory)
  --config <path>               Custom friends.json catalog path
  --json                        Output JSON formatted results
  --help                        Display this help text

Examples:
  friend list
  friend check codex
  friend run claude "Audit server.mjs for race conditions"
  friend run codex "Design custom schema for Sol Ultra" --model gpt-6-astra --effort high
`);
}

async function handleList(args) {
  const catalog = getFriendsCatalog(args.configPath);
  const items = Object.entries(catalog).map(([id, p]) => ({
    id,
    displayName: p.displayName,
    binary: p.binary,
    available: isBinaryAvailable(p.binary),
    defaultModel: p.defaultModel || 'default',
    defaultEffort: p.defaultEffort || 'standard',
    modelAliases: p.modelAliases || {},
    description: p.description
  }));

  if (args.json) {
    console.log(JSON.stringify(items, null, 2));
    return 0;
  }

  console.log(`\n🤝 Registered Friends Catalog:`);
  console.log(`═`.repeat(78));
  for (const f of items) {
    const statusIcon = f.available ? '✅ Available' : '❌ Not Found';
    const aliasesList = Object.keys(f.modelAliases).length > 0
      ? ` | Aliases: ${Object.keys(f.modelAliases).join(', ')}`
      : '';
    console.log(`  • ${f.displayName.padEnd(20)} [${f.id}] — ${statusIcon}`);
    console.log(`    Binary: ${f.binary} | Model: ${f.defaultModel} | Effort: ${f.defaultEffort}${aliasesList}`);
    console.log(`    ${f.description}\n`);
  }
  console.log(`═`.repeat(78));
  return 0;
}

async function handleCheck(args) {
  if (!args.provider) {
    console.error('Error: Provider name is required. Example: friend check codex');
    return 1;
  }

  const catalog = getFriendsCatalog(args.configPath);
  const provider = catalog[args.provider];

  if (!provider) {
    console.error(`Error: Unknown friend provider "${args.provider}". Run "friend list" to see options.`);
    return 1;
  }

  const available = isBinaryAvailable(provider.binary);
  const inJj = isJjRepository(args.cwd);

  const status = {
    provider: args.provider,
    displayName: provider.displayName,
    binary: provider.binary,
    available,
    isJjWorkingCopy: inJj,
    defaultModel: provider.defaultModel,
    defaultEffort: provider.defaultEffort
  };

  if (args.json) {
    console.log(JSON.stringify(status, null, 2));
    return available ? 0 : 2;
  }

  console.log(`\n🔍 Friend Diagnostics: ${provider.displayName} (${args.provider})`);
  console.log(`  Binary Name:  ${provider.binary}`);
  console.log(`  Binary Found: ${available ? '✅ YES' : '❌ NO'}`);
  console.log(`  Default Model:${provider.defaultModel || 'n/a'}`);
  console.log(`  Jujutsu Repo: ${inJj ? '✅ YES (Revisions will be isolated)' : '⚠️  NO (Operating without jj isolation)'}\n`);

  return available ? 0 : 2;
}

async function handleRun(args) {
  if (!args.provider) {
    console.error('Error: Friend provider is required. Example: friend run claude "Review changes"');
    return 1;
  }

  if (!args.prompt) {
    console.error('Error: Prompt is required. Example: friend run codex "Refactor parser"');
    return 1;
  }

  const catalog = getFriendsCatalog(args.configPath);
  const provider = catalog[args.provider];
  if (!provider) {
    console.error(`Error: Unknown friend provider "${args.provider}". Run "friend list" to see available options.`);
    return 1;
  }

  const inJj = isJjRepository(args.cwd);
  const willIsolate = inJj && !args.noJj;

  if (!args.json) {
    console.log(`\n🤝 [Friend Dispatch] ${provider.displayName} (${args.provider})`);
    console.log(`Mandate: "${args.prompt}"`);
    console.log(`Isolation: ${willIsolate ? '🛡️ Jujutsu child revision (jj new)' : '⚠️ Direct working copy (no jj isolation)'}`);
    console.log(`Working dir: ${args.cwd}\n`);
  }

  try {
    const report = await dispatchFriend(args.provider, {
      prompt: args.prompt,
      cwd: args.cwd,
      model: args.model,
      effort: args.effort,
      noJj: args.noJj,
      autoAbandon: args.autoAbandon,
      timeoutMs: args.timeoutMs,
      configPath: args.configPath,
      extraFlags: args.extraFlags,
      onStdout: chunk => {
        if (!args.json) process.stdout.write(chunk);
      },
      onStderr: chunk => {
        if (!args.json) process.stderr.write(chunk);
      }
    });

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\n──────────────────────────────────────────────────────────────────────────────`);
      console.log(`✅ Friend execution finished in ${report.durationMs}ms (exit code: ${report.exitCode})`);
      if (report.isIsolated && report.changeId) {
        console.log(`🛡️ Isolated Jujutsu Revision:`);
        console.log(`   Change ID: ${report.changeId}`);
        if (report.commitId) console.log(`   Commit ID: ${report.commitId}`);
        if (report.diffStat) {
          console.log(`\nChanges modified by friend:\n${report.diffStat}`);
        } else {
          console.log(`   (No files modified)`);
        }
      }
      console.log(`──────────────────────────────────────────────────────────────────────────────\n`);
    }

    return report.exitCode;
  } catch (err) {
    console.error(`\n❌ Friend execution failed: ${err.message}`);
    return 1;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'list':
      process.exit(await handleList(args));
      break;
    case 'check':
      process.exit(await handleCheck(args));
      break;
    case 'run':
      process.exit(await handleRun(args));
      break;
    case 'help':
    default:
      printHelp();
      process.exit(0);
  }
}

main();
