import { Haptics, ImpactStyle } from '@capacitor/haptics';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export async function hapticAlarm() {
  for (let i = 0; i < 5; i++) {
    await Haptics.impact({
      style: ImpactStyle.Heavy
    });

    await sleep(300); // titreşimler arası bekleme
  }
}

export async function hapticTap(){
  await Haptics.impact({
    style: ImpactStyle.Light
  })
}