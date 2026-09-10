#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './board/cli.mjs';

export { runCli };

const __filename = fileURLToPath(import.meta.url);
const isDirectExecution = process.argv[1] && (
  process.argv[1] === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__filename) ||
  (fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename))
);

if (isDirectExecution) {
  runCli().catch((err) => {
    console.error(`\n❌ Board Error: ${err.message}\n`);
    process.exit(1);
  });
}
