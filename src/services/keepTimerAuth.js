import { Capacitor, registerPlugin } from '@capacitor/core'

const native = registerPlugin('KeepTimerAuth')

// Platform, never URL/Origin or plugin availability, selects the auth transport.
export const isAndroidAuthPlatform = () => Capacitor.getPlatform() === 'android'
function requireAndroid() {
  if (!isAndroidAuthPlatform()) {
    throw Object.assign(new Error('KeepTimerAuth requires Android'), { code: 'UNIMPLEMENTED' })
  }
  // Capacitor can log arguments before native code sees them. Fail before sending PIN.
  if (globalThis.Capacitor?.isLoggingEnabled !== false) {
    throw Object.assign(new Error('Native auth requires bridge logging disabled'), { code: 'AUTH_LOGGING_CONFIGURATION' })
  }
}

// No web fallback, token persistence, arbitrary HTTP, URL or secret getter.
export const KeepTimerAuth = Object.freeze({
  async login({ username, pin }) {
    requireAndroid()
    const result = await native.login({ username, pin })
    return {
      accessToken: result.accessToken, sessionId: result.sessionId,
      user: { id: result.user.id, username: result.user.username, role: result.user.role, workspace_id: result.user.workspace_id },
    }
  },
  async refresh({ sessionId }) {
    requireAndroid()
    const result = await native.refresh({ sessionId })
    return { accessToken: result.accessToken, sessionId: result.sessionId }
  },
  async logout({ sessionId }) {
    requireAndroid()
    const result = await native.logout({ sessionId })
    return { success: result.success, sessionId: result.sessionId }
  },
  async getSessionState() {
    requireAndroid()
    const result = await native.getSessionState()
    return { hasCredential: result.hasCredential, sessionId: result.sessionId, requiresLogin: result.requiresLogin }
  },
})
