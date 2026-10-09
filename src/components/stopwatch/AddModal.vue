<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { useStopwatchStore } from "@/stores/stopwatchStore";
import { message } from "../../composables/message";
import { accountExperience } from '../../services/accountExperience.js';
import {
  apiFetch,
  getAccessToken,
  getUser,
  getAuthGeneration,
} from "@/services/backendSync";

const props = defineProps(["isOpen", "defaultType", "forceShared"]);
const emit = defineEmits(["close"]);
const store = useStopwatchStore();
const user = computed(() => store.user);
const saving = ref(false);

const presetTimes = store.presetTimes;
const presetNames = store.presetNames;

const isShared = ref(false);
const sharedModeAvailable = ref(false);
const sharedModeLoading = ref(false);
let sharedModeCheckId = 0;

const BASE_URL = "https://multi-stopwatch-backend.onrender.com";

const selectPresetTime = async (val) => {
  if (!await accountExperience.requireFeature('presets')) return message.warning('Hazır ayarlar için kullanım hakkı doğrulanamadı.');
  store.duration = val;
};

const selectPresetName = async (val) => {
  if (!await accountExperience.requireFeature('presets')) return message.warning('Hazır ayarlar için kullanım hakkı doğrulanamadı.');
  store.name = val;
};

const decrement = () => {
  if (store.duration > 1) store.duration--;
};

const increment = () => {
  store.duration++;
};

const save = message.withLoading("zamanlayıcı oluşturuluyor...", async () => {
  if ((props.forceShared || isShared.value) && !store.requireSharedWrite())
    return;
  if (!store.name) return message.warning("isim eklemek zorunludur");
  if (store.name.length > 35) return message.warning("çok uzun isim");
  if (!store.duration) return message.warning("süre belirtmek zorunludur");
  if (store.duration < 0) return message.warning("süre negatif olamaz");
  if (store.duration > 1440)
    return message.warning("çok uzun süre(en fazla 1440)");
  if (props.forceShared && !user.value?.workspace_id)
    return message.warning(
      "ortak kronometre oluşturmak için bir workspace'e katılmalısınız",
    );
  if (props.forceShared && !sharedModeAvailable.value)
    return message.warning("yönetici izni yok");
  const isStopwatchNames = store?.stopwatches.map((a) => a.name);
  if (isStopwatchNames?.includes(store.name))
    return message.warning("bu isim önceden kullanılmış");
  if (saving.value || !store.ready) return;
  saving.value = true;
  try {
    const shared = props.forceShared === true || isShared.value;
    const result = await store.addTimer({
      name: store.name,
      duration: store.duration,
      type: props.defaultType,
      isShared: shared,
      autoStart: shared,
    });
    const createdTimerId = typeof result === "string" ? result : result?.id;
    if (!createdTimerId) return;
    // Shared create-and-start is one user action with two canonical server ACKs;
    // do not issue another START after the controller has already handled it.
    const started =
      typeof result === "string"
        ? await store.startTimer(createdTimerId)
        : result.started === true;
    emit("close");
    if (started) message.success(`${store.name} oluşturuldu`);
    else message.warning("Sayaç kaydedildi; başlatma tamamlanamadı.");
    const presetsAllowed = await accountExperience.requireFeature('presets');
    store.name = presetsAllowed ? JSON.parse(localStorage.getItem("defaultName")) || "kronometre" : "kronometre";
    store.duration = presetsAllowed ? JSON.parse(localStorage.getItem("defaultDuration")) || 5 : 5;
    isShared.value = false;
  } finally {
    saving.value = false;
  }
});

