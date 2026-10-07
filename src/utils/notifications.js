import { Capacitor } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";
import { LocalNotifications } from "@capacitor/local-notifications";
import { reactive } from "vue";
import { createWebNotificationPresenter } from "./alarms/webNotifications.js";
import { createAlarmQueue } from "./alarms/queue.js";
import { createAlarmAudio } from "./alarms/audio.js";
import {
  SOUND_STORAGE_KEY,
  readSoundSettings,
  normalizeSoundSettings,
  speechOn,
  alarmOn,
  notificationSoundProfile,
} from "./alarms/preferences.js";
import { speakWeb, speakNative } from "./alarms/speech.js";
import {
  createNativeScheduler,
  NOTIFICATION_OWNER,
} from "./alarms/nativeScheduler.js";
import radarAlarm from "../sounds/radar-alarm.mp3";
import digitalAlarm from "../sounds/digital-alarm.mp3";
import { hapticAlarm } from "./haptics.js";

export const isNativeNotifications = () => Capacitor.isNativePlatform();
const isAndroid = () => Capacitor.getPlatform() === "android";
const supportsWebNotifications = () =>
  globalThis.isSecureContext === true &&
  typeof globalThis.Notification !== "undefined";
export const soundSettings = reactive(
  readSoundSettings(globalThis.localStorage),
);
export const notificationState = reactive({
  permission: "unknown",
  exact: "unknown",
  error: "",
  testing: false,
});
const versions = new Map();
const acknowledged = new Set();
const webNotifications = createWebNotificationPresenter();
let channelsPromise;
let permissionPromise;
let latestTimers = null;
let syncing;
let syncRequested = false;
const foreground = () => globalThis.document?.visibilityState !== "hidden";
const soundProfile = () =>
  notificationSoundProfile(soundSettings, foreground());
const channelFor = (type, profile) =>
  profile === "quiet"
    ? "keeptimer-quiet-v3"
    : type === "up"
      ? "keeptimer-radar-v2"
      : "keeptimer-digital-v2";
const bodyFor = (timer) =>
  `${timer.name} bitti ve ${timer.isPay ? "ödendi" : "ödenmedi"}`;
const report = (error) => {
  console.warn("[KeepTimer bildirim]", error);
  notificationState.error =
    "Bildirim özelliği veya ses sistemi çalıştırılamadı.";
};

async function ensureChannels() {
  if (!isAndroid()) return;
  channelsPromise ??= Promise.all([
    ...["up", "down"].map((type) =>
      LocalNotifications.createChannel({
        id: channelFor(type, "audible"),
        name: type === "up" ? "Kronometre hedefi" : "Geri sayım bitişi",
        description: "KeepTimer arka plan alarmı",
        importance: 5,
        visibility: 0,
        sound: type === "up" ? "keeptimer_radar.mp3" : "keeptimer_digital.mp3",
        vibration: true,
        lights: true,
        lightColor: "#818CF8",
      }),
    ),
    LocalNotifications.createChannel({
      id: channelFor("down", "quiet"),
      name: "Sessiz bildirimler",
      description: "Uygulama içi ses kontrolü veya alarm kapalıyken bildirim",
      importance: 5,
      visibility: 0,
      sound: "keeptimer_silence.wav",
      vibration: false,
    }),
  ]).catch((error) => {
    channelsPromise = undefined;
    throw error;
  });
  return channelsPromise;
}

const scheduler = createNativeScheduler({
  plugin: LocalNotifications,
  profile: soundProfile,
  makeNotification(timer, entry, immediate = false) {
    return {
      id: entry.id,
      title: "Süre Doldu · KeepTimer",
      body: bodyFor(timer),
      ...(isAndroid()
        ? {
            channelId: channelFor(timer.type, entry.profile),
            smallIcon: "ic_stat_keeptimer",
            largeIcon: "keeptimer_logo",
            iconColor: "#818CF8",
            sound:
              entry.profile === "quiet"
                ? "keeptimer_silence.wav"
                : timer.type === "up"
                  ? "keeptimer_radar.mp3"
                  : "keeptimer_digital.mp3",
          }
        : {}),
      autoCancel: true,
      // Ignored by 8.2; prevents unsolicited settings prompts if upgrading to 8.3+.
      isExactNotification: notificationState.exact === "granted",
      ...(!immediate
        ? { schedule: { at: new Date(entry.at), allowWhileIdle: true } }
        : {}),
      extra: {
        owner: NOTIFICATION_OWNER,
        timerId: timer.id,
        at: entry.at,
        name: timer.name,
        isPay: timer.isPay,
        type: timer.type,
        profile: entry.profile,
      },
    };
  },
});

