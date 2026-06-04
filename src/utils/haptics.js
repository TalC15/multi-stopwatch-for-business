export function hapticTap() {
  if (navigator.vibrate) {
    navigator.vibrate(10);
  }
}