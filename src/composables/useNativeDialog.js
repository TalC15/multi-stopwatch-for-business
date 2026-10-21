import { nextTick, onBeforeUnmount, watch } from 'vue';

// The native modal top layer provides background inertness and focus return.
// Explicitly wrap Tab before the browser can move focus into its own chrome.
export function useNativeDialog(dialog, isOpen, initialFocus) {
  watch(isOpen, async (open, _previous, onCleanup) => {
    let cancelled = false;
    let removeKeydown = () => {};
    onCleanup(() => { cancelled = true; removeKeydown(); });
    if (!open) {
      dialog.value?.close?.();
      return;
    }
    await nextTick();
    if (cancelled || !isOpen()) return;
    const element = dialog.value;
    if (!element?.open) element?.showModal?.();
    const keydown = event => {
      if (event.key !== 'Tab') return;
      const controls = [...element.querySelectorAll('button,a[href],input,select,textarea,[tabindex]')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length &&
          element.ownerDocument.defaultView.getComputedStyle(node).visibility !== 'hidden');
      const first = controls[0], last = controls.at(-1);
      const focused = element.ownerDocument.activeElement;
      if (!first) { event.preventDefault(); return; }
      if (!element.contains(focused) || (event.shiftKey ? focused === first : focused === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    element?.addEventListener('keydown', keydown);
    removeKeydown = () => element?.removeEventListener('keydown', keydown);
    initialFocus.value?.focus({ preventScroll: true });
  }, { immediate: true });
  onBeforeUnmount(() => dialog.value?.close?.());
}
