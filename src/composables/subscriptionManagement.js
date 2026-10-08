import { reactive } from 'vue';
import { buildBody, salesError } from '../domain/subscriptionManagement.js';

export function createManagementController(api) {
  const state = reactive({ kind: 'agents', customerId: null, rows: [], cursors: [null], page: 0, nextCursor: null,
    loading: false, ready: false, error: '', errorCode: '', success: '', formError: '',
    action: null, target: null, confirm: false, busy: false, uncertain: false, mutationError: '' });
  let attempt = null, sending = null, reader = null, epoch = 0;
  const blocked = () => state.busy || state.uncertain;
  async function load(page = state.page, cursor = state.cursors[page]) {
    reader?.abort(); reader = new AbortController(); const version = ++epoch;
    state.loading = true; state.ready = false; state.error = ''; state.errorCode = ''; state.rows = [];
    try {
      const result = await api.list(state.kind, state.customerId, cursor, reader.signal);
      if (version !== epoch) return;
      state.rows = result.items; state.nextCursor = result.nextCursor; state.page = page;
      state.cursors[page] = cursor; state.cursors.length = page + 1; state.ready = true;
    } catch (error) {
      if (version !== epoch) return;
      state.error = error.message; state.errorCode = error.code;
    } finally { if (version === epoch) state.loading = false; }
  }
  function clearAction() {
    if (blocked()) return false;
    attempt = null; state.action = null; state.target = null; state.confirm = false;
    state.formError = ''; state.mutationError = ''; return true;
  }
  function open(action, target = null) {
    if (!state.ready || state.loading || blocked() || state.confirm) return false;
    clearAction(); state.success = ''; state.action = action; state.target = target; return true;
  }
  function prepare(form) {
    if (!state.ready || !state.action || state.confirm || blocked()) return false;
    try {
      const body = buildBody(state.action, form);
      attempt = api.prepare(state.kind === 'agents' ? 'agents' : 'customers', state.action,
        state.kind === 'history' ? state.customerId : state.target?.id, state.action === 'cancel' ? state.target?.id : null, body);
      state.formError = ''; state.confirm = true; return true;
    } catch (error) { state.formError = error.message; return false; }
  }
  function submit() {
    if (sending) return sending;
    if (!attempt || !state.confirm) return Promise.resolve(false);
    const version = epoch, current = attempt;
    state.busy = true; state.mutationError = '';
    const work = (async () => {
      try {
        await current.send();
        if (version !== epoch || attempt !== current) return false;
        state.busy = false; state.uncertain = false;
        const accountAction = ['createAgent', 'createCustomer', 'reset'].includes(state.action);
        state.success = accountAction ? 'İşlem kaydedildi. Yeni parola ile giriş henüz kullanıma açık değil.' : 'İşlem kaydedildi. Geçmiş kayıtları korundu.';
        clearAction();
        await load(0, null); return true;
      } catch (error) {
        if (version !== epoch || attempt !== current) return false;
        const safe = error?.code ? error : salesError('NETWORK_ERROR', 0, true);
        state.mutationError = safe.message; state.uncertain = Boolean(safe.uncertain);
        if (['PRIVILEGED_MFA_NOT_READY', 'PRIVILEGED_MFA_REQUIRED', 'SALES_FORBIDDEN', 'SALES_SESSION_INVALID', 'SESSION_CHANGED'].includes(safe.code)) {
          state.ready = false; state.errorCode = safe.code; state.error = safe.message;
        }
        return false;
      } finally { if (attempt === current || !attempt) state.busy = false; }
    })();
    sending = work;
    void work.finally(() => { if (sending === work) sending = null; });
    return work;
  }
  function reset(kind = state.kind, customerId = null) {
    ++epoch; reader?.abort(); attempt = null; sending = null;
    Object.assign(state, { kind, customerId, rows: [], cursors: [null], page: 0, nextCursor: null,
      loading: false, ready: false, error: '', errorCode: '', success: '', action: null, target: null,
      confirm: false, busy: false, uncertain: false, mutationError: '', formError: '' });
  }
  return { state, load, open, prepare, submit, clearAction, reset, blocked,
    next: () => !blocked() && !state.action && state.ready && state.nextCursor ? load(state.page + 1, state.nextCursor) : undefined,
    previous: () => !blocked() && !state.action && state.ready && state.page > 0 ? load(state.page - 1, state.cursors[state.page - 1]) : undefined };
}
