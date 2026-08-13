import { createOnebotActionHandler } from './actions.js';
import { createOnebotWs } from './ws.js';
import { createOnebotReverse } from './reverse.js';
import { registerOnebotEventListeners } from './events.js';
import { configureOnebotFileUrls } from './utils.js';

export function setupOnebot(ctx) {
  const { db, roomForUser, validateMentions, hydrateMessages, broadcast, conversationMembers, socketCanAccess, isUserBanned, isUserMuted, eventBus, publicBaseUrl = '', fileUrlSecret = '', fileUrlTtlMs } = ctx;
  configureOnebotFileUrls({ secret: fileUrlSecret, ttlMs: fileUrlTtlMs });

  const botSockets = new Set();
  const handleAction = createOnebotActionHandler({ db, roomForUser, validateMentions, hydrateMessages, broadcast, conversationMembers, socketCanAccess, isUserBanned, isUserMuted, botSockets });

  const { attach, heartbeat: wsHeartbeat } = createOnebotWs({ db, isUserBanned, botSockets, handleAction, publicBaseUrl });

  const reverse = createOnebotReverse({ db, isUserBanned, botSockets, handleAction, publicBaseUrl });

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

  function disconnectAll() {
    for (const socket of botSockets) socket.close(4001, 'Plugin disabled');
  }

  return { attach, heartbeat, disconnectUser, disconnectAll, startReverse: reverse.start, stopReverse: reverse.stop };
}
