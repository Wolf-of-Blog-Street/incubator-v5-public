import { bindFilterEvents } from './filterEvents.js';
import { bindNavigationEvents } from './navigationEvents.js';
import { bindClickDelegation } from './clickDelegation.js';
import { bindOverlayEvents } from './overlayEvents.js';
import { bindShortcutEvents } from './shortcutEvents.js';

/**
 * Orchestrator that attaches all UI event listeners, keyboard shortcuts,
 * routing, and document click delegations across domain sub-modules.
 */
export function bindEvents(fetchData, render) {
  bindFilterEvents(fetchData, render);
  bindNavigationEvents(fetchData, render);
  bindClickDelegation(fetchData, render);
  bindOverlayEvents(fetchData, render);
  bindShortcutEvents(render);
}

export {
  bindFilterEvents,
  bindNavigationEvents,
  bindClickDelegation,
  bindOverlayEvents,
  bindShortcutEvents
};
