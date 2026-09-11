import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson } from '../middleware/json.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePackageVersion() {
  let dir = __dirname;
  while (dir && dir !== path.dirname(dir)) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (pkg.version) return pkg.version;
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return 'unknown';
}

const SERVER_VERSION = resolvePackageVersion();

export function handleHealthRoutes(req, res, pathname) {
  if (req.method === 'GET' && (pathname === '/api/v1/health' || pathname === '/api/health')) {
    sendJson(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: SERVER_VERSION
    });
    return true;
  }
  return false;
}
