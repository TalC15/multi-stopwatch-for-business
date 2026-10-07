<script setup>
import { ref, computed, onMounted } from "vue";
import { RouterLink } from "vue-router";
import { useStopwatchStore } from "@/stores/stopwatchStore";
import { useThemeStore } from "@/stores/themeStore";
import Navbar from "@/components/layout/Navbar.vue";
import SettingsDrawer from "@/components/layout/SettingsDrawer.vue";
import StopwatchCard from "@/components/stopwatch/StopwatchCard.vue";
import AddModal from "@/components/stopwatch/AddModal.vue";
import ConfirmModal from "@/components/ui/ConfirmModal.vue";
import { message } from "../composables/message";
import {
  sortTimers,
  TIMER_SORT,
  normalizeTimerSort,
} from "../domain/timerSort.js";
import TimerSortMenu from "@/components/stopwatch/TimerSortMenu.vue";

const store = useStopwatchStore();
const themeStore = useThemeStore();

const activeTab = ref("up");
const isDrawerOpen = ref(false);
const isModalOpen = ref(false);
const isPausedAll = ref(false);
const sortDirection = ref(TIMER_SORT.NEAREST);
function changeSort(value) {
  sortDirection.value = normalizeTimerSort(value);
}

const filteredTimers = computed(() =>
  store.stopwatches.filter((t) => t.type === activeTab.value && !t.isShared),
);

const sharedTimers = computed(() =>
  store.stopwatches.filter((t) => t.isShared),
);

// Sorting affects only the visible cards, never the store or bulk action order.
const visibleTimers = computed((previous) =>
  sortTimers(
    activeTab.value === "shared" ? sharedTimers.value : filteredTimers.value,
    sortDirection.value,
    previous,
  ),
);

function openAdd() {
  if (activeTab.value === "shared" && !store.requireSharedWrite()) return;
  isModalOpen.value = true;
}
const noticeStyles = {
  neutral:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
  info: "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  error:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
};

//bu fonksiyonun çağrıldığı yerler yorum satırında.İleride yorum satırı açılırsa sharedControls.test.js dosyasındaki 'test("Home hides personal notice and...' bölümünün güncellenmesi gerekir ki test edilebilsin.
const personalNotice = computed(() => {
  if (!store.ready)
    return { tone: "neutral", message: "Sayaçlarınız açılıyor…" };
  if (store.syncStatus === "unsupported-locks")
    return {
      tone: "warning",
      message:
        "Kişisel sayaçlarınız bu cihazda kayıtlı. Diğer cihazlarla güncellemek için tarayıcı veya Android System WebView güncellemesi gerekiyor.",
    };
  if (store.syncStatus === "backend-update-required")
    return {
      tone: "warning",
      message:
        "Kişisel sayaçlarınız bu cihazda kayıtlı. Diğer cihazlarla güncelleme şu anda kullanılamıyor.",
    };
  if (["auth-required", "forbidden"].includes(store.syncStatus))
    return {
      tone: "error",
      message:
        "Kişisel sayaçlar için hesabınızı ve şirket erişiminizi kontrol edin. Cihazdaki değişiklikleriniz korunuyor.",
    };
  if (store.syncStatus === "conflict")
    return {
      tone: "warning",
      message:
        "Bazı kişisel sayaçlar güncellenemedi. Cihazdaki değişiklikleriniz korunuyor.",
    };
  if (store.syncStatus === "retry")
    return {
      tone: "warning",
      message:
        "Kişisel sayaçlar için bağlantı bekleniyor. Cihazdaki kayıtlarınız korunuyor.",
    };
  if (store.pendingCount)
    return {
      tone: "neutral",
      message: `${store.pendingCount} kişisel değişiklik bu cihazda kayıtlı; diğer cihazlara aktarılmayı bekliyor.`,
    };
  return null;
});
async function allTimersPause() {
  const results = await Promise.all(
    filteredTimers.value.map((timer) =>
      isPausedAll.value
        ? store.startTimer(timer.id)
        : store.pauseTimer(timer.id),
    ),
  );
  if (results.every(Boolean)) isPausedAll.value = !isPausedAll.value;
}

