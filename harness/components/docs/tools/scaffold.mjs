#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, '../templates');

/**
 * Scaffolds the 4-tier documentation repository structure into targetDir.
 * @param {Object} options
 * @param {string} options.targetDir - Destination directory (e.g. /path/to/my-app-docs)
 * @param {string} options.projectName - Display name of the project
 * @param {string} [options.projectSlug] - URL/slug name of the project
 * @param {string} [options.description] - Short 1-sentence description
 */
export function scaffoldDocs({ targetDir, projectName, projectSlug, description }) {
  if (!targetDir) throw new Error('targetDir is required');
  if (!projectName) throw new Error('projectName is required');

  const slug = projectSlug || projectName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const desc = description || 'A high-performance software project';
  const date = new Date().toISOString().slice(0, 10);

  const replacements = {
    '{{PROJECT_NAME}}': projectName,
    '{{PROJECT_SLUG}}': slug,
    '{{PROJECT_DESCRIPTION}}': desc,
    '{{DATE}}': date,
  };

  function copyAndRender(srcPath, destPath) {
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      try {
        const lstat = fs.lstatSync(destPath);
        if (lstat.isSymbolicLink()) {
          fs.unlinkSync(destPath);
        }
      } catch {}
      fs.mkdirSync(destPath, { recursive: true });
      for (const child of fs.readdirSync(srcPath)) {
        copyAndRender(path.join(srcPath, child), path.join(destPath, child));
      }
    } else {
      let content = fs.readFileSync(srcPath, 'utf8');
      for (const [key, val] of Object.entries(replacements)) {
        content = content.replaceAll(key, val);
      }
      const finalDest = destPath.endsWith('.template')
        ? destPath.slice(0, -9)
        : destPath;

      const parent = path.dirname(finalDest);
      try {
        const pstat = fs.lstatSync(parent);
        if (pstat.isSymbolicLink()) {
          fs.unlinkSync(parent);
        }
      } catch {}
      fs.mkdirSync(parent, { recursive: true });

      try {
        const lstat = fs.lstatSync(finalDest);
        if (lstat.isSymbolicLink()) {
          fs.unlinkSync(finalDest);
        }
      } catch {}
      fs.writeFileSync(finalDest, content, 'utf8');
    }
  }

  copyAndRender(TEMPLATES_DIR, targetDir);

  // Ensure archive folder has its directory created
  const archiveDir = path.join(targetDir, 'design/archive');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  return { targetDir, projectName, slug };
}

// CLI Mode
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Usage: node scaffold.mjs <target-dir> [options]

Options:
  --name <name>         Project display name (default: basename of target-dir)
  --slug <slug>         Project slug (default: derived from name)
  --desc <description>  Short project description
    `);
    process.exit(args.includes('--help') ? 0 : 1);
  }

  let targetDir = path.resolve(args[0]);
  let projectName = path.basename(targetDir).replace(/-docs$/, '');
  let projectSlug = '';
  let description = '';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) projectName = args[++i];
    if (args[i] === '--slug' && args[i + 1]) projectSlug = args[++i];
    if (args[i] === '--desc' && args[i + 1]) description = args[++i];
  }

  // If scaffolding inside a project repository (not ending in /docs or -docs, or --in-repo specified)
  if (args.includes('--in-repo') || (!targetDir.endsWith('/docs') && fs.existsSync(path.join(targetDir, 'package.json')))) {
    targetDir = path.join(targetDir, 'docs');
  }

  scaffoldDocs({ targetDir, projectName, projectSlug, description });
  console.log(`✅ Successfully scaffolded 3-tier docs into: ${targetDir}`);
}

