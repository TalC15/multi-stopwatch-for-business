/* Imported by the generated Workbox worker. No background JS timer promises. */
self.addEventListener('notificationclick', event => {
  if (!String(event.notification.tag).startsWith('keeptimer:')) return;
  event.notification.close();
  const timerId = event.notification.data?.timerId;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(item => new URL(item.url).origin === self.location.origin);
    if (client) {
      client.postMessage({ type: 'KEEPTIMER_NOTIFICATION_CLICK', timerId });
      await client.focus();
    } else await self.clients.openWindow('/');
  })());
});
