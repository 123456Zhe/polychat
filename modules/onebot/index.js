import { createOnebotActionHandler } from './actions.js';
import { createOnebotWs } from './ws.js';
import { registerOnebotEventListeners } from './events.js';

export function setupOnebot(ctx) {
  const { db, roomForUser, validateMentions, hydrateMessages, broadcast, conversationMembers, socketCanAccess, isUserBanned, eventBus } = ctx;

  const botSockets = new Set();
  const handleAction = createOnebotActionHandler({ db, roomForUser, validateMentions, hydrateMessages, broadcast, botSockets });

  const { attach, heartbeat } = createOnebotWs({ db, isUserBanned, botSockets, handleAction });

  registerOnebotEventListeners({ eventBus, botSockets, conversationMembers, socketCanAccess });

  return { attach, heartbeat };
}