async function checkSharedMode() {
  const checkId = ++sharedModeCheckId;

  sharedModeAvailable.value = false;

  const selectedUser = user.value;
  const generation = getAuthGeneration();

  sharedModeLoading.value = Boolean(selectedUser?.workspace_id);

  if (!selectedUser?.workspace_id) return;
  if (!await accountExperience.refresh() || !accountExperience.canShared()) { sharedModeLoading.value = false; return; }

  const isRequestCurrent = () =>
    checkId === sharedModeCheckId &&
    getAuthGeneration() === generation &&
    getUser()?.id === selectedUser.id &&
    getUser()?.workspace_id === selectedUser.workspace_id;

  try {
    const response = await apiFetch(`${BASE_URL}/workspace`, {
      isRequestCurrent,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAccessToken()}`,
      },
    });

    if (response?.ok) {
      const data = await response.json();

      if (isRequestCurrent()) {
        sharedModeAvailable.value =
          data.workspace?.shared_mode_enabled === true;
      }
    }
  } finally {
    if (checkId === sharedModeCheckId) {
      sharedModeLoading.value = false;
    }
  }
}

watch(
  () => [user.value?.id, user.value?.workspace_id],
  () => {
    isShared.value = false;
    void checkSharedMode().catch(() => {});
  },
);

watch(
  () => props.isOpen,
  (newVal) => {
    if (newVal) {
      if (!accountExperience.canFeature('presets')) { store.name = 'kronometre'; store.duration = 5; }
      void checkSharedMode().catch(() => {});
      isShared.value = props.forceShared || false;
    }
  },
);

onMounted(() => {
  void checkSharedMode().catch(() => {});
});
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-60 flex items-end justify-center sm:items-center sm:p-4"
  >
    <!-- Backdrop -->
    <div
      @click="emit('close')"
      class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
    ></div>

    <!-- Modal Panel -->
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-timer-title"
      class="custom-scroll-y relative max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl relative max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl border border-slate-200/80 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:rounded-3xl sm:p-7"
    >
      <!-- Header -->
      <div
        class="mb-5 flex items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800"
      >
        <h2
          id="add-timer-title"
          class="min-w-0 text-xl font-black tracking-tight text-slate-900 dark:text-white sm:text-2xl"
        >
          Yeni Zamanlayıcı
        </h2>

        <button
          type="button"
          @click="emit('close')"
          aria-label="Kapat"
          class="flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="size-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div class="space-y-5">
        <!-- Name Input -->
        <div>
          <label
            for="new-timer-name"
            class="mb-2 block text-sm font-bold text-slate-600 dark:text-slate-400"
          >
            Zamanlayıcı İsmi
          </label>

          <input
            id="new-timer-name"
            v-model="store.name"
            type="text"
            placeholder="Örn. Sunum hazırlığı"
            maxlength="35"
            class="w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base font-medium text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-500 dark:focus:bg-slate-800"
          />
        </div>

        <!-- Quick presetNames -->
        <div
          v-if="presetNames.length && accountExperience.canFeature('presets')"
          class="custom-scroll flex gap-2 overflow-x-auto pb-1"
        >
          <button
            v-for="presetName in presetNames"
            :key="presetName"
            type="button"
            @click="selectPresetName(presetName)"
            :class="[
              'shrink-0 whitespace-nowrap rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
              store.name === presetName
                ? 'border-indigo-700 bg-indigo-700 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:bg-slate-700',
            ]"
          >
            {{ presetName }}
          </button>
        </div>

        <!-- Duration Stepper -->
        <div>
          <div class="mb-2 flex items-center justify-between gap-3">
            <label
              for="new-timer-duration"
              class="text-sm font-bold text-slate-600 dark:text-slate-400"
            >
              Hedeflenen Süre
            </label>

            <span
              class="text-xs font-semibold text-slate-400 dark:text-slate-500"
            >
              Dakika
            </span>
          </div>

          <div
            class="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-2 dark:border-slate-700 dark:bg-slate-800"
          >
            <!-- Minus -->
            <button
              type="button"
              @click="decrement"
              aria-label="Süreyi bir dakika azalt"
              class="flex size-11 items-center justify-center rounded-xl bg-white text-2xl font-bold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600"
            >
              −
            </button>

            <!-- Value -->
            <div class="min-w-0 px-1">
              <input
                id="new-timer-duration"
                v-model.number="store.duration"
                type="number"
                inputmode="numeric"
                min="1"
                class="no-spinner block w-full min-w-0 rounded-lg bg-transparent py-2 text-center text-3xl font-black tabular-nums tracking-tight text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-white sm:text-4xl"
              />
            </div>

            <!-- Plus -->
            <button
              type="button"
              @click="increment"
              aria-label="Süreyi bir dakika artır"
              class="flex size-11 items-center justify-center rounded-xl bg-white text-2xl font-bold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600"
            >
              +
            </button>
          </div>
        </div>

        <!-- Quick presetTimes -->
        <div
          v-if="presetTimes.length && accountExperience.canFeature('presets')"
          class="custom-scroll flex gap-2 overflow-x-auto pb-1"
        >
          <button
            v-for="presetTime in presetTimes"
            :key="presetTime"
            type="button"
            @click="selectPresetTime(presetTime)"
            :class="[
              'shrink-0 whitespace-nowrap rounded-xl border px-4 py-2.5 text-sm font-bold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
              store.duration === presetTime
                ? 'border-indigo-700 bg-indigo-700 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500 dark:hover:bg-slate-700',
            ]"
          >
            {{ presetTime }} dk
          </button>
        </div>

        <!-- Ortak Zaman: süre alanından bağımsız -->
        <div
          v-if="forceShared || sharedModeLoading || sharedModeAvailable"
          class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60"
        >
          <!-- Ortak ekran üzerinden açılan modal -->
          <div v-if="forceShared" class="flex items-start gap-3">
            <div
              class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
            >
              <svg
                class="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="9" cy="8" r="3" />
                <path
                  d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"
                />
              </svg>
            </div>

            <div class="min-w-0">
              <p class="text-sm font-bold text-slate-800 dark:text-slate-200">
                Ortak Zamanlayıcı
              </p>
              <p
                class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400"
              >
                Bu kronometre otomatik olarak ortak listeye eklenecek.
              </p>
            </div>
          </div>

          <!-- İsteğe bağlı ortak zaman toggle -->
          <div
            v-else
            :aria-busy="sharedModeLoading"
            class="flex items-center justify-between gap-4"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-bold text-slate-800 dark:text-slate-200">
                Ortak Zamanlayıcı
              </p>

              <!-- Yüklenme yalnızca bu bölümde -->
              <p
                v-if="sharedModeLoading"
                role="status"
                class="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
              >
                <svg
                  class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" opacity="0.25" />
                  <path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round" />
                </svg>

                Yükleniyor...
              </p>

              <p
                v-else
                class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400"
              >
                Çalışma grubuyla paylaş
              </p>
            </div>

            <button
              type="button"
              @click="isShared = !isShared"
              role="switch"
              aria-label="Ortak zaman"
              :aria-checked="isShared"
              :disabled="sharedModeLoading"
              :class="[
                'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500 disabled:cursor-wait disabled:opacity-50',
                isShared ? 'bg-indigo-700' : 'bg-slate-300 dark:bg-slate-600',
              ]"
            >
              <span
                :class="[
                  'absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none',
                  isShared ? 'translate-x-5' : 'translate-x-0',
                ]"
              ></span>
            </button>
          </div>
        </div>
      </div>

      <!-- Create Button -->
      <button
        type="button"
        @click="save"
        :aria-disabled="(forceShared || isShared) && !store.sharedWritable"
        :style="
          (forceShared || isShared) && !store.sharedWritable
            ? { opacity: 0.45 }
            : undefined
        "
        :disabled="
          saving ||
          !store.ready ||
          (sharedModeLoading && (forceShared || isShared))
        "
        class="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-700 px-4 py-4 text-center text-base font-black leading-6 text-white shadow-lg shadow-indigo-500/20 transition-colors hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
      >
        <svg
          class="size-5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>

        <span class="min-w-0">
          {{
            props.forceShared === true
              ? "ortak kronometre oluştur"
              : defaultType === "up"
                ? "kronometre oluştur"
                : defaultType === "down"
                  ? "sayaç oluştur"
                  : "oluştur"
          }}
        </span>
      </button>
    </div>
  </div>
</template>
<style>
/* ---------- Renk değişkenleri ---------- */
.custom-scroll,
.custom-scroll-y {
  --sb-size: 6px;
  --sb-thumb: rgb(165 180 252 / 0.55);        /* indigo-300 */
  --sb-thumb-hover: rgb(99 102 241 / 0.85);   /* indigo-500 */
  --sb-thumb-active: rgb(67 56 202);          /* indigo-700 */
}

:global(.dark) .custom-scroll,
:global(.dark) .custom-scroll-y {
  --sb-thumb: rgb(100 116 139 / 0.5);         /* slate-500 */
  --sb-thumb-hover: rgb(129 140 248 / 0.85);  /* indigo-400 */
  --sb-thumb-active: rgb(165 180 252);        /* indigo-300 */
}

/* ---------- Chromium / Safari / Edge ---------- */
.custom-scroll::-webkit-scrollbar,
.custom-scroll-y::-webkit-scrollbar {
  width: var(--sb-size);
  height: var(--sb-size);
}

.custom-scroll::-webkit-scrollbar-track,
.custom-scroll-y::-webkit-scrollbar-track {
  background: transparent;
}

/* Dikey scroll, modalın yuvarlak köşelerine yapışmasın */
.custom-scroll-y::-webkit-scrollbar-track {
  margin-block: 1.25rem;
}

.custom-scroll::-webkit-scrollbar-thumb,
.custom-scroll-y::-webkit-scrollbar-thumb {
  background-color: var(--sb-thumb);
  border-radius: 9999px;
  transition: background-color 0.2s;
}

.custom-scroll::-webkit-scrollbar-thumb:hover,
.custom-scroll-y::-webkit-scrollbar-thumb:hover {
  background-color: var(--sb-thumb-hover);
}

.custom-scroll::-webkit-scrollbar-thumb:active,
.custom-scroll-y::-webkit-scrollbar-thumb:active {
  background-color: var(--sb-thumb-active);
}

/* ---------- Firefox (webkit scrollbar desteklemeyen tarayıcılar) ---------- */
@supports not selector(::-webkit-scrollbar) {
  .custom-scroll,
  .custom-scroll-y {
    scrollbar-width: thin;
    scrollbar-color: var(--sb-thumb) transparent;
  }
}
</style>
