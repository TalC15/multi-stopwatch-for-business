<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useThemeStore } from "@/stores/themeStore";
import { useStopwatchStore } from "../stores/stopwatchStore";
import { useRouter } from "vue-router";
import { message } from "../composables/message";
import { saveTelegramChatId,telegramControl,getUser,cancelTelegramChatId } from "@/services/backendSync";
import telegramStep1 from "@/assets/telegram/telegram-step-1.png";
import telegramStep2 from "@/assets/telegram/telegram-step-2.png";
import telegramStep3 from "@/assets/telegram/telegram-step-3.png";
import telegramStep4 from "@/assets/telegram/telegram-step-4.png";
import telegramStep5 from "@/assets/telegram/telegram-step-5.png";

const store = useStopwatchStore();
const themeStore = useThemeStore();
const router = useRouter();
const user = getUser()
const stopwatchStore = useStopwatchStore();
const presetTime = ref("");
const presetName = ref("");
const chatId = ref("");
const telegramLoadingButton = ref(false);
const telegramLoadingDiv = ref(false);
const telegramSaved = ref(!!localStorage.getItem("telegramChatId"));

const showTelegramHelp = ref(false);
const currentTelegramStep = ref(0);

const telegramSteps = [
  {
    title: "Telegram'ı açın",
    description: "Telefonunuzda Telegram uygulamasını açın.",
    image: telegramStep1,
  },
  {
    title: "KeepTimer Bildirimleri botunu arayın",
    description:
      "Telegram'ın arama bölümüne @KeepTimeApp_bot yazın ve KeepTimer Bildirimleri botunu seçin.",
    image: telegramStep2,
  },
  {
    title: "/start komutunu gönderin",
    description:
      "Bot ile sohbeti açtıktan sonra mesaj bölümüne /start yazıp gönderin.",
    image: telegramStep3,
  },
  {
    title: "Chat ID'nizi alın",
    description: "Bot size bir Chat ID gönderecek. Bu numarayı kopyalayın.",
    image: telegramStep4,
  },
  {
    title: "Chat ID'yi KeepTimer'a girin",
    description:
      "Kopyaladığınız Chat ID'yi aşağıdaki alana yapıştırın ve Kaydet'e basın.",
    image: telegramStep5,
  },
];

async function telegramSavedControl() {
  telegramLoadingDiv.value = true;
  const res = await telegramControl(user?.id);
  telegramLoadingDiv.value = false;
  telegramSaved.value = res.connected;
}

onMounted(() => {
  telegramSteps.forEach((step) => {
    const img = new Image();
    img.src = step.image;
  });
  telegramSavedControl()
});

function openTelegramHelp() {
  currentTelegramStep.value = 0;
  showTelegramHelp.value = true;
}

function closeTelegramHelp() {
  showTelegramHelp.value = false;
}

function nextTelegramStep() {
  if (currentTelegramStep.value < telegramSteps.length - 1) {
    currentTelegramStep.value++;
  }
}

function previousTelegramStep() {
  if (currentTelegramStep.value > 0) {
    currentTelegramStep.value--;
  }
}

async function saveTelegram() {
  if (!chatId.value) return;
  telegramLoadingButton.value = true;

  const result = await saveTelegramChatId(chatId.value);

  if (result?.success) {
    localStorage.setItem("telegramChatId", chatId.value);
    telegramSaved.value = true;
    message.success("Telegram bağlandı!");
  } else {
    message.warning("Geçersiz Chat ID. Lütfen tekrar dene.");
  }

  telegramLoadingButton.value = false;
}

async function removeTelegram(user_id) {
  if (!user_id) return;
  const result = await cancelTelegramChatId(user_id);
  console.log(result);
  if (result?.success) {
    localStorage.removeItem("telegramChatId");
    telegramSaved.value = false;
    chatId.value = "";
    message.success("Telegram bağlantısı kesildi");
  } else {
    message.error("Telegram bağlantısı kesilemedi");
  }
}

function defaultSettings(preset) {
  if (typeof preset === "number") {
    stopwatchStore.duration = preset;
    localStorage.setItem(
      "defaultDuration",
      JSON.stringify(stopwatchStore.duration),
    );
    message.success(`varsayılan zaman ${preset} dk olarak ayarlandı`);
  } else {
    stopwatchStore.name = preset;
    localStorage.setItem("defaultName", JSON.stringify(stopwatchStore.name));
    message.success(`varsayılan isim "${preset}" olarak ayarlandı`);
  }
}

