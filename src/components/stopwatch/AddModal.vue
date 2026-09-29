<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { useStopwatchStore } from "@/stores/stopwatchStore";
import { message } from "../../composables/message";
import { apiFetch, getAccessToken, getUser, getAuthGeneration } from "@/services/backendSync";

const props = defineProps(["isOpen", "defaultType", "forceShared"]);
const emit = defineEmits(["close"]);
const store = useStopwatchStore();
const user = computed(() => store.user)
const saving = ref(false)

const presetTimes = store.presetTimes;
const presetNames = store.presetNames;

const isShared = ref(false);
const sharedModeAvailable = ref(false);

const BASE_URL = "https://multi-stopwatch-backend.onrender.com";

const selectPresetTime = (val) => {
  store.duration = val;
};

const selectPresetName = (val) => {
  store.name = val;
};

const decrement = () => {
  if (store.duration > 1) store.duration--;
};

const increment = () => {
  store.duration++;
};

const save = async () => {
  if ((props.forceShared || isShared.value) && !store.requireSharedWrite()) return;
  if (!store.name)
    return message.warning("isim eklemek zorunludur");
  if (store.name.length>35)
    return message.warning("çok uzun isim")
  if (!store.duration)
    return message.warning("süre belirtmek zorunludur");
  if(store.duration<0)
    return message.warning("süre negatif olamaz")
  if(store.duration>1440)
    return message.warning("çok uzun süre(en fazla 1440)")
  if (props.forceShared && !user.value?.workspace_id)
    return message.warning("ortak kronometre oluşturmak için bir workspace'e katılmalısınız")
  if(props.forceShared && !sharedModeAvailable.value)
    return message.warning("yönetici izni yok")
  const isStopwatchNames = store?.stopwatches.map(a=>a.name)
  if(isStopwatchNames?.includes(store.name))
    return message.warning("bu isim önceden kullanılmış")
  if (saving.value || !store.ready) return;
  saving.value = true;
  try {
    const shared = props.forceShared === true || isShared.value;
    const result = await store.addTimer({
      name: store.name, duration: store.duration, type: props.defaultType, isShared: shared, autoStart: shared,
    });
    const createdTimerId = typeof result === "string" ? result : result?.id;
    if (!createdTimerId) return;
    // Shared create-and-start is one user action with two canonical server ACKs;
    // do not issue another START after the controller has already handled it.
    const started = typeof result === "string" ? await store.startTimer(createdTimerId) : result.started === true;
    emit("close");
    if (started) message.success(`${store.name} oluşturuldu`);
    else message.warning("Sayaç kaydedildi; başlatma tamamlanamadı.");
    store.name = JSON.parse(localStorage.getItem("defaultName")) || "kronometre";
    store.duration = JSON.parse(localStorage.getItem("defaultDuration")) || 5;
    isShared.value = false;
  } finally { saving.value = false; }

};

