export const entitlementCodes = new Set(['ACCOUNT_DISABLED', 'SUBSCRIPTION_REQUIRED', 'SUBSCRIPTION_PENDING',
  'SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_CANCELLED', 'PLAN_DISABLED', 'SUBSCRIPTION_FORBIDDEN',
  'SUBSCRIPTION_CONFLICT', 'INDIVIDUAL_SCOPE_NOT_READY', 'SUBSCRIPTION_UNAVAILABLE']);
export const renewableDenials = new Set(['SUBSCRIPTION_REQUIRED', 'SUBSCRIPTION_PENDING', 'SUBSCRIPTION_EXPIRED',
  'SUBSCRIPTION_CANCELLED', 'PLAN_DISABLED']);
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const sameId = (a, b) => uuid(a) && uuid(b) && a.toLowerCase() === b.toLowerCase();

// Same strict calendar/offset/microsecond approach as the reviewed Phase 2 RPC.
export function timestampMicros(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!m || m[0] !== value) return null;
  const local = `${m[1]}T${m[2]}`, ms = Date.parse(`${local}Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== local) return null;
  const utc = Date.parse(`${local}${m[4].length === 3 ? `${m[4]}:00` : m[4]}`);
  return Number.isFinite(utc) ? BigInt(utc) * 1000n + BigInt((m[3] || '').padEnd(6, '0')) : null;
}

export function validateExperience(data, user) {
  const a = data?.account, s = data?.subscription;
  if (!a || !sameId(a.userId, user?.id) || !['company', 'individual'].includes(a.kind) ||
      !(a.workspaceId === null && user.workspace_id === null || sameId(a.workspaceId, user.workspace_id)) ||
      !s || typeof s.isEntitled !== 'boolean' ||
      !(data.code === null || typeof data.code === 'string' && entitlementCodes.has(data.code)) ||
      ['ACCOUNT_DISABLED', 'SUBSCRIPTION_CONFLICT', 'SUBSCRIPTION_UNAVAILABLE'].includes(data.code) ||
      data.loginReady !== false) throw Error('SUBSCRIPTION_UNAVAILABLE');
  if (a.kind === 'company') {
    if (s.planCode !== null || s.status !== null || s.startsAt !== null || s.endsAt !== null ||
        s.isEntitled || data.code !== 'SUBSCRIPTION_REQUIRED' || user.role === 'agent') throw Error('SUBSCRIPTION_UNAVAILABLE');
  } else {
    if (!uuid(a.workspaceId) || user.role !== 'worker' || ![null, 'individual', 'team', 'enterprise'].includes(s.planCode)) throw Error('SUBSCRIPTION_UNAVAILABLE');
    if (s.planCode === null) {
      if (s.status !== null || s.startsAt !== null || s.endsAt !== null || s.isEntitled || data.code !== 'SUBSCRIPTION_REQUIRED') throw Error('SUBSCRIPTION_UNAVAILABLE');
    } else {
      const start = timestampMicros(s.startsAt), end = timestampMicros(s.endsAt);
      if (start === null || end === null || end <= start || !['pending', 'active', 'expired', 'cancelled'].includes(s.status)) throw Error('SUBSCRIPTION_UNAVAILABLE');
    }
    if (s.isEntitled ? s.planCode !== 'individual' || s.status !== 'active' || data.code !== null : data.code === null) throw Error('SUBSCRIPTION_UNAVAILABLE');
  }
  const paid = a.kind === 'company' || s.isEntitled;
  if (['tts', 'telegram', 'presets'].some(key => data.features?.[key] !== paid) ||
      data.shared !== (a.kind === 'company') || data.personal?.readable !== Boolean(a.workspaceId) ||
      data.personal?.writable !== (Boolean(a.workspaceId) && paid)) throw Error('SUBSCRIPTION_UNAVAILABLE');
  // Explicit safe projection; neither transport extras nor local plan claims survive.
  return { account: { kind: a.kind, userId: a.userId.toLowerCase(), workspaceId: a.workspaceId?.toLowerCase() ?? null },
    subscription: { planCode: s.planCode, status: s.status, startsAt: s.startsAt, endsAt: s.endsAt, isEntitled: s.isEntitled },
    evaluatedAt: timestampMicros(data.evaluatedAt) === null ? null : data.evaluatedAt,
    code: data.code, features: { tts: paid, telegram: paid, presets: paid },
    personal: { readable: Boolean(a.workspaceId), writable: Boolean(a.workspaceId) && paid }, shared: data.shared };
}

// A display lease can only shorten a server decision. Never activates a pending
// period and never uses the device wall clock. Missing metadata fails closed.
export function experienceLeaseMs(data) {
  if (data.account.kind === 'company') return 30000;
  const observed = timestampMicros(data.evaluatedAt);
  if (observed === null) return 0;
  if (!data.subscription.isEntitled) return 30000;
  const start = timestampMicros(data.subscription.startsAt);
  const end = timestampMicros(data.subscription.endsAt);
  if (start === null || end === null || observed < start || observed >= end) return 0;
  return Number((end - observed) / 1000n > 30000n ? 30000n : (end - observed) / 1000n);
}
