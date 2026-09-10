export function handleEventRoutes(req, res, pathname, eventBroker) {
  if (req.method === 'GET' && (pathname === '/api/v1/events' || pathname === '/api/events')) {
    eventBroker.addClient(req, res);
    return true;
  }
  return false;
}
