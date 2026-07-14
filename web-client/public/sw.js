self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { title: 'PolyChat', body: event.data?.text() || '收到新消息' }; }
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    if (windows.some(client => client.visibilityState === 'visible')) return;
    return self.registration.showNotification(payload.title || 'PolyChat', {
      body: payload.body || '收到新消息',
      tag: payload.messageId ? `polychat-${payload.messageId}` : undefined,
      data: { url: payload.url || '/', roomId: payload.roomId, messageId: payload.messageId },
    });
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const target = event.notification.data?.url || '/';
    const existing = windows.find(client => 'focus' in client);
    if (existing) return existing.focus().then(client => 'navigate' in client ? client.navigate(target) : client);
    return clients.openWindow(target);
  }));
});
