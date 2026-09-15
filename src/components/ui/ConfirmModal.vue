<script setup>
defineProps(["isOpen", "title", "message", "confirmText", "cancelText"]);
const emit = defineEmits(["confirm", "cancel"]);
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
  >
    <div
      @click="emit('cancel')"
      class="absolute inset-0 bg-black/60 backdrop-blur-md"
    ></div>

    <div
      class="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl p-7 shadow-2xl"
    >
      <h2 class="text-xl font-black text-slate-900 dark:text-white mb-2">
        {{ title || "Emin misiniz?" }}
      </h2>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">
        {{ message }}
      </p>

      <div class="flex gap-3">
        <button
          @click="emit('cancel')"
          class="flex-1 py-3.5 rounded-2xl font-bold text-base bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 active:scale-95 transition-all"
        >
          {{ cancelText || "Vazgeç" }}
        </button>
        <button
          @click="emit('confirm')"
          class="flex-1 py-3.5 rounded-2xl font-bold text-base bg-red-700 hover:bg-red-800 text-white active:scale-95 transition-all"
        >
          {{ confirmText || "Sil" }}
        </button>
      </div>
    </div>
  </div>
</template>