export async function refreshNotificationStatus() {
  try {
    if (isNativeNotifications()) {
      const previousPermission = notificationState.permission;
      const previousExact = notificationState.exact;
      notificationState.permission = (
        await LocalNotifications.checkPermissions()
      ).display;
      if (isAndroid())
        notificationState.exact = (
          await LocalNotifications.checkExactNotificationSetting()
        ).exact_alarm;
      if (
        (previousExact !== "unknown" &&
          previousExact !== notificationState.exact) ||
        (previousPermission !== "unknown" &&
          previousPermission !== notificationState.permission)
      ) {
        await scheduler.invalidateFuture();
      }
    } else
      notificationState.permission =
        globalThis.isSecureContext && globalThis.Notification
          ? Notification.permission
          : "unsupported";
  } catch (error) {
    report(error);
  }
  return notificationState.permission;
}

// Called only by the explicit settings button: web permission needs a user gesture.
export function requestNotificationPermission() {
  if (permissionPromise) return permissionPromise;
  const request = async () => {
    notificationState.error = "";
    if (isNativeNotifications()) {
      notificationState.permission = (
        await LocalNotifications.requestPermissions()
      ).display;
      await ensureChannels();
    } else if (globalThis.isSecureContext && globalThis.Notification) {
      // Do not await other work before this call; retain browser user activation.
      notificationState.permission = await Notification.requestPermission();
    } else notificationState.permission = "unsupported";
    if (notificationState.permission === "granted")
      await syncNativeTimerNotifications(latestTimers);
    return notificationState.permission;
  };
  permissionPromise = request()
    .catch((error) => {
      report(error);
      return notificationState.permission;
    })
    .finally(() => {
      permissionPromise = null;
    });
  return permissionPromise;
}

export async function requestExactAlarmPermission() {
  if (!isAndroid()) return;
  try {
    await LocalNotifications.changeExactNotificationSetting();
    await refreshNotificationStatus();
    await syncNativeTimerNotifications(latestTimers);
  } catch (error) {
    report(error);
  }
}

const alarmAudio = createAlarmAudio({
  sources: { up: radarAlarm, down: digitalAlarm },
  settings: () => soundSettings,
  onError: report,
});
const canUseForegroundAudio = () => !isNativeNotifications() || foreground();
const queue = createAlarmQueue({
  tone: (item, signal) => {
    if (!canUseForegroundAudio()) return Promise.resolve();
    if (!item.test && alarmOn(soundSettings)) void hapticAlarm(signal);
    return alarmAudio.play(item, signal);
  },
  canSpeak: () => speechOn(soundSettings) && canUseForegroundAudio(),
  speak: (item, signal) => {
    const text = `${item.name} bitti ve ${item.paid}`;
    const volume = soundSettings.speechVolume / 100;
    return isNativeNotifications()
      ? speakNative(text, signal, TextToSpeech, 15000, volume)
      : speakWeb(text, signal, globalThis, 15000, volume);
  },
  onError: report,
});

function saveSoundSettings(settings) {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    notificationState.error = "Ses tercihleri bu cihazda kaydedilemedi.";
  }
}

export function updateSoundSettings(patch, persist = true) {
  const next = normalizeSoundSettings({ ...soundSettings, ...patch });
  if (Object.keys(next).every((key) => next[key] === soundSettings[key])) {
    if (persist) saveSoundSettings(next);
    return;
  }
  const wasAlarmOn = alarmOn(soundSettings);
  Object.assign(soundSettings, next);
  if (!speechOn(soundSettings)) queue.interruptSpeech();
  alarmAudio.applySettings();
  if (persist) saveSoundSettings(next);
  // Only an on/off boundary changes native channels; slider movement needs no bridge call.
  if (wasAlarmOn !== alarmOn(soundSettings))
    void syncNativeTimerNotifications(latestTimers);
}

export function updateQueuedAlarm(timer) {
  queue.update(timer.id, {
    name: timer.name,
    paid: timer.isPay ? "ödendi" : "ödenmedi",
  });
}

export function unlockAlarmAudio() {
  if (queue.size) return;

  if (
    speechOn(soundSettings) &&
    !isNativeNotifications() &&
    globalThis.speechSynthesis &&
    globalThis.SpeechSynthesisUtterance
  ) {
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    speechSynthesis.speak(silent);
  }

  // Web Notification desteği olmayan eski iOS/PWA sürümlerinde,
  // medya kilidini açmak için gerçek alarm MP3 dosyaları asla başlatılmamalıdır.
  if (!isNativeNotifications() && !supportsWebNotifications()) {
    alarmAudio.prepare();
    return;
  }

  alarmAudio.unlock();
}

