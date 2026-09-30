import { db } from './db.js';
import { roomForUser } from './access.js';

export const sockets = new Set();

export function socketCanAccess(socket, roomId) {
  const room = roomForUser(roomId, socket.user.id);
  return room && (!room.is_private || room.role || socket.user.is_admin);
}

export function broadcast(event, roomId = null) {
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === 1 && (roomId == null || socketCanAccess(socket, roomId))) socket.send(payload);
  }
}

export function conversationMembers(conversationId) {
  return db.prepare('SELECT user_id FROM dm_members WHERE conversation_id = ?').all(conversationId).map(row => row.user_id);
}

export function broadcastDm(conversationId, event) {
  const payload = JSON.stringify(event);
  const memberIds = new Set(conversationMembers(conversationId));
  for (const socket of sockets) {
    if (socket.readyState === 1 && memberIds.has(socket.user.id)) socket.send(payload);
  }
}

export function onlineUsers() {
  const users = new Map();
  for (const socket of sockets) users.set(socket.user.id, { id: socket.user.id, username: socket.user.username });
  return [...users.values()];
}

export function sendToUser(userId, event) {
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === 1 && socket.user.id === userId) socket.send(payload);
  }
}

export function userOnline(userId) {
  return [...sockets].some(socket => socket.readyState === 1 && socket.user.id === userId);
}
