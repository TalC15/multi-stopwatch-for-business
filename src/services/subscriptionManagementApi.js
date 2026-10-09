import { validId as matchesId, salesError } from '../domain/subscriptionManagement.js';

const validId = value => matchesId(value) && value.length === 36; // Exclude a trailing newline allowed by regex $.

const subscriptionFields = ['id', 'customerId', 'planCode', 'sequenceNo', 'startsAt', 'endsAt', 'termMonths',
  'amountMinor', 'currency', 'createdBy', 'cancelledAt', 'cancelledBy', 'cancellationReason'];
// Same timestamp contract as Phase 3: validate local calendar/zone, then add
// fractional seconds as integer microseconds rather than truncating to Date ms.
function timestampMicros(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!match || match[0] !== value) return null;
  const local = `${match[1]}T${match[2]}`;
  const localMs = Date.parse(`${local}Z`);
  if (!Number.isFinite(localMs) || new Date(localMs).toISOString().slice(0, 19) !== local) return null;
  const zone = match[4].length === 3 ? `${match[4]}:00` : match[4];
  const milliseconds = Date.parse(`${local}${zone}`);
  if (!Number.isFinite(milliseconds)) return null;
  return BigInt(milliseconds) * 1000n + BigInt((match[3] || '').padEnd(6, '0'));
}

