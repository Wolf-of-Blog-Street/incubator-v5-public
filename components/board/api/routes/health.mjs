import { sendJson } from '../middleware/json.mjs';

export function handleHealthRoutes(req, res, pathname) {
  if (req.method === 'GET' && (pathname === '/api/v1/health' || pathname === '/api/health')) {
    sendJson(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '5.0.0'
    });
    return true;
  }
  return false;
}
