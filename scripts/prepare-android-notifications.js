import { access, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(root, 'android/app/src/main');
try { await access(path.join(android, 'AndroidManifest.xml')); }
catch { throw new Error('Android projesi bulunamadı. Önce npx cap add android çalıştırın.'); }
await cp(path.join(root, 'native-resources/android'), path.join(android, 'res'), { recursive: true });
const manifestPath = path.join(android, 'AndroidManifest.xml');
let manifest = await readFile(manifestPath, 'utf8');
// Share the application label; some Android projects omit title_activity_main.
manifest = manifest.replace(/android:label=(["'])@string\/title_activity_main\1/g, 'android:label="@string/app_name"');
for (const permission of ['POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM']) {
  if (!manifest.includes(`android.permission.${permission}`)) {
    manifest = manifest.replace('</manifest>', `    <uses-permission android:name="android.permission.${permission}" />\n</manifest>`);
  }
}
await writeFile(manifestPath, manifest);
console.log('KeepTimer bildirim logosu, durum çubuğu simgesi, sesler ve izinler Android projesine aktarıldı.');
