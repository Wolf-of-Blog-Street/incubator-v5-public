import { UnauthorizedError, ForbiddenError } from '../../engine/auth.mjs';
import { AgentNotFoundError } from '../../engine/roster.mjs';

export function createAuthContext(req, effectiveRoster, parsedUrl, defaultAgentIdOrFn) {
  const authHeader = req.headers['authorization'];
  const auth = effectiveRoster.authenticate(authHeader);

  function getDefaultAgentId() {
    return typeof defaultAgentIdOrFn === 'function' ? defaultAgentIdOrFn() : defaultAgentIdOrFn;
  }

  function isManagerOrOperator() {
    const mgr = effectiveRoster.getManager();
    return Boolean(auth.isOperator || (auth.authenticated && mgr && auth.agentId === mgr.agent_id));
  }

  function checkTenantAccess(targetAgent) {
    if (effectiveRoster.hasConfiguredCredentials()) {
      if (!auth.authenticated) {
        throw new UnauthorizedError('Authentication token required for tenant access');
      }
      if (!isManagerOrOperator()) {
        effectiveRoster.assertTenantAccess(auth.agentId, targetAgent, false);
      }
    } else if (auth.authenticated && !isManagerOrOperator()) {
      effectiveRoster.assertTenantAccess(auth.agentId, targetAgent, false);
    }
  }

  function resolveTargetAgent(explicitAgentParam = null) {
    const requested = explicitAgentParam || parsedUrl.searchParams.get('agent');
    if (requested) {
      if (typeof effectiveRoster.hasAgent === 'function' && typeof effectiveRoster.listAgents === 'function') {
        const agents = effectiveRoster.listAgents();
        if (agents.length > 0 && !effectiveRoster.hasAgent(requested)) {
          throw new AgentNotFoundError(`Agent '${requested}' not found in roster`);
        }
      }
    }
    if (auth.authenticated && !auth.isOperator) {
      if (requested && requested !== auth.agentId) {
        effectiveRoster.assertTenantAccess(auth.agentId, requested, false);
      }
      return auth.agentId;
    }
    return requested || getDefaultAgentId();
  }

  function resolveTargetProject(explicitProjectParam = null) {
    return explicitProjectParam || parsedUrl.searchParams.get('project') || null;
  }

  function assertAdminOrOperator() {
    if (!isManagerOrOperator()) {
      throw new ForbiddenError('Admin or Operator authorization required');
    }
  }

  function isLoopback() {
    const ip = req.socket?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }

  function assertLegacyMutationAccess(targetAgent = getDefaultAgentId()) {
    if (effectiveRoster.hasConfiguredCredentials()) {
      if (!auth.authenticated) {
        throw new UnauthorizedError('Authentication token required for board mutations');
      }
      checkTenantAccess(targetAgent);
    }
  }

  return {
    auth,
    isManagerOrOperator,
    checkTenantAccess,
    resolveTargetAgent,
    resolveTargetProject,
    assertAdminOrOperator,
    isLoopback,
    assertLegacyMutationAccess
  };
}