const retryPersonalSync = message.withLoading(
  "Kişisel sayaçlar eşitleniyor...",
  () => store.retrySync(),
);

const reviewPersonalSync = message.withLoading(
  "Sunucu kaydı inceleniyor...",
  (id) => store.reviewSyncIssue(id),
);

const acceptPersonalSync = message.withLoading(
  "Sunucu kaydı uygulanıyor...",
  () => store.acceptSyncServer(),
);

const reloadSharedTimers = message.withLoading(
  "Ortak sayaçlar yükleniyor...",
  () => store.loadSharedTimers(),
);

onMounted(() => {
  themeStore.applyTheme();
  void message.withLoading("Sayaçlar yükleniyor...", () =>
    store.initialize(),
  )();
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
      <!--Bu yorum satırına alınan bölüm aynı hesap arası senkronizasyon hakkında bilgi veriyor ve senkronizasyonu yeniden deneme butonu var, UI açısından şuan yorum satırında-->
      <!--<div
        v-if="activeTab !== 'shared' && personalNotice"
        role="status"
        aria-live="polite"
        :class="[
          'mb-3 flex items-start gap-3 rounded-xl border p-3 text-sm leading-5',
          noticeStyles[personalNotice.tone],
        ]"
      >
      
        <svg
          class="h-5 w-5 shrink-0 mt-0.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6m0 3v1" stroke-linecap="round" />
        </svg>
        <p class="min-w-0 break-words">{{ personalNotice.message }}</p>
      </div>-->
      <!-- <button
        v-if="
          activeTab !== 'shared' &&
          (store.pendingCount || store.syncStatus === 'retry')
        "
        @click="store.retryPersonalSync()"
        class="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 active:bg-slate-100"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20 4v6h-6" />
          <path d="M20 10a8 8 0 1 0-1.5 7" />
        </svg>
        Senkronizasyonu yeniden dene
      </button>-->
      <ul
        v-if="activeTab !== 'shared' && store.syncIssues?.length"
        class="space-y-3 mb-4 text-sm"
      >
        <li
          v-for="issue in store.syncIssues"
          :key="issue.seq"
          class="rounded-xl border p-3"
        >
          <strong>{{ issue.name }}</strong> — {{ issue.method
          }}<span v-if="issue.httpStatus"> ({{ issue.httpStatus }})</span>
          <p>{{ issue.reason }} Cihazdaki değişiklikler korunuyor.</p>
          <button
            v-if="issue.canReview"
            :disabled="store.resolvingSync"
            @click="reviewPersonalSync(issue.timerId)"
            class="underline mt-2"
          >
            Sunucu kaydını incele
          </button>
          <p v-else-if="issue.status !== 'auth-required'">
            Salt okunur tanı raporuyla destek isteyin; kayıtları temizlemeyin.
          </p>
        </li>
      </ul>
      <ConfirmModal
        :isOpen="Boolean(store.syncReview)"
        title="Sunucu kaydını kabul et?"
        :message="
          store.syncReview
            ? `${store.syncReview.name || 'Sayaç'} için sunucu sürümü ${store.syncReview.revision}: ${store.syncReview.kind === 'terminal' ? 'silinmiş veya arşivlenmiş' : store.syncReview.serverName}. Onaylarsanız yalnız bu sayacın cihazdaki bekleyen değişikliklerinden vazgeçilir ve bu sunucu kaydı kullanılır. Sunucu kaydı değiştirilmez.`
            : ''
        "
        confirmText="Yerel değişikliklerden vazgeç"
        cancelText="Koru ve vazgeç"
        :confirmDisabled="store.resolvingSync"
        @confirm="acceptPersonalSync()"
        @cancel="store.cancelSyncReview()"
      />
      <section
        v-if="activeTab === 'shared'"
        role="status"
        aria-live="polite"
        :data-state="store.sharedNotice.state"
        :class="[
          'mb-4 flex items-start gap-3 rounded-xl border p-3 text-sm leading-5',
          noticeStyles[store.sharedNotice.tone],
        ]"
      >
        <svg
          class="h-5 w-5 shrink-0 mt-0.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <g
            v-if="
              store.sharedNotice.state === 'signed-out' ||
              store.sharedNotice.state === 'auth-required'
            "
          >
            <path d="M10 4H5v16h5M17 8l4 4-4 4M8 12h13" />
          </g>
          <g v-else-if="store.sharedNotice.state === 'workspace-required'">
            <circle cx="9" cy="8" r="3" />
            <path
              d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"
            />
          </g>
          <g v-else-if="store.sharedNotice.state === 'offline-readonly'">
            <path
              d="m3 3 18 18M2 8a16 16 0 0 1 3-2m4-2a16 16 0 0 1 13 4M5 12a11 11 0 0 1 4-2m4 0a11 11 0 0 1 6 2m-11 4a6 6 0 0 1 5-1m-1 5h.01"
            />
          </g>
          <g
            v-else-if="
              store.sharedNotice.tone === 'warning' ||
              store.sharedNotice.tone === 'error'
            "
          >
            <path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1" />
          </g>
          <g v-else>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6m0-10h.01" />
          </g>
        </svg>
        <div class="min-w-0 flex-1 break-words">
          <p>{{ store.sharedNotice.message }}</p>
          <RouterLink
            v-if="store.sharedNotice.to"
            :to="store.sharedNotice.to"
            class="mt-2 inline-flex min-h-9 items-center rounded-lg px-2 font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >{{ store.sharedNotice.action }}</RouterLink
          >
          <button
            v-else-if="store.sharedNotice.state === 'unavailable'"
            type="button"
            @click="reloadSharedTimers()"
            class="mt-2 inline-flex min-h-9 items-center rounded-lg px-2 font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Yeniden dene
          </button>
        </div>
      </section>
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
          <TimerSortMenu
            :model-value="sortDirection"
            @update:model-value="changeSort"
          />
        </div>
      </div>

      <!-- Timer Cards -->
      <div class="space-y-4">
        <StopwatchCard
          v-for="timer in visibleTimers"
          :key="timer.id"
          :timer="timer"
        />

        <!-- Empty State -->
        <div
          v-if="
            (activeTab === 'shared' ? sharedTimers : filteredTimers).length ===
              0 &&
            (activeTab !== 'shared' || store.sharedNotice.state === 'ready')
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
      @click="openAdd"
      :aria-disabled="activeTab === 'shared' && !store.sharedWritable"
      :style="
        activeTab === 'shared' && !store.sharedWritable
          ? { opacity: 0.45 }
          : undefined
      "
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
            <path d="M9.5 2.5h5M12 2.5v3" />

            <!-- Yan düğme -->
            <path d="m17.3 7.7 1.6-1.6m-.9-.9 1.8 1.8" />

            <!-- Gövde -->
            <circle cx="12" cy="13" r="7.5" />

            <!-- Kadran işaretleri -->
            <path
              d="M12 7.5v.8M17.5 13h-.8M12 18.5v-.8M6.5 13h.8"
              stroke-width="1.25"
              opacity=".55"
            />

            <!-- İbre ve merkez -->
            <path d="m12 13 2.8-3.2" stroke-width="1.75" />
            <circle cx="12" cy="13" r=".85" fill="currentColor" stroke="none" />
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
            class="h-6 w-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <!-- Kişiler -->
            <circle cx="9" cy="7.5" r="3.5" />
            <path d="M2 20.5v-.7A4.8 4.8 0 0 1 6.8 15h3.6" />
            <path d="M15.6 3.6a3.5 3.5 0 0 1 0 7.3" />

            <!-- Saat rozeti -->
            <circle
              cx="17.8"
              cy="17.8"
              r="4.6"
              fill="currentColor"
              fill-opacity="0.14"
            />
            <path d="M17.8 15.4v2.5l1.6 1" />
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