export function createManagementApi({ request, baseUrl, context, uuid = () => crypto.randomUUID() }) {
  function allowed(role) {
    const value = context();
    if (value.native) throw salesError('NATIVE_BLOCKED');
    if (!value.loggedIn || !value.identity) throw salesError('SALES_SESSION_INVALID');
    if (value.user?.role !== role) throw salesError('SALES_FORBIDDEN');
    return value.identity;
  }
  function id(value) {
    if (!validId(value)) throw salesError('SALES_INPUT_INVALID');
    return value.toLowerCase();
  }
  const base = kind => kind === 'agents' ? '/admin/agents' : '/agent/customers';
  const roleFor = kind => kind === 'agents' ? 'superadmin' : 'agent';
  function project(row, fields) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || fields.some(key => !Object.hasOwn(row, key))) throw salesError('SALES_UNAVAILABLE');
    return Object.fromEntries(fields.map(key => [key, row[key]]));
  }
  function subscriptionResult(value) {
    const item = project(value, subscriptionFields);
    if (!['id', 'customerId', 'createdBy'].every(key => validId(item[key])) || item.planCode !== 'individual' ||
        !Number.isInteger(item.sequenceNo) || item.sequenceNo < 1 ||
        !Number.isInteger(item.termMonths) || item.termMonths < 1 || item.termMonths > 12 ||
        typeof item.amountMinor !== 'string' || !/^\d+$/.test(item.amountMinor) ||
        typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency) ||
        !(item.cancelledBy === null || validId(item.cancelledBy)) ||
        !(item.cancellationReason === null || ['customer_request', 'payment_record_correction', 'administrative'].includes(item.cancellationReason))) throw salesError('SALES_UNAVAILABLE');
    const start = timestampMicros(item.startsAt), end = timestampMicros(item.endsAt);
    if (start === null || end === null || end <= start ||
        (item.cancelledAt === null ? item.cancelledBy !== null || item.cancellationReason !== null :
          timestampMicros(item.cancelledAt) === null || item.cancelledBy === null)) throw salesError('SALES_UNAVAILABLE');
    return item;
  }
  function commandResult(action, value, target, subscriptionId) {
    const sale = ['createCustomer', 'renew', 'cancel'].includes(action);
    const field = action === 'createAgent' || action === 'revoke' ? 'agentId' : action === 'reset' ? 'userId' : 'customerId';
    const fields = sale ? (action === 'cancel' ? ['customerId', 'subscription'] : ['customerId', 'subscription', 'loginReady']) :
      action === 'revoke' ? ['agentId', 'disabled'] : [field, 'mustChangePassword', 'loginReady'];
    const result = project(value, fields);
    if (!validId(result[field])) throw salesError('SALES_UNAVAILABLE');
    const identifier = id(result[field]);
    if ((target && identifier !== target) ||
        (action === 'revoke' ? result.disabled !== true : action !== 'cancel' && result.loginReady !== false) ||
        (!sale && action !== 'revoke' && result.mustChangePassword !== true)) throw salesError('SALES_UNAVAILABLE');
    if (sale) {
      const subscription = subscriptionResult(result.subscription);
      if (id(subscription.customerId) !== identifier || (action === 'cancel' && id(subscription.id) !== subscriptionId)) throw salesError('SALES_UNAVAILABLE');
    }
    return { id: identifier }; // Never retain or display arbitrary response secrets.
  }
  async function response(path, role, options, identity, write = false) {
    const current = () => context().identity === identity && context().loggedIn && context().user?.role === role && !context().native;
    if (!current()) throw salesError('SESSION_CHANGED');
    let res;
    try { res = await request(baseUrl + path, { ...options, mode: 'cors', credentials: 'omit', cache: 'no-store', isRequestCurrent: current }); }
    catch { throw current() ? salesError('NETWORK_ERROR', 0, write) : salesError('SESSION_CHANGED'); }
    if (!current()) throw salesError('SESSION_CHANGED');
    if (!res) throw salesError('SALES_SESSION_INVALID', 401, write);
    let data;
    try { data = await res.json(); } catch { throw salesError('SALES_UNAVAILABLE', res.status, write); }
    if (!current()) throw salesError('SESSION_CHANGED');
    if (!res.ok) throw salesError(data?.code, res.status, write && res.status >= 500 && data?.code !== 'PRIVILEGED_MFA_NOT_READY');
    return data;
  }
  async function list(kind, customerId, after = null, signal) {
    const role = roleFor(kind), identity = allowed(role);
    const customer = kind === 'history' ? id(customerId) : null;
    const query = new URLSearchParams({ limit: '25' });
    if (after) query.set('after', id(after));
    const path = kind === 'history' ? `/agent/customers/${customer}/subscriptions` : base(kind);
    const data = await response(`${path}?${query}`, role, { method: 'GET', signal }, identity);
    if (!Array.isArray(data?.items) || data.items.length > 25 || !(data.nextCursor === null || validId(data.nextCursor))) throw salesError('SALES_UNAVAILABLE');
    const fields = kind === 'agents' ? ['id', 'username', 'disabledAt', 'mustChangePassword'] : kind === 'customers' ?
      ['id', 'username', 'disabledAt', 'status', 'endsAt', 'isEntitled', 'code'] :
      subscriptionFields;
    const items = data.items.map(row => {
      const item = project(row, fields);
      if (!validId(item.id) || (kind === 'history' ? !validId(item.customerId) || id(item.customerId) !== customer || item.planCode !== 'individual' : typeof item.username !== 'string')) throw salesError('SALES_UNAVAILABLE');
      item.id = id(item.id);
      if (kind === 'history') {
        item.customerId = id(item.customerId);
        item.status = ['pending', 'active', 'expired', 'cancelled'].includes(row.status) ? row.status : null;
      }
      return item;
    });
    return { items, nextCursor: data.nextCursor === null ? null : id(data.nextCursor) };
  }
  function prepare(kind, action, targetId, subscriptionId, body) {
    const role = roleFor(kind), identity = allowed(role);
    const target = ['createAgent', 'createCustomer'].includes(action) ? null : id(targetId);
    const subscription = action === 'cancel' ? id(subscriptionId) : null;
    let path = base(kind);
    if (target) path += '/' + target;
    if (action === 'renew') path += '/subscriptions';
    if (action === 'cancel') path += `/subscriptions/${subscription}/cancel`;
    if (action === 'reset') path += '/password-reset';
    if (action === 'revoke') path += '/revoke';
    if (!(kind === 'agents' ? ['createAgent', 'reset', 'revoke'] : ['createCustomer', 'renew', 'cancel', 'reset']).includes(action)) throw salesError('SALES_FORBIDDEN');
    const key = id(uuid()), json = JSON.stringify(body);
    // Immutable attempt stays in this closure only: no Pinia, storage, logs or URL.
    return Object.freeze({ async send() {
      const data = await response(path, role, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-KeepTimer-CSRF': '1', 'Idempotency-Key': key,
      }, body: json }, identity, true);
      try { return commandResult(action, data, target, subscription); }
      catch { throw salesError('SALES_UNAVAILABLE', 200, true); }
    } });
  }
  return { list, prepare };
}