async function checkSharedMode() {
  sharedModeAvailable.value = false;
  const selectedUser = user.value;
  const generation = getAuthGeneration();
  if (!selectedUser?.workspace_id) return;
  const isRequestCurrent = () => getAuthGeneration() === generation &&
    getUser()?.id === selectedUser.id && getUser()?.workspace_id === selectedUser.workspace_id;

  const response = await apiFetch(`${BASE_URL}/workspace`, {
    isRequestCurrent,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAccessToken()}`,
    },
  });

  if (response?.ok) {
    const data = await response.json();
    if (isRequestCurrent()) sharedModeAvailable.value = data.workspace?.shared_mode_enabled === true;
  }
}

watch(() => [user.value?.id, user.value?.workspace_id], () => {
  isShared.value = false;
  void checkSharedMode().catch(() => {});
});

watch(
  () => props.isOpen,
  (newVal) => {
    if (newVal) {
      void checkSharedMode().catch(() => {});
      isShared.value = props.forceShared || false;
    }
  },
);

onMounted(() => { void checkSharedMode().catch(() => {}); });
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-60 flex items-end sm:items-center justify-center"
  >
    <!-- Backdrop -->
    <div
      @click="emit('close')"
      class="absolute inset-0 bg-black/60 backdrop-blur-md"
    ></div>

    <!-- Modal Panel -->
    <div
      class="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl p-7 shadow-2xl"
    >
      <!-- Header -->
      <div
        class="flex justify-between items-center mb-6 pb-5 border-b border-slate-100 dark:border-slate-800"
      >
        <h2 class="text-2xl font-black text-slate-900 dark:text-white">
          Yeni Zamanlayıcı
        </h2>
        <button
          @click="emit('close')"
          class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
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

      <div class="space-y-6">
        <!-- Name Input -->
        <div>
          <label
            class="block text-sm font-bold text-slate-500 dark:text-slate-400 mb-2"
          >
            Zamanlayıcı İsmi
          </label>
          <input
            v-model="store.name"
            type="text"
            placeholder="e.g., Presentation Prep"
            maxlength="35"
            class="w-full px-4 py-3.5 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 border-none outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 text-base font-medium transition-all"
          />
        </div>
        <!-- Quick presetNames -->
        <div class="flex gap-3 overflow-x-auto whitespace-nowrap custom-scroll">
          <button
            v-for="presetName in presetNames"
            :key="presetName"
            @click="selectPresetName(presetName)"
            :class="[
              'flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 border',
              store.name === presetName
                ? 'bg-indigo-700 text-white border-indigo-700'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-indigo-300',
            ]"
          >
            {{ presetName }}
          </button>
        </div>

        <!-- Duration Stepper -->
        <div>
          <div class="flex justify-between items-center mb-2">
            <label class="text-sm font-bold text-slate-500 dark:text-slate-400">
              Hedeflenen Süre
            </label>
            <span
              class="text-sm font-semibold text-slate-400 dark:text-slate-500"
              >Dakika</span
            >
          </div>

          <div
            class="flex items-center bg-indigo-50 dark:bg-slate-800 rounded-2xl p-2 gap-2"
          >
            <!-- Ortak Timer Toggle — sadece workspace'de shared mode açıksa görünür -->
            <div
              v-if="sharedModeAvailable && !forceShared"
              class="flex items-center justify-between ..."
            >
              <span class=" mr-1 text-sm font-bold text-slate-700 dark:text-slate-300"
                >Ortak Zaman</span
              >
              <button
                @click="isShared = !isShared"
                role="switch" aria-label="Ortak zaman" :aria-checked="isShared"
                :class="[
                  'w-12 h-7 rounded-full relative transition-colors duration-300',
                  isShared ? 'bg-indigo-700' : 'bg-slate-300 dark:bg-slate-600',
                ]"
              >
                <div
                  :class="[
                    'absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-300',
                    isShared
                      ? 'translate-x-5 left-0.5'
                      : 'translate-x-0 left-0.5',
                  ]"
                ></div>
              </button>
            </div>
            <div
              v-else-if="forceShared"
              class="wrap-break-word text-xs text-center text-indigo-500 font-medium"
            >
              Bu kronometre otomatik olarak <br/> ortak listeye eklenecek
            </div>

            <!-- Minus -->
            <button
              @click="decrement"
              class="w-12 h-12 bg-indigo-100 dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-700 dark:text-white font-bold text-xl hover:bg-indigo-200 dark:hover:bg-slate-600 active:scale-90 transition-all"
            >
              −
            </button>

            <!-- Value -->
            <div class="flex-1 text-center">
              <input
                v-model.number="store.duration"
                type="number"
                min="1"
                class="no-spinner w-full text-center bg-transparent text-4xl font-black text-slate-900 dark:text-white outline-none tabular-nums"
              />
            </div>

            <!-- Plus -->
            <button
              @click="increment"
              class="w-12 h-12 bg-indigo-100 dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-700 dark:text-white font-bold text-xl hover:bg-indigo-200 dark:hover:bg-slate-600 active:scale-90 transition-all"
            >
              +
            </button>
          </div>
        </div>

        <!-- Quick presetTimes -->
        <div class="flex gap-3 overflow-x-auto whitespace-nowrap custom-scroll">
          <button
            v-for="presetTime in presetTimes"
            :key="presetTime"
            @click="selectPresetTime(presetTime)"
            :class="[
              'flex-1 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 border',
              store.duration === presetTime
                ? 'bg-indigo-700 text-white border-indigo-700'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-indigo-300',
            ]"
          >
            {{ presetTime }} MIN
          </button>
        </div>
      </div>

      <!-- Create Button -->

      <button
        @click="save"
          :aria-disabled="(forceShared || isShared) && !store.sharedWritable"
          :style="(forceShared || isShared) && !store.sharedWritable ? { opacity: 0.45 } : undefined"
        :disabled="saving || !store.ready"
        class="w-full mt-7 py-4 bg-indigo-700 hover:bg-indigo-800 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600 text-white rounded-2xl font-black text-lg shadow-lg shadow-indigo-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
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
        {{props.forceShared===true ? 'ortak kronometre oluştur' : defaultType==='up' ? 'kronometre oluştur' : defaultType==='down' ? 'sayaç oluştur'  : 'oluştur'}}
      </button>


      
    </div>
  </div>
</template>
<style></style>