export function syncNativeTimerNotifications(timers) {
  if (!timers) return Promise.resolve();
  latestTimers = timers.map((timer) => ({ ...timer }));
  if (!isNativeNotifications()) return Promise.resolve();
  syncRequested = true;
  if (syncing) return syncing;
  syncing = (async () => {
    while (syncRequested) {
      syncRequested = false;
      if (notificationState.permission === "unknown")
        await refreshNotificationStatus();
      if (notificationState.permission !== "granted") continue;
      await ensureChannels();
      await scheduler.reconcile(latestTimers);
    }
  })()
    .catch(report)
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

export async function notifyTimerEnd(
  timerId,
  timerName,
  timerIsPay,
  type = "down",
) {
  if (acknowledged.has(timerId)) return;
  const timer = { id: timerId, name: timerName, isPay: timerIsPay, type };
  const version = versions.get(timerId) || 0;
  const valid = () => (versions.get(timerId) || 0) === version;
  // A permission or notification bridge failure must never block the sound queue.
  if (speechOn(soundSettings) || alarmOn(soundSettings))
    void queue.enqueue({
      id: timerId,
      name: timerName,
      paid: timerIsPay ? "ödendi" : "ödenmedi",
      type,
    });
  try {
    if (isNativeNotifications()) {
      if ((await refreshNotificationStatus()) !== "granted" || !valid()) return;
      await ensureChannels();
      if (valid()) await scheduler.complete(timer);
    } else await webNotifications.show(timer, valid, cancelTimerSound);
  } catch (error) {
    report(error);
  }
}

function acknowledgeTimerAlarm(timerId) {
  acknowledged.add(timerId);
  versions.set(timerId, (versions.get(timerId) || 0) + 1);
  queue.cancel(timerId);
  void scheduler.acknowledge(timerId).catch(report);
}

export function cancelTimerSound(timerId) {
  versions.set(timerId, (versions.get(timerId) || 0) + 1);
  queue.cancel(timerId);
  if (isNativeNotifications()) void scheduler.cancel(timerId).catch(report);
  else void webNotifications.cancel(timerId).catch(report);
}
export function stopAllAlarmSounds() {
  queue.stop();
  alarmAudio.stop();
}
export async function testAlarm() {
  if (
    notificationState.testing ||
    (!speechOn(soundSettings) && !alarmOn(soundSettings))
  )
    return;
  notificationState.testing = true;
  notificationState.error = "";
  unlockAlarmAudio();
  try {
    // Test playback independently of notification permission and native channels.
    await queue.enqueue({
      id: "__keeptimer_test__",
      name: "Test sayacı",
      paid: "ödendi",
      type: "down",
      test: true,
      turns: 1,
    });
  } finally {
    notificationState.testing = false;
  }
}

export function initializeNotifications() {
  void refreshNotificationStatus().then(() =>
    syncNativeTimerNotifications(latestTimers),
  );
  const unlock = () => {
    unlockAlarmAudio();
    removeUnlock();
  };
  function removeUnlock() {
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
  }
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);
  const visible = () => {
    if (foreground())
      void refreshNotificationStatus().then(() =>
        syncNativeTimerNotifications(latestTimers),
      );
    else if (isNativeNotifications()) {
      stopAllAlarmSounds();
      // One lifecycle reconciliation switches future alarms to system audio.
      void syncNativeTimerNotifications(latestTimers);
    }
  };
  const clicked = (event) => {
    if (event.data?.type === "KEEPTIMER_NOTIFICATION_CLICK")
      cancelTimerSound(event.data.timerId);
  };
  const settingsChanged = (event) => {
    if (event.key === SOUND_STORAGE_KEY || event.key === null)
      updateSoundSettings(readSoundSettings(localStorage), false);
  };
  window.addEventListener("storage", settingsChanged);
  document.addEventListener("visibilitychange", visible);
  navigator.serviceWorker?.addEventListener("message", clicked);
  let handle,
    disposed = false;
  if (isNativeNotifications()) {
    void LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (event) => {
        if (event.notification.extra?.owner === NOTIFICATION_OWNER)
          acknowledgeTimerAlarm(event.notification.extra.timerId);
      },
    )
      .then((listener) => {
        if (disposed) void listener.remove();
        else handle = listener;
      })
      .catch(report);
  }
  return () => {
    disposed = true;
    removeUnlock();
    stopAllAlarmSounds();
    window.removeEventListener("storage", settingsChanged);
    document.removeEventListener("visibilitychange", visible);
    navigator.serviceWorker?.removeEventListener("message", clicked);
    void handle?.remove();
  };
}
