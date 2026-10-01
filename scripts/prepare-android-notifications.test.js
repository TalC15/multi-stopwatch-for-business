import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const quote of ['"', "'"]) {
  test(`Android resource preparation repairs a missing activity title (${quote}) and is repeatable`, async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'keeptimer-android-label-'));
    try {
      const main = path.join(fixture, 'android/app/src/main');
      await mkdir(path.join(main, 'res/values'), { recursive: true });
      await mkdir(path.join(fixture, 'scripts'));
      await writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
      await cp(path.join(root, 'scripts/prepare-android-notifications.js'), path.join(fixture, 'scripts/prepare-android-notifications.js'));
      await cp(path.join(root, 'native-resources'), path.join(fixture, 'native-resources'), { recursive: true });

      const strings = '<resources><string name="app_name">Custom App</string><string name="custom_url_scheme">custom.scheme</string></resources>';
      await writeFile(path.join(main, 'res/values/strings.xml'), strings);
      const manifestPath = path.join(main, 'AndroidManifest.xml');
      await writeFile(manifestPath, `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="@string/app_name"><activity android:name=".MainActivity" android:label=${quote}@string/title_activity_main${quote} /></application><uses-permission android:name="android.permission.INTERNET" /></manifest>`);

      const prepare = () => run(process.execPath, [path.join(fixture, 'scripts/prepare-android-notifications.js')]);
      await prepare();
      const first = await readFile(manifestPath, 'utf8');
      assert.equal(first.includes('@string/title_activity_main'), false);
      assert.match(first, /<activity android:name="\.MainActivity" android:label="@string\/app_name"/);
      assert.equal(await readFile(path.join(main, 'res/values/strings.xml'), 'utf8'), strings);
      for (const permission of ['INTERNET', 'POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM']) {
        assert.equal(first.split(`android.permission.${permission}`).length - 1, 1);
      }
      for (const asset of ['drawable/ic_stat_keeptimer.xml', 'drawable-nodpi/keeptimer_logo.png', 'raw/keeptimer_radar.mp3']) {
        assert.deepEqual(await readFile(path.join(main, 'res', asset)), await readFile(path.join(root, 'native-resources/android', asset)));
      }
      await prepare();
      assert.equal(await readFile(manifestPath, 'utf8'), first);
      assert.equal(await readFile(path.join(main, 'res/values/strings.xml'), 'utf8'), strings);
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
}
