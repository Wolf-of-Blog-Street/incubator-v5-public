#!/usr/bin/env node

/**
 * Incubator v5 — Fleet Auth Synchronization Tool
 *
 * Synchronizes sandboxed credentials from the MacBook control plane (manager-pm)
 * to remote agent hosts (falcon-manager, example-pa) via secure SSH.
 *
 * Pure Node.js 22 ESM — Zero external dependencies.
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openAccountStore } from '../engine/accounts.mjs';
import { getDefaultAuthBaseDir } from '../engine/sandbox.mjs';

function parseArgs(rawArgs) {
  const args = {
    targetHost: 'falcon-manager',
    remoteAuthDir: '/home/falcon/.incubator/auth',
    accountsPath: null,
    dryRun: false,
    json: false
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--host') {
      args.targetHost = rawArgs[++i] || 'falcon-manager';
    } else if (a === '--remote-dir') {
      args.remoteAuthDir = rawArgs[++i] || '/home/falcon/.incubator/auth';
    } else if (a === '--accounts') {
      args.accountsPath = rawArgs[++i] ? path.resolve(rawArgs[i]) : null;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--json') {
      args.json = true;
    }
  }

  return args;
}

export async function syncFleetAuth(options = {}) {
  const targetHost = options.targetHost || 'falcon-manager';
  const remoteAuthDir = options.remoteAuthDir || '/home/falcon/.incubator/auth';
  const dryRun = Boolean(options.dryRun);

  const localStore = openAccountStore({ storagePath: options.accountsPath });
  const accounts = localStore.listAccounts({ includeSecrets: true });

  const summary = {
    targetHost,
    remoteAuthDir,
    totalAccounts: accounts.length,
    syncedAt: new Date().toISOString(),
    dryRun
  };

  if (dryRun) {
    return summary;
  }

  // 1. Ensure remote auth base directory exists with 0700 permissions
  const mkdirRes = spawnSync('ssh', [targetHost, `mkdir -p ${remoteAuthDir} && chmod 700 ${remoteAuthDir}`], {
    stdio: 'pipe',
    encoding: 'utf8'
  });
  if (mkdirRes.status !== 0) {
    throw new Error(`Failed to create remote auth directory on ${targetHost}: ${mkdirRes.stderr.trim()}`);
  }

  // 2. Synchronize accounts.json securely
  const localAccountsFile = localStore.getStoragePath();
  if (fs.existsSync(localAccountsFile)) {
    const scpRes = spawnSync('scp', [localAccountsFile, `${targetHost}:${remoteAuthDir}/accounts.json`], {
      stdio: 'pipe',
      encoding: 'utf8'
    });
    if (scpRes.status !== 0) {
      throw new Error(`Failed to SCP accounts.json to ${targetHost}: ${scpRes.stderr.trim()}`);
    }

    // Ensure remote permissions are 0600
    spawnSync('ssh', [targetHost, `chmod 600 ${remoteAuthDir}/accounts.json`], { stdio: 'ignore' });
  }

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  try {
    const result = await syncFleetAuth(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n🚀 Fleet Auth Synchronized successfully!`);
      console.log(`   Host: ${result.targetHost}`);
      console.log(`   Remote Path: ${result.remoteAuthDir}`);
      console.log(`   Accounts Synced: ${result.totalAccounts}`);
      console.log(`   Timestamp: ${result.syncedAt}\n`);
    }
  } catch (err) {
    console.error(`\n❌ Fleet Auth Sync failed: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
