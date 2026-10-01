export const SOUND_STORAGE_KEY = 'keeptimer.sound-settings.v1';
export const DEFAULT_SOUND_SETTINGS = Object.freeze({
  speechEnabled: true, alarmEnabled: true, speechVolume: 100, alarmVolume: 100,
});
export function normalizeSoundSettings(value = {}) {
  const volume = key => typeof value?.[key] === 'number' && Number.isFinite(value[key])
    ? Math.round(Math.max(0, Math.min(100, value[key]))) : DEFAULT_SOUND_SETTINGS[key];
  return {
    speechEnabled: typeof value?.speechEnabled === 'boolean' ? value.speechEnabled : true,
    alarmEnabled: typeof value?.alarmEnabled === 'boolean' ? value.alarmEnabled : true,
    speechVolume: volume('speechVolume'), alarmVolume: volume('alarmVolume'),
  };
}
export function readSoundSettings(storage) {
  try { return normalizeSoundSettings(JSON.parse(storage?.getItem(SOUND_STORAGE_KEY) || '{}')); }
  catch { return { ...DEFAULT_SOUND_SETTINGS }; }
}
export const speechOn = settings => settings.speechEnabled && settings.speechVolume > 0;
export const alarmOn = settings => settings.alarmEnabled && settings.alarmVolume > 0;
// Android controls background channel volume; the app controls its own foreground audio.
export function notificationSoundProfile(settings, foreground) {
  return foreground || !alarmOn(settings) ? 'quiet' : 'audible';
}
