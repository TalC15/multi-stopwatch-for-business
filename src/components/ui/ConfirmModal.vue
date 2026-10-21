<script setup>
import { ref, useId } from "vue";
import { useNativeDialog } from "../../composables/useNativeDialog.js";
const props = defineProps(["isOpen", "title", "message", "confirmText", "cancelText", "confirmDisabled"]);
const emit = defineEmits(["confirm", "cancel"]);
const dialog = ref(null);
const cancelButton = ref(null);
const titleId = useId();
const messageId = useId();
useNativeDialog(dialog, () => props.isOpen, cancelButton);
</script>

<template>
  <dialog
    v-if="isOpen"
    ref="dialog"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    :aria-describedby="messageId"
    @cancel.prevent="emit('cancel')"
    class="fixed inset-0 z-50 m-0 h-full w-full max-h-none max-w-none border-0 bg-transparent p-0 text-inherit flex items-end sm:items-center justify-center"
  >
    <div
      @click="emit('cancel')"
      class="absolute inset-0 bg-black/60 backdrop-blur-md"
    ></div>

    <div
      class="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl p-7 shadow-2xl"
    >
      <h2 :id="titleId" class="text-xl font-black text-slate-900 dark:text-white mb-2">
        {{ title || "Emin misiniz?" }}
      </h2>
      <p :id="messageId" class="text-sm text-slate-500 dark:text-slate-400 mb-6">
        {{ message }}
      </p>

      <div class="flex gap-3">
        <button
          ref="cancelButton"
          type="button"
          autofocus
          @click="emit('cancel')"
          class="flex-1 py-3.5 rounded-2xl font-bold text-base bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 active:scale-95 transition-all"
        >
          {{ cancelText || "Vazgeç" }}
        </button>
        <button
          type="button"
          @click="!confirmDisabled && emit('confirm')"
          :disabled="confirmDisabled"
          :aria-disabled="confirmDisabled"
          :style="confirmDisabled ? { opacity: 0.45 } : undefined"
          class="flex-1 py-3.5 rounded-2xl font-bold text-base bg-red-700 hover:bg-red-800 text-white active:scale-95 transition-all"
        >
          {{ confirmText || "Sil" }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
dialog::backdrop { background: transparent; }
</style>
