import { Haptics, ImpactStyle } from '@capacitor/haptics';

// Haptics are optional. Unsupported hardware must not reject a timer action.
export async function hapticTap() {
  try { await Haptics.impact({ style: ImpactStyle.Light }); } catch { /* optional effect */ }
}
export async function hapticAlarm(signal) {
  for (let i = 0; i < 5 && !signal?.aborted; i++) {
    try { await Haptics.impact({ style: ImpactStyle.Heavy }); } catch { return; }
    if (i < 4) await new Promise(resolve => setTimeout(resolve, 300));
  }
}
