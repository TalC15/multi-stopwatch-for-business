<script setup>
defineProps({
  variant: {
    type: String,
    default: 'primary', // 'primary' | 'secondary' | 'danger' | 'ghost'
  },
  size: {
    type: String,
    default: 'md', // 'sm' | 'md' | 'lg'
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  fullWidth: {
    type: Boolean,
    default: false,
  }
});
</script>
 
<template>
  <button
    :disabled="disabled"
    :class="[
      'inline-flex items-center justify-center gap-2 font-bold rounded-2xl transition-all active:scale-95',
      // Sizes
      size === 'sm' ? 'px-4 py-2 text-sm' : '',
      size === 'md' ? 'px-5 py-3 text-base' : '',
      size === 'lg' ? 'px-6 py-4 text-lg' : '',
      // Variants
      variant === 'primary' ? 'bg-indigo-700 text-white hover:bg-indigo-800 shadow-lg shadow-indigo-500/20' : '',
      variant === 'secondary' ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700' : '',
      variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-700' : '',
      variant === 'ghost' ? 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800' : '',
      // States
      disabled ? 'opacity-40 cursor-not-allowed active:scale-100' : '',
      // Width
      fullWidth ? 'w-full' : '',
    ]"
  >
    <slot />
  </button>
</template>