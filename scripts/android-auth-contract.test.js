import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('native credential directory is excluded from both Android backup formats and transfer', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml')
  assert.match(manifest, /android:fullBackupContent="@xml\/auth_backup_rules"/)
  assert.match(manifest, /android:dataExtractionRules="@xml\/auth_data_extraction_rules"/)
  const legacy = await read('android/app/src/main/res/xml/auth_backup_rules.xml')
  assert.match(legacy, /<exclude domain="file" path="keeptimer_auth\/"\s*\/>/)
  const current = await read('android/app/src/main/res/xml/auth_data_extraction_rules.xml')
  for (const scope of ['cloud-backup', 'device-transfer']) {
    const section = current.match(new RegExp(`<${scope}>([\\s\\S]*?)</${scope}>`))?.[1]
    assert.ok(section)
    assert.match(section, /<exclude domain="file" path="keeptimer_auth\/"\s*\/>/)
  }
})

test('native registration keeps fixed transport, no global HTTP/cookies, and disables bridge argument logs', async () => {
  for (const path of ['capacitor.config.json', 'android/app/src/main/assets/capacitor.config.json']) {
    const config = JSON.parse(await read(path))
    assert.equal(config.android.loggingBehavior, 'none')
    assert.notEqual(config.plugins?.CapacitorHttp?.enabled, true)
    assert.notEqual(config.plugins?.CapacitorCookies?.enabled, true)
    assert.equal(config.server?.url, undefined)
    assert.equal(config.server?.allowNavigation, undefined)
  }
  const activity = await read('android/app/src/main/java/com/keeptime/app/MainActivity.java')
  assert.ok(activity.indexOf('registerPlugin(KeepTimerAuthPlugin.class)') < activity.indexOf('super.onCreate'))
  const plugin = await read('android/app/src/main/java/com/keeptime/app/auth/KeepTimerAuthPlugin.kt')
  assert.deepEqual([...plugin.matchAll(/@PluginMethod fun (\w+)/g)].map(match => match[1]).sort(),
    ['getSessionState', 'login', 'logout', 'refresh'])
  assert.match(plugin, /ThreadPoolExecutor\(1, 1/)
  const http = await read('android/app/src/main/java/com/keeptime/app/auth/NativeAuthHttp.kt')
  assert.match(http, /private const val BACKEND = "https:\/\/[^"/]+"/)
  assert.match(http, /cookieJar\(CookieJar.NO_COOKIES\)/)
  assert.match(http, /followRedirects\(false\)/)
  assert.match(http, /followSslRedirects\(false\)/)
  assert.match(http, /isOneShot\(\) = true/)
  assert.doesNotMatch(http, /\.sslSocketFactory\(|\.hostnameVerifier\(|HttpLoggingInterceptor/)
  for (const name of ['KeepTimerAuthPlugin', 'NativeAuthHttp', 'AuthEngine', 'KeystoreCredentialStore']) {
    assert.doesNotMatch(await read(`android/app/src/main/java/com/keeptime/app/auth/${name}.kt`),
      /\b(?:Log|Logger)\.|println\(|printStackTrace\(/)
  }
})
