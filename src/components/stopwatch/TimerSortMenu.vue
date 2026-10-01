<script setup>
import { ref, watch, nextTick, useId } from "vue";
import { TIMER_SORT } from "@/domain/timerSort.js";

defineProps({
  modelValue: {
    type: String,
    default: TIMER_SORT.NEAREST,
  },
});

const emit = defineEmits(["update:modelValue"]);

const isOpen = ref(false);
const root = ref(null);
const trigger = ref(null);
const panelId = useId();

const options = [
  {
    value: TIMER_SORT.NEAREST,
    title: "Önce bitenler",
    description: "Bitmiş → en yakın → en uzak",
    icon: "M12 4v16m-5-5 5 5 5-5",
  },
  {
    value: TIMER_SORT.FARTHEST,
    title: "Önce uzak olanlar",
    description: "En uzak → en yakın → bitmiş",
    icon: "M12 20V4m-5 5 5-5 5 5",
  },
];

async function toggleMenu() {
  isOpen.value = !isOpen.value;

  if (isOpen.value) {
    await nextTick();
    if (!isOpen.value) return;

    root.value
      ?.querySelector('[aria-pressed="true"]')
      ?.focus();
  }
}

function closeMenu(restoreFocus = false) {
  if (!isOpen.value) return;

  isOpen.value = false;

  if (restoreFocus) {
    nextTick(() => trigger.value?.focus());
  }
}

function selectOption(value) {
  emit("update:modelValue", value);
  closeMenu(true);
}

function handleFocusOut(event) {
  if (
    event.relatedTarget &&
    !root.value?.contains(event.relatedTarget)
  ) {
    closeMenu();
  }
}

// Dışarı tıklama dinleyicisi yalnızca menü açıkken çalışır.
// Bileşen kaldırıldığında Vue dinleyiciyi de temizler.
watch(
  isOpen,
  (open, _, onCleanup) => {
    if (!open) return;

    const handlePointerDown = (event) => {
      if (!event.composedPath().includes(root.value)) {
        closeMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
    });
  },
  { flush: "sync" },
);
</script>

<template>
  <div
    ref="root"
    class="relative shrink-0"
    @keydown.esc.stop.prevent="closeMenu(true)"
    @focusout="handleFocusOut"
  >
    <button
      ref="trigger"
      type="button"
      :aria-expanded="isOpen"
      :aria-controls="panelId"
      @click="toggleMenu"
      :class="[
        'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 motion-reduce:transition-none',
        isOpen
          ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-300'
          : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-text-primary)] hover:border-indigo-300 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-300',
      ]"
    >
      <svg
        class="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M4 6h16M4 12h11M4 18h6" />
      </svg>

      Sırala

      <svg
        :class="[
          'size-3.5 transition-transform duration-150 motion-reduce:transition-none',
          isOpen ? 'rotate-180' : '',
        ]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="translate-y-1 scale-95 opacity-0"
      enter-to-class="translate-y-0 scale-100 opacity-100"
      leave-active-class="pointer-events-none transition duration-100 ease-in motion-reduce:transition-none"
      leave-from-class="translate-y-0 scale-100 opacity-100"
      leave-to-class="translate-y-1 scale-95 opacity-0"
    >
      <div
        v-if="isOpen"
        :id="panelId"
        class="absolute right-0 top-full z-50 mt-2 w-[min(19rem,calc(100vw-2rem))] origin-top-right rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 shadow-xl shadow-slate-900/10 dark:shadow-black/30"
      >
        <p
          class="px-3 pb-2 pt-2.5 text-xs font-semibold text-[var(--color-text-secondary)]"
        >
          Sayaçların gösterim sırası
        </p>

        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          :aria-pressed="modelValue === option.value"
          @click="selectOption(option.value)"
          :class="[
            'flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 motion-reduce:transition-none',
            modelValue === option.value
              ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
              : 'text-[var(--color-text-primary)] hover:bg-slate-100 dark:hover:bg-slate-700/50',
          ]"
        >
          <span
            :class="[
              'flex size-9 shrink-0 items-center justify-center rounded-lg',
              modelValue === option.value
                ? 'bg-indigo-100 dark:bg-indigo-500/20'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
            ]"
          >
            <svg
              class="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="option.icon" />
            </svg>
          </span>

          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold">
              {{ option.title }}
            </span>
            <span
              class="mt-0.5 block text-xs leading-5 text-[var(--color-text-secondary)]"
            >
              {{ option.description }}
            </span>
          </span>

          <svg
            v-if="modelValue === option.value"
            class="size-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-label="Seçili"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
        </button>
      </div>
    </Transition>
  </div>
</template>