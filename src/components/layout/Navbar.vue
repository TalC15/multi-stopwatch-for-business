<script setup>
defineEmits(['open-menu']);
</script>
 
<template>
  <nav class="h-14 bg-[var(--color-card)] border-b border-[var(--color-border)] px-4 flex items-center justify-between sticky top-0 z-30 transition-colors duration-300">
 
    <!-- Sol: Kronometre İkonu -->
    <button
      @click="$emit('open-menu')"
      class="w-9 h-9 flex items-center justify-center text-[var(--color-primary-light)] active:scale-90 transition-transform"
      aria-label="Menü"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </button>
 
    <!-- Orta: Logo -->
    <h1 class="text-lg font-black tracking-tight text-[var(--color-primary-light)]">
      TimeKeep
    </h1>
 
    <!-- Sağ: Kilit/Ayar İkonu -->
    <button
      class="w-9 h-9 flex items-center justify-center text-[var(--color-primary-light)] active:scale-90 transition-transform"
      aria-label="Kilit"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    </button>
 
  </nav>
</template>