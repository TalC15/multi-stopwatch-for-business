<template>
  <div class="fixed top-5 left-1/2 -translate-x-1/2 z-9999">
    <TransitionGroup name="message" tag="div" class="flex flex-col gap-2">
      <div
        v-for="message in messages"
        :key="message.id"
        class="flex items-center gap-3 rounded-xl border text-white font-mono border-green-100 bg-[#432DD7] px-4 py-3 shadow-lg"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="w-5 h-5 text-green-500"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12l3 3 5-5" />
        </svg>
        <span>
          {{ message.text }}
        </span>
      </div>
    </TransitionGroup>
  </div>
  -
</template>

<script setup>
defineProps({
  messages: Array,
});
</script>

<style>
.message-enter-active {
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.message-leave-active {
  transition: opacity 0.35s ease;
}

.message-enter-from {
  opacity: 0;
  transform: translateY(-18px);
}

.message-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.message-leave-from {
  opacity: 1;
}

.message-leave-to {
  opacity: 0;
}
</style>
