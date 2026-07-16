import { createOnebotActionHandler } from './actions.js';
import { createOnebotWs } from './ws.js';
import { createOnebotReverse } from './reverse.js';
import { registerOnebotEventListeners } from './events.js';

export function setupOnebot(ctx) {
  const { db, roomForUser, validateMentions, hydrateMessages, broadcast, conversationMembers, socketCanAccess, isUserBanned, eventBus } = ctx;

  const botSockets = new Set();
  const handleAction = createOnebotActionHandler({ db, roomForUser, validateMentions, hydrateMessages, broadcast, conversationMembers, socketCanAccess, botSockets });

  const { attach, heartbeat: wsHeartbeat } = createOnebotWs({ db, isUserBanned, botSockets, handleAction });

  const reverse = createOnebotReverse({ db, isUserBanned, botSockets, handleAction });

  registerOnebotEventListeners({ eventBus, botSockets, conversationMembers, socketCanAccess });

  function heartbeat() {
    wsHeartbeat();
    reverse.heartbeat();
  }

  return { attach, heartbeat, startReverse: reverse.start, stopReverse: reverse.stop };
}