function addPresetTime() {
  if(!presetTime.value||String(presetTime.value).trim()==='') return message.warning('bir süre belirtmediniz')
  if(presetTime.value>1440) return message.warning("çok uzun süre(en fazla 1440)")
  if(presetTime.value<0) return message.warning("süre negatif olamaz")
  if (!/^\d+$/.test(presetTime.value)) return message.warning("geçersiz süre")
  const isPresetTimes = store?.presetTimes.map((a) => a);
  if (isPresetTimes?.includes(presetTime.value))
    return message.warning("Bu zaman etiketi zaten mevcut");
  stopwatchStore.presetTimes.push(presetTime.value);
  localStorage.setItem(
    "presetTimes",
    JSON.stringify(stopwatchStore.presetTimes),
  );
  message.success("yeni zaman etiketi oluşturuldu");
  presetTime.value = "";
}

function addPresetName() {
  if(!presetName.value || presetName.value.trim()==='') return message.warning('bir isim koymadınız')
  if(presetName.value.length>35) return message.warning('çok uzun isim')
  const isPresetNames = store?.presetNames.map((a) => a);
  if (isPresetNames?.includes(presetName.value))
    return message.warning("Bu isim etiketi zaten mevcut");
  stopwatchStore.presetNames.push(presetName.value);
  localStorage.setItem(
    "presetNames",
    JSON.stringify(stopwatchStore.presetNames),
  );
  message.success("yeni isim etiketi oluşturuldu");
  presetName.value = "";
}

function removePresetTime(bIndex) {
  stopwatchStore.presetTimes = stopwatchStore.presetTimes.filter(
    (a, aIndex) => aIndex !== bIndex,
  );
  localStorage.setItem(
    "presetTimes",
    JSON.stringify(stopwatchStore.presetTimes),
  );
  message.success("bir zaman etiketi silindi");
}

function removePresetName(bIndex) {
  stopwatchStore.presetNames = stopwatchStore.presetNames.filter(
    (a, aIndex) => aIndex !== bIndex,
  );
  localStorage.setItem(
    "presetNames",
    JSON.stringify(stopwatchStore.presetNames),
  );
  message.success("bir isim etiketi silindi");
}
</script>

