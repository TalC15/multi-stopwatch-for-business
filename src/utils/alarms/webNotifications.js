export function createWebNotificationPresenter(host = globalThis) {
  const visible = new Map();
  const tagFor = id => `keeptimer:${id}`;
  const registration = () => host.navigator?.serviceWorker?.getRegistration();
  async function cancel(id) {
    visible.get(id)?.close();
    visible.delete(id);
    const worker = await registration();
    const notifications = await worker?.getNotifications({ tag: tagFor(id) });
    notifications?.forEach(item => item.close());
  }
  return {
    cancel,
    async show(timer, valid = () => true, onClick = () => {}) {
      if (!host.Notification || host.Notification.permission !== 'granted') return;
      const options = { body: `${timer.name} bitti ve ${timer.isPay ? 'ödendi' : 'ödenmedi'}`,
        tag: tagFor(timer.id), icon: '/icons/notification-logo.png',
        data: { timerId: timer.id, url: '/' }, lang: 'tr', renotify: false, silent: true };
      const worker = await registration();
      if (!valid()) return;
      if (worker?.active) {
        await worker.showNotification('Süre Doldu · KeepTimer', options);
        // Delete/pause can arrive while showNotification is still in flight.
        if (!valid()) await cancel(timer.id);
      } else {
        const notification = new host.Notification('Süre Doldu · KeepTimer', options);
        visible.get(timer.id)?.close();
        visible.set(timer.id, notification);
        notification.onclick = () => { host.focus?.(); onClick(timer.id); };
        notification.onclose = () => {
          if (visible.get(timer.id) === notification) visible.delete(timer.id);
        };
      }
    },
  };
}
