import { createOnebotActionHandler } from './actions.js';
import { createOnebotWs } from './ws.js';
import { createOnebotReverse } from './reverse.js';
import { registerOnebotEventListeners } from './events.js';

export function setupOnebot(ctx) {
  const { db, roomForUser, validateMentions, hydrateMessages, broadcast, conversationMembers, socketCanAccess, isUserBanned, isUserMuted, eventBus } = ctx;

  const botSockets = new Set();
  const handleAction = createOnebotActionHandler({ db, roomForUser, validateMentions, hydrateMessages, broadcast, conversationMembers, socketCanAccess, isUserBanned, isUserMuted, botSockets });

  const { attach, heartbeat: wsHeartbeat } = createOnebotWs({ db, isUserBanned, botSockets, handleAction });

  const reverse = createOnebotReverse({ db, isUserBanned, botSockets, handleAction });

  registerOnebotEventListeners({ eventBus, botSockets, conversationMembers, socketCanAccess });

  function heartbeat() {
    wsHeartbeat();
    reverse.heartbeat();
  }

  function disconnectUser(userId) {
    for (const socket of botSockets) {
      if (socket.user?.id === userId) socket.close(4003, 'Bot account disabled');
    }
  }

  return { attach, heartbeat, disconnectUser, startReverse: reverse.start, stopReverse: reverse.stop };
}
