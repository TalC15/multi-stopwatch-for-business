import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./keepTimerAuth.js', import.meta.url), 'utf8')
test('native auth wrapper only exposes public fields and sends exact operation inputs', async () => {
  const previous = globalThis.Capacitor
  const calls = []
  globalThis.Capacitor = { isLoggingEnabled: false }
  globalThis.__keepTimerAuthTest = {
    Capacitor: { getPlatform: () => 'android' },
    registerPlugin(name) {
      assert.equal(name, 'KeepTimerAuth')
      return new Proxy({}, { get: (_, method) => async body => {
        calls.push({ method, body })
        return { accessToken: 'access', sessionId: 'session', refreshToken: 'secret', headers: 'secret',
          user: { id: 'user', username: 'worker', role: 'worker', workspace_id: null, refreshToken: 'secret' },
          success: true, hasCredential: true, requiresLogin: false }
      } })
    },
  }
  try {
    const transformed = source.replace("import { Capacitor, registerPlugin } from '@capacitor/core'",
      'const { Capacitor, registerPlugin } = globalThis.__keepTimerAuthTest')
    const { KeepTimerAuth, isAndroidAuthPlatform } = await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`)
    assert.equal(isAndroidAuthPlatform(), true)
    assert.deepEqual(Object.keys(KeepTimerAuth).sort(), ['getSessionState', 'login', 'logout', 'refresh'])
    const results = [await KeepTimerAuth.login({ username: 'worker', pin: 'test-pin', url: 'https://evil.invalid' }),
      await KeepTimerAuth.refresh({ sessionId: 'session', refreshToken: 'injected' }),
      await KeepTimerAuth.logout({ sessionId: 'session' }), await KeepTimerAuth.getSessionState()]
    assert.equal(JSON.stringify(results).includes('secret'), false)
    assert.deepEqual(calls, [
      { method: 'login', body: { username: 'worker', pin: 'test-pin' } },
      { method: 'refresh', body: { sessionId: 'session' } },
      { method: 'logout', body: { sessionId: 'session' } },
      { method: 'getSessionState', body: undefined },
    ])
    globalThis.Capacitor.isLoggingEnabled = true
    await assert.rejects(KeepTimerAuth.login({ username: 'worker', pin: 'must-not-cross' }), { code: 'AUTH_LOGGING_CONFIGURATION' })
    assert.equal(calls.length, 4)
    globalThis.__keepTimerAuthTest.Capacitor.getPlatform = () => 'web'
    assert.equal(isAndroidAuthPlatform(), false)
    await assert.rejects(KeepTimerAuth.getSessionState(), { code: 'UNIMPLEMENTED' })
    assert.equal(calls.length, 4)
  } finally {
    if (previous === undefined) delete globalThis.Capacitor
    else globalThis.Capacitor = previous
    delete globalThis.__keepTimerAuthTest
  }
})
