<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
const props = defineProps({ open: Boolean, busy: Boolean, uncertain: Boolean, title: String, details: Array, error: String });
const emit = defineEmits(['confirm', 'cancel']);
const dialog = ref(null);
let previousFocus;
watch(() => props.open, async open => {
  await nextTick();
  if (open && dialog.value && !dialog.value.open) {
    previousFocus = document.activeElement;
    dialog.value.showModal();
  } else if (!open && dialog.value?.open) {
    dialog.value.close(); previousFocus?.focus?.();
  }
}, { immediate: true, flush: 'post' });
const cancel = () => { if (!props.busy && !props.uncertain) emit('cancel'); };
onBeforeUnmount(() => { dialog.value?.close(); previousFocus?.focus?.(); });
</script>
<template>
  <dialog ref="dialog" class="management-dialog" aria-labelledby="management-dialog-title" aria-describedby="management-dialog-details" :aria-busy="busy" @cancel.prevent="cancel">
    <h2 id="management-dialog-title">{{ title }}</h2>
    <div id="management-dialog-details">
      <p v-for="(line, index) in details" :key="index">{{ line }}</p>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="uncertain" role="status">Sonuç belirsiz. Aynı bilgileri ve işlem anahtarını koruyarak tekrar deneyin. Bu sayfayı kapatmayın.</p>
    <div class="dialog-actions">
      <button type="button" autofocus :disabled="busy || uncertain" @click="cancel">Vazgeç</button>
      <button type="button" :disabled="busy" @click="emit('confirm')">{{ busy ? 'İşlem bekleniyor…' : error ? 'Aynı işlemi tekrar dene' : 'Onayla' }}</button>
    </div>
  </dialog>
</template>
<style scoped>
.management-dialog { margin: auto; width: min(92vw, 32rem); max-height: 85dvh; overflow: auto; border: 1px solid var(--color-border); border-radius: 1.5rem; background: var(--color-card); color: var(--color-text-primary); padding: 1.5rem; box-shadow: 0 24px 80px #0005; }
.management-dialog::backdrop { background: #0f172aa6; backdrop-filter: blur(4px); }
h2 { font-size: 1.25rem; font-weight: 800; margin-bottom: 1rem; }
p { margin: .75rem 0; overflow-wrap: anywhere; }
[role=alert] { color: var(--color-text-primary); border-left: 3px solid #e11d48; padding: .75rem; }
.dialog-actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1.25rem; }
button { flex: 1; padding: .8rem 1rem; border: 1px solid var(--color-border); border-radius: .8rem; font-weight: 700; cursor: pointer; }
button:last-child { color: white; background: #4338ca; }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible { outline: 3px solid #818cf8; outline-offset: 3px; }
</style>
