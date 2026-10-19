// Validate only new drafts. Existing/server records have their own schema and
// must not disappear when a creation limit changes.
export function validateTimerDraft({ name, duration }) {
  const fail = (field, text) => { throw Object.assign(new Error(text), { field }); };
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) fail('name', 'isim eklemek zorunludur');
  if (trimmedName.length > 35) fail('name', 'çok uzun isim');
  if (duration === '' || duration == null || typeof duration === 'string' && !duration.trim())
    fail('duration', 'süre belirtmek zorunludur');
  const minutes = Number(duration);
  if (!['number', 'string'].includes(typeof duration) || !Number.isFinite(minutes))
    fail('duration', 'geçerli bir süre belirtmelisiniz');
  if (minutes <= 0) fail('duration', 'süre sıfırdan büyük olmalıdır');
  if (minutes > 1440) fail('duration', 'çok uzun süre(en fazla 1440)');
  return { name: trimmedName, duration: minutes };
}
