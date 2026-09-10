#!/usr/bin/env node

import path from 'node:path';
import { createBoardServer } from '../api/server.mjs';

function parseArgs(args) {
  const parsed = {
    port: 3333,
    dbPath: process.env.BOARD_DB || path.resolve('boards/project.sqlite'),
    rosterPath: process.env.FALCON_ROSTER_PATH || null,
    boardsDir: process.env.BOARDS_DIR || null
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      parsed.port = Number(args[++i]);
    } else if (args[i] === '--db' && args[i + 1]) {
      parsed.dbPath = path.resolve(args[++i]);
    } else if (args[i] === '--roster' && args[i + 1]) {
      parsed.rosterPath = path.resolve(args[++i]);
    } else if (args[i] === '--boards-dir' && args[i + 1]) {
      parsed.boardsDir = path.resolve(args[++i]);
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n📋 Starting Incubator v5 Board Web Server...`);
  if (args.rosterPath) console.log(`Roster: ${args.rosterPath}`);
  console.log(`Database: ${args.dbPath}`);

  try {
    const instance = await createBoardServer({
      dbPath: args.dbPath,
      rosterPath: args.rosterPath,
      boardsDir: args.boardsDir,
      port: args.port
    });

    console.log(`🚀 Board Server running at: \x1b[36m${instance.url}\x1b[0m`);
    console.log(`API endpoints available at: ${instance.url}/api/board and ${instance.url}/api/tasks`);
    console.log(`Press Ctrl+C to stop.\n`);

    process.on('SIGINT', () => {
      console.log('\nShutting down Board Server...');
      instance.close();
      process.exit(0);
    });
  } catch (err) {
    console.error(`❌ Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

main();