<template>
  <div class="min-h-screen bg-surface">
    <!-- Navbar -->
    <nav
      class="h-14 bg-card border-b border-border px-4 flex items-center justify-between sticky top-0 z-30"
    >
      <button
        @click="router.push('/')"
        class="w-9 h-9 flex items-center justify-center text-primary-light active:scale-90 transition-transform"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>
      <h1 class="text-lg font-black text-primary-light">Ayarlar</h1>
      <div class="w-9"></div>
    </nav>

    <!-- Content -->
    <main class="max-w-md mx-auto px-4 pt-6 pb-12">
      <!-- Section -->
      <div class="mb-2 ml-1">
        <span
          class="text-xs font-black tracking-widest uppercase text-text-muted"
          >Özelleştirme</span
        >
      </div>
      <div
        class="bg-card rounded-2xl border border-border overflow-hidden mb-6"
      >
        <div class="flex items-center justify-between px-4 py-4">
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-lg bg-primary-bg flex items-center justify-center"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-primary-light"
              >
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            </div>
            <span class="font-medium text-text-primary">Koyu Tema</span>
          </div>
          <button
            @click="themeStore.toggleTheme()"
            :class="[
              'w-12 h-7 rounded-full relative transition-colors duration-300',
              themeStore.isDark ? 'bg-primary-light' : 'bg-border',
            ]"
          >
            <div
              :class="[
                'absolute top-0.5 w-6 h-6 bg-card rounded-full shadow transition-transform duration-300',
                themeStore.isDark
                  ? 'translate-x-5 left-0.5'
                  : 'translate-x-0 left-0.5',
              ]"
            ></div>
          </button>
        </div>
      </div>

      <!--time tags-->
      <div class="relative w-full flex item-center">
        <svg
          class="absolute left-4 top-1/2 -translate-y-1/2 z-10"
          width="23"
          height="23"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M8 9H6.2C5.0799 9 4.51984 9 4.09202 9.218C3.71569 9.40973 3.40973 9.71569 3.21799 10.092C3 10.5198 3 11.0799 3 12.2V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.07989 21 6.2 21H17.787C18.9071 21 19.4671 21 19.895 20.782C20.2713 20.5903 20.5772 20.2843 20.769 19.908C20.987 19.4802 20.987 18.9201 20.987 17.8V12M6 15H6.01M10 15H10.01M11.5189 12.8945L12.8337 12.6347C13.5432 12.4945 13.8979 12.4244 14.2287 12.2953C14.5223 12.1807 14.8013 12.0318 15.06 11.8516C15.3514 11.6487 15.607 11.393 16.1184 10.8816L21.2668 5.73321C21.9541 5.04596 21.9541 3.9317 21.2668 3.24444C20.5796 2.55719 19.4653 2.55719 18.7781 3.24445L13.5416 8.48088C13.0625 8.96004 12.8229 9.19963 12.6294 9.47121C12.4576 9.71232 12.3131 9.97174 12.1986 10.2447C12.0696 10.5522 11.9921 10.8821 11.837 11.5417L11.5189 12.8945Z"
            stroke="#4F46E5"
            stroke-width="1.776"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

        <input
          v-model="presetTime"
          type="number"
          placeholder="Zaman etiketi oluşturun"
          :class="[
            'no-spinner w-full rounded-2xl border  bg-white/10 h-12 pl-12 pr-4  backdrop-blur-md outline-none transition-all duration-300 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20',
            themeStore.isDark
              ? 'placeholder:text-white/60 text-white border-white/20'
              : 'placeholder:text-[#0F172A] text-[#0F172A] border-[#0F172A]',
          ]"
        />
        <button
          class="ml-3 w-15 h-12 text-2xl leading-none bg-indigo-700 text-white rounded-2xl fab-shadow hover:bg-indigo-800"
          @click="addPresetTime"
        >
          <span class="relative top-1px">+</span>
        </button>
      </div>

      <div class="relative isolate mb-3">
        <div class="flex gap-3 overflow-x-auto whitespace-nowrap custom-scroll">
          <span
            v-for="(presetTime, index) in stopwatchStore.presetTimes"
            :key="index"
            class="w-20% mt-3 px-2 py-2 flex items-center justify-center rounded-2xl border border-[#4F46E5] shadow-sm text-sm font-medium hover:bg-[#4F46E5]/10 transition"
          >
            <span @click="defaultSettings(presetTime)">
              {{ presetTime }}
            </span>
            <button
              @click="removePresetTime(index)"
              class="w-7 ml-3 text-xl leading-none -translate-y-0.5"
            >
              &times
            </button>
          </span>
        </div>
      </div>

      <!--name tags-->
      <div class="relative w-full flex item-center">
        <svg
          class="absolute left-4 top-1/2 -translate-y-1/2 z-10"
          width="23"
          height="23"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M8 9H6.2C5.0799 9 4.51984 9 4.09202 9.218C3.71569 9.40973 3.40973 9.71569 3.21799 10.092C3 10.5198 3 11.0799 3 12.2V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.07989 21 6.2 21H17.787C18.9071 21 19.4671 21 19.895 20.782C20.2713 20.5903 20.5772 20.2843 20.769 19.908C20.987 19.4802 20.987 18.9201 20.987 17.8V12M6 15H6.01M10 15H10.01M11.5189 12.8945L12.8337 12.6347C13.5432 12.4945 13.8979 12.4244 14.2287 12.2953C14.5223 12.1807 14.8013 12.0318 15.06 11.8516C15.3514 11.6487 15.607 11.393 16.1184 10.8816L21.2668 5.73321C21.9541 5.04596 21.9541 3.9317 21.2668 3.24444C20.5796 2.55719 19.4653 2.55719 18.7781 3.24445L13.5416 8.48088C13.0625 8.96004 12.8229 9.19963 12.6294 9.47121C12.4576 9.71232 12.3131 9.97174 12.1986 10.2447C12.0696 10.5522 11.9921 10.8821 11.837 11.5417L11.5189 12.8945Z"
            stroke="#4F46E5"
            stroke-width="1.776"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

        <input
          v-model="presetName"
          type="text"
          placeholder="İsim etiketi oluşturun"
          maxlength="35"
          :class="[
            'no-spinner w-full rounded-2xl border  bg-white/10 h-12 pl-12 pr-4  backdrop-blur-md outline-none transition-all duration-300 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20',
            themeStore.isDark
              ? 'placeholder:text-white/60 text-white border-white/20'
              : 'placeholder:text-[#0F172A] text-[#0F172A] border-[#0F172A]',
          ]"
        />
        <button
          class="ml-3 w-15 h-12 text-2xl leading-none bg-indigo-700 text-white rounded-2xl fab-shadow hover:bg-indigo-800"
          @click="addPresetName"
        >
          <span class="relative top-1px">+</span>
        </button>
      </div>

      <div class="relative isolate mb-3">
        <div class="flex gap-3 overflow-x-auto whitespace-nowrap custom-scroll">
          <div
            v-for="(presetName, index) in stopwatchStore.presetNames"
            :key="index"
            class="relative shrink-0"
          >
            <span
              class="cursor-pointer mt-3 px-2 py-2 flex items-center justify-center rounded-2xl border border-[#4F46E5] shadow-sm text-sm font-medium hover:bg-[#4F46E5]/10 transition"
            >
              <span @click="defaultSettings(presetName)">
                {{ presetName }}
              </span>

              <button
                @click.stop="removePresetName(index)"
                class="w-5 ml-3 text-xl leading-none -translate-y-0.5"
              >
                &times;
              </button>
            </span>
          </div>
        </div>
      </div>

      <!-- Telegram Bildirimi -->
     <div v-if="!telegramLoadingDiv">
        <div
        class="bg-card rounded-2xl border border-border overflow-hidden mb-6"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-4">
          <!-- Sol taraf -->
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="w-8 h-8 shrink-0 rounded-lg bg-primary-bg flex items-center justify-center"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-primary-light"
              >
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22 11 13 2 9l20-7z" />
              </svg>
            </div>

            <span class="font-medium text-text-primary">
              Telegram Bildirimi
            </span>
          </div>

          <!-- Bilgi butonu -->
          <button
            type="button"
            @click="openTelegramHelp"
            class="shrink-0 w-9 h-9 ml-3 rounded-full flex items-center justify-center cursor-pointer text-[#4F46E5] border border-[#432DD7] hover:bg-[#3624b5] active:scale-95 transition-all duration-200"
            aria-label="Telegram bağlantısı hakkında bilgi"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 10v6" />
              <path d="M12 7h.01" />
            </svg>
          </button>
        </div>

        <!-- Telegram bağlı değilse -->
        <div v-if="!telegramSaved" class="px-4 pb-4 flex flex-col gap-2">
          <p class="text-xs text-text-secondary">
            @KeepTimeApp_bot'a <strong>/start</strong> yaz, sonra chat ID'ni
            gir.
          </p>

          <input
            v-model="chatId"
            type="number"
            placeholder="Chat ID (örn: 1234567890)"
            class="px-3 py-2 rounded-xl bg-surface text-text-primary border border-border text-sm focus:outline-none focus:border-primary no-spinner"
          />

          <button
            @click="saveTelegram"
            :disabled="!chatId || telegramLoadingButton"
            class="px-4 py-2 rounded-xl bg-indigo-700 text-white text-sm font-medium transition active:scale-95 disabled:opacity-40"
          >
            {{ telegramLoadingButton ? "Kaydediliyor..." : "Kaydet" }}
          </button>
        </div>

        <!-- Telegram bağlıysa -->
        <div v-else class="px-4 pb-4 flex items-center justify-between">
          <span class="text-xs text-green-500 font-medium">
            ✓ Telegram bağlı
          </span>

          <button
            @click="removeTelegram(user?.id)"
            class="text-xs text-text-muted underline"
          >
            Bağlantıyı kes
          </button>
        </div>
      </div>
     </div>  
     <div v-else class="text-center py-4 text-[var(--color-text-muted)] text-sm">
        Yükleniyor...
     </div>
      

      <!-- About Section -->
      <div class="mb-2 ml-1">
        <span
          class="text-xs font-black tracking-widest uppercase text-text-muted"
          >Hakkında</span
        >
      </div>
      <div class="bg-card rounded-2xl border border-border overflow-hidden">
        <div class="flex items-center justify-between px-4 py-4">
          <div class="flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-lg bg-primary-bg flex items-center justify-center"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-primary-light"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </div>
            <span class="font-medium text-text-primary">Versiyon</span>
          </div>
          <span class="text-sm text-text-muted">1.0.0</span>
        </div>
      </div>
    </main>
    <!-- Telegram Help Modal -->
    <Transition name="telegram-modal">
      <div
        v-if="showTelegramHelp"
        class="fixed inset-0 z-[100] flex items-center justify-center p-4"
      >
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
          @click="closeTelegramHelp"
        ></div>

        <!-- Modal -->
        <div
          class="relative z-10 w-full max-w-lg max-h-[95vh] overflow-hidden rounded-3xl bg-[var(--color-card)] border border-[var(--color-border)] shadow-2xl"
        >
          <!-- Header -->
          <div
            class="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]"
          >
            <div>
              <p
                class="text-[10px] font-black tracking-[0.18em] uppercase text-[var(--color-text-muted)]"
              >
                Telegram Bildirimi
              </p>

              <h2
                class="mt-1 text-lg font-bold text-[var(--color-text-primary)]"
              >
                Bildirimleri nasıl bağlarım?
              </h2>
            </div>

            <button
              @click="closeTelegramHelp"
              class="w-9 h-9 rounded-full flex items-center justify-center text-[var(--color-text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 active:scale-90 transition-all"
              aria-label="Kapat"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Progress -->
          <div class="px-5 pt-4">
            <div class="flex items-center gap-2">
              <div
                v-for="(step, index) in telegramSteps"
                :key="index"
                class="flex-1 h-1.5 rounded-full overflow-hidden bg-[var(--color-border)]"
              >
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="
                    index <= currentTelegramStep ? 'bg-[#4F46E5] w-full' : 'w-0'
                  "
                ></div>
              </div>
            </div>

            <div class="flex items-center justify-between mt-2">
              <span
                class="text-xs font-medium text-[var(--color-text-secondary)]"
              >
                Adım {{ currentTelegramStep + 1 }} / {{ telegramSteps.length }}
              </span>

              <span class="text-xs font-medium text-[#4F46E5]">
                {{ telegramSteps[currentTelegramStep].title }}
              </span>
            </div>
          </div>

          <!-- Content -->
          <div class="px-5 pt-4 pb-5 overflow-y-auto max-h-[65vh]">
            <div
              class="rounded-2xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)] h-[360px] flex items-center justify-center"
            >
              <Transition name="step-image" mode="out-in">
                <img
                  :key="currentTelegramStep"
                  :src="telegramSteps[currentTelegramStep].image"
                  :alt="telegramSteps[currentTelegramStep].title"
                  class="w-full h-full object-contain block"
                />
              </Transition>
            </div>

            <!-- Step info -->
            <div class="mt-4">
              <div class="flex items-start gap-3">
                <div
                  class="shrink-0 w-9 h-9 rounded-xl bg-[#4F46E5] text-white flex items-center justify-center text-sm font-bold"
                >
                  {{ currentTelegramStep + 1 }}
                </div>

                <div>
                  <h3
                    class="text-base font-bold text-[var(--color-text-primary)]"
                  >
                    {{ telegramSteps[currentTelegramStep].title }}
                  </h3>

                  <p
                    class="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]"
                  >
                    {{ telegramSteps[currentTelegramStep].description }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Dots -->
            <div class="flex justify-center gap-2 mt-5">
              <button
                v-for="(step, index) in telegramSteps"
                :key="index"
                @click="currentTelegramStep = index"
                class="transition-all duration-300 rounded-full"
                :class="
                  index === currentTelegramStep
                    ? 'w-6 h-2 bg-[#4F46E5]'
                    : 'w-2 h-2 bg-[var(--color-border)]'
                "
                :aria-label="`Adım ${index + 1}`"
              ></button>
            </div>
          </div>

          <!-- Footer -->
          <div
            class="px-5 py-4 border-t border-[var(--color-border)] flex items-center justify-between gap-3"
          >
            <button
              @click="previousTelegramStep"
              :disabled="currentTelegramStep === 0"
              class="flex-1 h-11 rounded-xl border border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-primary)] transition-all active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none hover:bg-black/5 dark:hover:bg-white/5"
            >
              Geri
            </button>

            <button
              v-if="currentTelegramStep < telegramSteps.length - 1"
              @click="nextTelegramStep"
              class="flex-1 h-11 rounded-xl bg-[#4F46E5] text-white text-sm font-semibold shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98] hover:bg-[#4338CA]"
            >
              Sonraki
            </button>

            <button
              v-else
              @click="closeTelegramHelp"
              class="flex-1 h-11 rounded-xl bg-[#4F46E5] text-white text-sm font-semibold shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98] hover:bg-[#4338CA]"
            >
              Tamam
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
<style>
.telegram-modal-enter-active,
.telegram-modal-leave-active {
  transition: opacity 0.25s ease;
}

.telegram-modal-enter-active > div:last-child,
.telegram-modal-leave-active > div:last-child {
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

.telegram-modal-enter-from,
.telegram-modal-leave-to {
  opacity: 0;
}

.telegram-modal-enter-from > div:last-child,
.telegram-modal-leave-to > div:last-child {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}

.step-image-enter-active,
.step-image-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.step-image-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.step-image-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
</style>
