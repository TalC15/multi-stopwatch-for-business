import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const authSource = readFileSync(new URL('../backendSync.js', import.meta.url), 'utf8');
const exportedNames = source => [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(match => match[1]);
const evaluate = (source, context, name) => {
  const names = exportedNames(source);
  vm.runInContext(`(() => {${source.replace(/^export /gm, '')}\nglobalThis.${name} = {${names.join(',')}};})();`, context);
  return context[name];
};
export const user = { id: '00000000-0000-4000-8000-000000000001', workspace_id: '00000000-0000-4000-8000-000000000003', role: 'worker' };
export const sid = '00000000-0000-4000-8000-000000000010';
export const sidB = '00000000-0000-4000-8000-000000000011';
export const access = (sessionId = sid, id = user.id, serial = 1) =>
  `header.${Buffer.from(JSON.stringify({ type: 'access', id, sessionId, serial, exp: Math.floor(Date.now()/1000)+900 })).toString('base64url')}.signature`;
export const response = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
export const loggedIn = (sessionId = sid, account = user) => response(200, { accessToken: access(sessionId, account.id), sessionId, user: account });
export const refreshed = (sessionId = sid) => response(200, { accessToken: access(sessionId), sessionId });
export const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
export const settle = () => new Promise(resolve => setImmediate(resolve));
export function serialLocks() {
  const tails = new Map();
  return { request(name, options, callback) {
    callback ??= options;
    const work = (tails.get(name) || Promise.resolve()).then(() => callback({ name }));
    tails.set(name, work.catch(() => {}));
    return work;
  } };
}
export function browser({ locks = true, initial = {} } = {}) {
  const entries = new Map(Object.entries(initial)), tabs = [], writes = [];
  const sharedLocks = locks ? serialLocks() : undefined;
  function tab({ online = true, tabIdentity = null } = {}) {
    const window = new EventTarget(), sessionEntries = new Map();
    if (tabIdentity) sessionEntries.set('keeptimer-tab-auth-session', tabIdentity);
    const localStorage = {
      getItem: key => entries.get(key) ?? null,
      setItem(key, value) {
        entries.set(key, String(value)); writes.push({ store: 'local', key, value: String(value) });
        for (const other of tabs) if (other.window !== window) other.window.dispatchEvent(Object.assign(new Event('storage'), { key }));
      },
      removeItem(key) {
        if (!entries.delete(key)) return;
        for (const other of tabs) if (other.window !== window) other.window.dispatchEvent(Object.assign(new Event('storage'), { key }));
      },
    };
    const sessionStorage = {
      getItem: key => sessionEntries.get(key) ?? null,
      setItem(key, value) { sessionEntries.set(key, String(value)); writes.push({ store: 'session', key, value: String(value) }); },
      removeItem: key => sessionEntries.delete(key),
    };
    const document = new EventTarget();
    Object.defineProperty(document, 'cookie', { get() { throw Error('Cookie must never be read'); }, set() { throw Error('Cookie must never be written'); } });
    const context = vm.createContext({ window, document, navigator: { onLine: online, locks: sharedLocks }, localStorage, sessionStorage,
      fetch: () => { throw Error('Unexpected network request'); }, console, Headers, Response, AbortController, Event,
      atob, setTimeout, clearTimeout, setInterval, clearInterval });
    const auth = evaluate(authSource, context, 'auth');
    const result = { auth, window, context, localStorage, sessionStorage, document, sessionEntries,
      setFetch: fn => { context.fetch = fn; }, online: value => { context.navigator.onLine = value; } };
    tabs.push(result);
    return result;
  }
  return { tab, entries, writes };
}
export function installSocket(tab) {
  const sockets = [];
  tab.context.io = (url, options) => {
    const handlers = new Map();
    const socket = { io: { on() {} }, url, options, handlers, active: false, connected: false, connects: 0, closed: false,
      on(event, fn) { handlers.set(event, fn); return this; }, off(event) { handlers.delete(event); return this; },
      connect() { this.connects++; options.auth(value => { this.auth = value; }); return this; },
      disconnect() { this.closed = true; this.active = false; return this; } };
    sockets.push(socket); return socket;
  };
  let source = readFileSync(new URL('../socket.js', import.meta.url), 'utf8');
  source = source.replace('import { io } from "socket.io-client";', 'const io = globalThis.io;');
  source = source.replace(/import \{([\s\S]*?)\} from "\.\/backendSync\.js";/, 'const {$1} = globalThis.auth;');
  const api = evaluate(source, tab.context, 'socketApi');
  return { api, sockets };
}
