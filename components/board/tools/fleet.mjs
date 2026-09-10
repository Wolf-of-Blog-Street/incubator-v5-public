#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './fleet/cli.mjs';

export { runCli };

function checkDirectExecution() {
  if (!process.argv[1]) return false;
  const currentFilePath = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(currentFilePath);
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(currentFilePath);
  }
}

if (checkDirectExecution()) {
  runCli().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error(`\n❌ Fleet Error: ${err.message}\n`);
    process.exit(1);
  });
}
