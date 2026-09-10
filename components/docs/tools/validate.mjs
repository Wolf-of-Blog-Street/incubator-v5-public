#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

const REQUIRED_TIERS = ['system', 'design', 'support'];
const REQUIRED_FILES = [
  'README.md',
  'system/INDEX.md',
  'system/ARCHITECTURE.md',
  'system/MANUAL.md',
  'design/INDEX.md',
  'design/templates/epic.template.md',
  'support/INDEX.md',
  'support/RUNBOOK.md',
];

/**
 * Validates that a documentation directory satisfies the 3-tier structure.
 * @param {string} docsDir - Absolute or relative path to the docs directory
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDocs(docsDir) {
  let root = path.resolve(docsDir);
  const errors = [];

  if (!fs.existsSync(root)) {
    return { valid: false, errors: [`Directory does not exist: ${root}`] };
  }

  // If pointing at project root, check if docs/ exists within it
  if (fs.existsSync(path.join(root, 'docs')) && fs.statSync(path.join(root, 'docs')).isDirectory()) {
    root = path.join(root, 'docs');
  }


  for (const tier of REQUIRED_TIERS) {
    const tierPath = path.join(root, tier);
    try {
      const lstat = fs.lstatSync(tierPath);
      if (lstat.isSymbolicLink() || !lstat.isDirectory()) {
        errors.push(`Invalid tier directory (must be regular directory, not symlink): ${tier}/`);
      }
    } catch {
      errors.push(`Missing required tier directory: ${tier}/`);
    }
  }

  for (const relFile of REQUIRED_FILES) {
    const filePath = path.join(root, relFile);
    try {
      const lstat = fs.lstatSync(filePath);
      if (lstat.isSymbolicLink()) {
        errors.push(`Invalid documentation file (symlinks prohibited): ${relFile}`);
      } else if (!lstat.isFile()) {
        errors.push(`Invalid documentation file (not a regular file): ${relFile}`);
      }
    } catch {
      errors.push(`Missing required documentation file: ${relFile}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// CLI Mode
if (process.argv[1] === __filename) {
  const targetDir = path.resolve(process.argv[2] || '.');
  const result = validateDocs(targetDir);

  if (result.valid) {
    console.log(`✅ Documentation structure is valid at: ${targetDir}`);
    process.exit(0);
  } else {
    console.error(`❌ Documentation validation failed for: ${targetDir}`);
    for (const err of result.errors) {
      console.error(`   - ${err}`);
    }
    process.exit(1);
  }
}
