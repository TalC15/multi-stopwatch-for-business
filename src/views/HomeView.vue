<script setup>
import { ref, computed, onMounted } from "vue";
import { useStopwatchStore } from "@/stores/stopwatchStore";
import { useThemeStore } from "@/stores/themeStore";
import Navbar from "@/components/layout/Navbar.vue";
import SettingsDrawer from "@/components/layout/SettingsDrawer.vue";
import StopwatchCard from "@/components/stopwatch/StopwatchCard.vue";
import AddModal from "@/components/stopwatch/AddModal.vue";

const store = useStopwatchStore();
const themeStore = useThemeStore();

const activeTab = ref("up");
const isDrawerOpen = ref(false);
const isModalOpen = ref(false);
const isPausedAll = ref(false);

const filteredTimers = computed(() =>
  store.stopwatches.filter((t) => t.type === activeTab.value && !t.isShared),
);

const sharedTimers = computed(() =>
  store.stopwatches.filter((t) => t.isShared),
);

function allTimersPause() {
  if (isPausedAll.value) {
    filteredTimers.value.map((val) => store.startTimer(val.id));
    isPausedAll.value = false;
  } else {
    filteredTimers.value.map((val) => store.pauseTimer(val.id));
    isPausedAll.value = true;
  }
}

onMounted(() => {
  themeStore.applyTheme();
  store.loadSharedTimers();
});
</script>

<template>
  <div
    :class="[
      'min-h-screen bg-[var(--color-surface)] transition-colors duration-300',
    ]"
  >
    <!-- Navbar -->
    <Navbar @open-menu="isDrawerOpen = true" />

    <!-- Settings Drawer -->
    <SettingsDrawer :isOpen="isDrawerOpen" @close="isDrawerOpen = false" />

    <!-- Main Content -->
    <main class="max-w-md mx-auto px-4 pt-6 pb-32">
      <!-- Page Header -->
      <div class="flex items-center mb-5">
        <h2
          class="truncate text-2xl font-black text-[var(--color-text-primary)]"
        >
          {{
            activeTab === "up"
              ? "Kronometreler"
              : activeTab === "down"
                ? "Sayaçlar"
                : "Ortak"
          }}
        </h2>
        <div class="ml-auto flex items-center gap-4">
          <button
            class="flex items-center gap-1.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400"
            @click="allTimersPause"
          >
            <svg
              v-if="isPausedAll"
              xmlns="http://www.w3.org/2000/svg"
              width="45"
              height="45"
              viewBox="0 0 512 512"
              fill="none"
            >
              <g
                stroke="#4F46E5"
                stroke-width="16"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <!-- SOL KRONOMETRE -->

                <circle cx="132" cy="290" r="82" />

                <path d="M116 208V184H148V208" />

                <path d="M132 249V290L157 308" />

                <path d="M132 222V232" />

                <path d="M132 348V358" />

                <path d="M74 290H84" />

                <path d="M180 290H190" />

                <!-- SAĞ KRONOMETRE -->

                <circle cx="380" cy="290" r="82" />

                <path d="M364 208V184H396V208" />

                <path d="M380 249V290L405 308" />

                <path d="M380 222V232" />

                <path d="M380 348V358" />

                <path d="M322 290H332" />

                <path d="M428 290H438" />

                <!-- ORTADAKİ BÜYÜK KRONOMETRE -->

                <circle cx="256" cy="270" r="116" fill="white" />

                <circle cx="256" cy="270" r="108" />

                <path d="M232 162V126H280V162" />

                <path d="M256 204V270L306 306" />

                <path d="M256 184V196" />

                <path d="M256 344V356" />

                <path d="M190 270H202" />

                <path d="M310 270H322" />

                <!-- TÜM KRONOMETRELERİ BAŞLAT -->

                <circle
                  cx="356"
                  cy="374"
                  r="72"
                  fill="#4F46E5"
                  stroke="#4F46E5"
                />

                <!-- SADECE BU KISIM DEĞİŞTİ: ■ → ▶ -->

                <path
                  d="M342 334L342 414L398 374L342 334Z"
                  fill="white"
                  stroke="none"
                />
              </g>
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              width="45"
              height="45"
              viewBox="0 0 512 512"
              fill="none"
            >
              <g
                stroke="#4F46E5"
                stroke-width="16"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <!-- SOL KRONOMETRE -->

                <circle cx="132" cy="290" r="82" />

                <path d="M116 208V184H148V208" />

                <path d="M132 249V290L157 308" />

                <path d="M132 222V232" />

                <path d="M132 348V358" />

                <path d="M74 290H84" />

                <path d="M180 290H190" />

                <!-- SAĞ KRONOMETRE -->

                <circle cx="380" cy="290" r="82" />

                <path d="M364 208V184H396V208" />

                <path d="M380 249V290L405 308" />

                <path d="M380 222V232" />

                <path d="M380 348V358" />

                <path d="M322 290H332" />

                <path d="M428 290H438" />

                <!-- ORTADAKİ BÜYÜK KRONOMETRE -->

                <circle cx="256" cy="270" r="116" fill="white" />

                <circle cx="256" cy="270" r="108" />

                <path d="M232 162V126H280V162" />

                <path d="M256 204V270L306 306" />

                <path d="M256 184V196" />

                <path d="M256 344V356" />

                <path d="M190 270H202" />

                <path d="M310 270H322" />

                <!-- TÜM KRONOMETRELERİ DURDUR -->

                <circle
                  cx="356"
                  cy="374"
                  r="72"
                  fill="#4F46E5"
                  stroke="#4F46E5"
                />

                <rect
                  x="326"
                  y="344"
                  width="60"
                  height="60"
                  rx="8"
                  fill="white"
                  stroke="none"
                />
              </g>
            </svg>
          </button>
          <button
            class="flex items-center gap-1.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400"
          >
            <span class="flex flex-col items-center gap-[3px]">
              <span class="block h-[2px] w-4 rounded-full bg-current"></span>
              <span class="block h-[2px] w-3 rounded-full bg-current"></span>
              <span class="block h-[2px] w-2 rounded-full bg-current"></span>
            </span>
            Sırala
          </button>
        </div>
      </div>

      <!-- Timer Cards -->
      <div class="space-y-4">
        <StopwatchCard
          v-for="timer in activeTab === 'shared'
            ? sharedTimers
            : filteredTimers"
          :key="timer.id"
          :timer="timer"
        />

        <!-- Empty State -->
        <div
          v-if="
            (activeTab === 'shared' ? sharedTimers : filteredTimers).length ===
            0
          "
          class="flex flex-col items-center justify-center py-20 text-center"
        >
          <div
            class="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center mb-4"
          >
            <svg
              class="w-8 h-8 text-indigo-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M10 3h4" />
              <path d="M19 6l1-1" />
              <circle cx="12" cy="13" r="7" />
              <line x1="12" y1="10" x2="12" y2="13" />
            </svg>
          </div>
          <p class="text-sm font-semibold text-[var(--color-text-muted)]">
            {{
              activeTab === "shared"
                ? "Henüz ortak kronometre veya sayaç yok"
                : activeTab === "up"
                  ? "Henüz aktif kronometre yok"
                  : "Henüz aktif sayaç yok"
            }}
          </p>
        </div>
      </div>
    </main>

    <!-- FAB Button -->
    <button
      @click="isModalOpen = true"
      class="fixed bottom-24 right-5 w-14 h-14 bg-indigo-700 text-white rounded-2xl fab-shadow flex items-center justify-center hover:bg-indigo-800 active:scale-90 transition-all z-40"
      aria-label="Yeni ekle"
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>

    <!-- Bottom Tab Bar -->
    <nav
      class="fixed bottom-0 left-0 right-0 z-30 bg-[var(--color-card)] border-t border-[var(--color-border)]"
    >
      <div class="max-w-md mx-auto flex">
        <!-- Count-Up Tab -->
        <button
          @click="activeTab = 'up'"
          :class="[
            'flex-1 py-3  flex flex-col items-center gap-1 transition-colors',
            activeTab === 'up'
              ? 'text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'
              : 'text-[var(--color-text-muted)]',
          ]"
        >
          <!-- Stopwatch icon with number -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <!-- Üst düğme -->
            <path d="M10 3h4" />
            <!-- Sağdaki küçük çıkıntı -->
            <path d="M19 6l1-1" />
            <!-- Kronometre gövdesi -->
            <circle cx="12" cy="13" r="7" />
            <!-- "10" yazısı -->
            <text
              x="11.7"
              y="15.6"
              text-anchor="middle"
              font-size="8"
              font-weight="bold"
              stroke="none"
              fill="currentColor"
            >
              10
            </text>
          </svg>
          <span class="text-[10px] font-black tracking-wider uppercase"
            >Kronometre</span
          >
        </button>

        <!-- Count-Down Tab -->
        <button
          @click="activeTab = 'down'"
          :class="[
            'flex-1 py-3 flex flex-col items-center gap-1 transition-colors',
            activeTab === 'down'
              ? 'text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'
              : 'text-[var(--color-text-muted)]',
          ]"
        >
          <!-- Lucide: hourglass -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <!-- Üst buton ve bağlantı -->
            <path d="M10 2h4" />
            <path d="M12 2v2" />
            <!-- Geri sayım çemberi ve yön oku -->
            <path d="M21 13a9 9 0 1 1-3-6.7L21 9" />
            <polyline points="21 5 21 9 17 9" />
            <!-- Saat ibreleri -->
            <path d="M12 9v4l2.5 2.5" />
          </svg>
          <span class="text-[10px] font-black tracking-wider uppercase"
            >Sayaç</span
          >
        </button>

        <!-- Ortak Tab -->
        <button
          @click="activeTab = 'shared'"
          :class="[
            'flex-1 py-3 flex flex-col items-center gap-1 transition-colors',
            activeTab === 'shared'
              ? 'text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'
              : 'text-[var(--color-text-muted)]',
          ]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span class="text-[10px] font-black tracking-wider uppercase"
            >Ortak</span
          >
        </button>
      </div>
    </nav>

    <!-- Add Modal -->
    <AddModal
      :isOpen="isModalOpen"
      :defaultType="activeTab === 'shared' ? 'up' : activeTab"
      :forceShared="activeTab === 'shared'"
      @close="isModalOpen = false"
    />
  </div>
</template>
