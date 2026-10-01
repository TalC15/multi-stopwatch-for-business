<script setup>
import SoundSettings from "../components/SoundSettings.vue";
import NotificationSettings from "../components/NotificationSettings.vue";
import { ref, onMounted, onUnmounted } from "vue";
import { useThemeStore } from "@/stores/themeStore";
import { useStopwatchStore } from "../stores/stopwatchStore";
import { useRouter } from "vue-router";
import { message } from "../composables/message";
import {
  saveTelegramChatId,
  telegramControl,
  getUser,
  cancelTelegramChatId,
} from "@/services/backendSync";
import telegramStep1 from "@/assets/telegram/telegram-step-1.png";
import telegramStep2 from "@/assets/telegram/telegram-step-2.png";
import telegramStep3 from "@/assets/telegram/telegram-step-3.png";
import telegramStep4 from "@/assets/telegram/telegram-step-4.png";
import telegramStep5 from "@/assets/telegram/telegram-step-5.png";

const store = useStopwatchStore();
const themeStore = useThemeStore();
const router = useRouter();
const user = getUser();
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

const telegramSavedControl = message.withLoading("Telegram bağlantısı kontrol ediliyor...", async () => {
  telegramLoadingDiv.value = true;
  const res = await telegramControl(user?.id);
  telegramLoadingDiv.value = false;
  telegramSaved.value = res.connected;
});

onMounted(() => {
  telegramSteps.forEach((step) => {
    const img = new Image();
    img.src = step.image;
  });
  telegramSavedControl();
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

const saveTelegram = message.withLoading("Telegram bağlanıyor...", async () => {
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
});

const removeTelegram = message.withLoading("Telegram bağlantısı kesiliyor...", async (user_id) => {
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
});

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
  if (!presetTime.value || String(presetTime.value).trim() === "")
    return message.warning("bir süre belirtmediniz");
  if (presetTime.value > 1440)
    return message.warning("çok uzun süre(en fazla 1440)");
  if (presetTime.value < 0) return message.warning("süre negatif olamaz");
  if (!/^\d+$/.test(presetTime.value)) return message.warning("geçersiz süre");
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
  if (!presetName.value || presetName.value.trim() === "")
    return message.warning("bir isim koymadınız");
  if (presetName.value.length > 35) return message.warning("çok uzun isim");
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
  <div
    class="min-h-screen bg-[var(--color-surface)] text-[var(--color-text-primary)]"
  >
    <!-- Navbar -->
    <nav
      class="sticky top-0 z-30 grid h-16 w-full grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 backdrop-blur-xl sm:px-6"
    >
      <button
        type="button"
        aria-label="Ana sayfaya dön"
        @click="router.push('/')"
        class="grid size-10 shrink-0 justify-self-start place-items-center rounded-2xl border border-[var(--color-border)] text-[var(--color-text-primary)] transition hover:bg-[var(--color-surface)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      >
        <svg
          class="size-5"
          aria-hidden="true"
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
      <div class="min-w-0 text-center">
        <p
          class="text-[10px] font-black tracking-[0.26em] text-indigo-500 uppercase"
        >
          KeepTimer
        </p>

        <h1 class="text-sm font-extrabold tracking-tight sm:text-base">
          Ayarlar
        </h1>
      </div>
      <div class="size-10" aria-hidden="true"></div>
    </nav>

    <!-- Content -->
    <main class="mx-auto max-w-md px-4 pt-6 pb-12 sm:px-6">
      <NotificationSettings />
      <!-- Section -->
      <div class="mb-3 ml-1">
        <span class="text-base font-black tracking-tight">Özelleştirme</span>
      </div>
      <div
        class="mb-5 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm"
      >
        <div class="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div class="flex items-center gap-3">
            <div
              class="grid size-10 shrink-0 place-items-center rounded-2xl bg-indigo-500/10"
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
                class="text-indigo-500"
              >
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            </div>
            <span class="text-sm font-bold text-[var(--color-text-primary)]"
              >Koyu tema</span
            >
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Koyu tema"
            :aria-checked="themeStore.isDark"
            @click="themeStore.toggleTheme()"
            :class="[
              'relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
              themeStore.isDark
                ? 'bg-indigo-600'
                : 'bg-slate-300 dark:bg-slate-600',
            ]"
          >
            <div
              :class="[
                'absolute top-1 left-1 size-6 rounded-full bg-white shadow-sm transition-transform duration-200',
                themeStore.isDark ? 'translate-x-6' : 'translate-x-0',
              ]"
            ></div>
          </button>
        </div>
      </div>

      <!-- Zaman etiketleri -->
      <div class="mb-3 flex flex-wrap items-start justify-between gap-2 px-1">
        <span class="text-sm font-bold">Zaman etiketleri</span>
        <div
          class="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-indigo-500/5 px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]"
          role="status"
        >
          <span>Varsayılan:</span>
          <span
            class="font-semibold tabular-nums text-indigo-600 dark:text-indigo-300"
          >
            {{
              stopwatchStore.duration != null && stopwatchStore.duration !== ""
                ? `${stopwatchStore.duration} dk`
                : "Belirlenmemiş"
            }}
          </span>
        </div>
      </div>
      <div class="relative flex w-full items-center gap-2">
        <svg
          class="pointer-events-none absolute top-1/2 left-4 z-10 -translate-y-1/2 text-indigo-500"
          width="23"
          height="23"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M8 9H6.2C5.0799 9 4.51984 9 4.09202 9.218C3.71569 9.40973 3.40973 9.71569 3.21799 10.092C3 10.5198 3 11.0799 3 12.2V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.07989 21 6.2 21H17.787C18.9071 21 19.4671 21 19.895 20.782C20.2713 20.5903 20.5772 20.2843 20.769 19.908C20.987 19.4802 20.987 18.9201 20.987 17.8V12M6 15H6.01M10 15H10.01M11.5189 12.8945L12.8337 12.6347C13.5432 12.4945 13.8979 12.4244 14.2287 12.2953C14.5223 12.1807 14.8013 12.0318 15.06 11.8516C15.3514 11.6487 15.607 11.393 16.1184 10.8816L21.2668 5.73321C21.9541 5.04596 21.9541 3.9317 21.2668 3.24444C20.5796 2.55719 19.4653 2.55719 18.7781 3.24445L13.5416 8.48088C13.0625 8.96004 12.8229 9.19963 12.6294 9.47121C12.4576 9.71232 12.3131 9.97174 12.1986 10.2447C12.0696 10.5522 11.9921 10.8821 11.837 11.5417L11.5189 12.8945Z"
            stroke="currentColor"
            stroke-width="1.776"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

        <input
          v-model="presetTime"
          type="number"
          placeholder="Zaman etiketi oluşturun"
          aria-label="Zaman etiketi (dakika)"
          class="no-spinner h-12 min-w-0 flex-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] pr-4 pl-12 text-sm text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
        />
        <button
          class="grid size-12 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-2xl leading-none text-white transition hover:bg-indigo-700 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          type="button"
          aria-label="Zaman etiketi ekle"
          @click="addPresetTime"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      <div class="relative isolate mt-3 mb-5">
        <div
          class="custom-scroll flex gap-2 overflow-x-auto pb-2 whitespace-nowrap"
        >
          <span
            v-for="(presetTime, index) in stopwatchStore.presetTimes"
            :key="index"
            class="inline-flex shrink-0 items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-sm font-semibold transition hover:border-indigo-500/30 hover:bg-indigo-500/5"
            :class="
              presetTime === stopwatchStore.duration
                ? 'border-indigo-500/30! bg-indigo-500/10! text-indigo-600 dark:text-indigo-300'
                : ''
            "
          >
            <span
              @click="defaultSettings(presetTime)"
              class="cursor-pointer px-3 py-2.5"
            >
              {{ presetTime }}
            </span>
            <button
              type="button"
              :aria-label="`${presetTime} dakikalık etiketi sil`"
              @click="removePresetTime(index)"
              class="mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-xl leading-none text-[var(--color-text-muted)] transition hover:bg-rose-500/10 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:text-rose-400"
            >
              &times;
            </button>
          </span>
        </div>
      </div>

      <!-- İsim etiketleri -->
      <div class="mb-3 flex flex-wrap items-start justify-between gap-2 px-1">
        <span class="text-sm font-bold">İsim etiketleri</span>
        <div
          class="inline-flex min-w-0 max-w-full items-baseline gap-1.5 rounded-lg bg-indigo-500/5 px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]"
          role="status"
        >
          <span class="shrink-0">Varsayılan:</span>
          <span
            class="min-w-0 font-semibold text-indigo-600 [overflow-wrap:anywhere] dark:text-indigo-300"
          >
            {{ stopwatchStore.name || "Belirlenmemiş" }}
          </span>
        </div>
      </div>
      <div class="relative flex w-full items-center gap-2">
        <svg
          class="pointer-events-none absolute top-1/2 left-4 z-10 -translate-y-1/2 text-indigo-500"
          width="23"
          height="23"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M8 9H6.2C5.0799 9 4.51984 9 4.09202 9.218C3.71569 9.40973 3.40973 9.71569 3.21799 10.092C3 10.5198 3 11.0799 3 12.2V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.07989 21 6.2 21H17.787C18.9071 21 19.4671 21 19.895 20.782C20.2713 20.5903 20.5772 20.2843 20.769 19.908C20.987 19.4802 20.987 18.9201 20.987 17.8V12M6 15H6.01M10 15H10.01M11.5189 12.8945L12.8337 12.6347C13.5432 12.4945 13.8979 12.4244 14.2287 12.2953C14.5223 12.1807 14.8013 12.0318 15.06 11.8516C15.3514 11.6487 15.607 11.393 16.1184 10.8816L21.2668 5.73321C21.9541 5.04596 21.9541 3.9317 21.2668 3.24444C20.5796 2.55719 19.4653 2.55719 18.7781 3.24445L13.5416 8.48088C13.0625 8.96004 12.8229 9.19963 12.6294 9.47121C12.4576 9.71232 12.3131 9.97174 12.1986 10.2447C12.0696 10.5522 11.9921 10.8821 11.837 11.5417L11.5189 12.8945Z"
            stroke="currentColor"
            stroke-width="1.776"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

        <input
          v-model="presetName"
          type="text"
          placeholder="İsim etiketi oluşturun"
          aria-label="İsim etiketi"
          maxlength="35"
          class="no-spinner h-12 min-w-0 flex-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] pr-4 pl-12 text-sm text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
        />
        <button
          class="grid size-12 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-2xl leading-none text-white transition hover:bg-indigo-700 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          type="button"
          aria-label="İsim etiketi ekle"
          @click="addPresetName"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      <div class="relative isolate mt-3 mb-5">
        <div
          class="custom-scroll flex gap-2 overflow-x-auto pb-2 whitespace-nowrap"
        >
          <div
            v-for="(presetName, index) in stopwatchStore.presetNames"
            :key="index"
            class="relative shrink-0"
          >
            <span
              class="inline-flex items-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-sm font-semibold transition hover:border-indigo-500/30 hover:bg-indigo-500/5"
              :class="
                presetName === stopwatchStore.name
                  ? 'border-indigo-500/30! bg-indigo-500/10! text-indigo-600 dark:text-indigo-300'
                  : ''
              "
            >
              <span
                @click="defaultSettings(presetName)"
                class="cursor-pointer px-3 py-2.5"
              >
                {{ presetName }}
              </span>

              <button
                type="button"
                :aria-label="`${presetName} isim etiketini sil`"
                @click.stop="removePresetName(index)"
                class="mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-xl leading-none text-[var(--color-text-muted)] transition hover:bg-rose-500/10 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:text-rose-400"
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
          class="mb-5 overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm"
        >
          <!-- Header -->
          <div
            class="flex items-center justify-between gap-3 px-5 py-4 sm:px-6"
          >
            <!-- Sol taraf -->
            <div class="flex items-center gap-3 min-w-0">
              <div
                class="grid size-10 shrink-0 place-items-center rounded-2xl bg-indigo-500/10"
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
                  class="text-indigo-500"
                >
                  <path d="M22 2L11 13" />
                  <path d="M22 2L15 22 11 13 2 9l20-7z" />
                </svg>
              </div>

              <span class="text-sm font-bold text-[var(--color-text-primary)]">
                Telegram Bildirimi
              </span>
            </div>

            <!-- Bilgi butonu -->
            <button
              type="button"
              @click="openTelegramHelp"
              class="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--color-border)] text-indigo-500 transition hover:bg-indigo-500/10 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
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
          <div
            v-if="!telegramSaved"
            class="flex flex-col gap-3 px-5 pb-5 sm:px-6"
          >
            <p
              class="text-xs leading-relaxed text-[var(--color-text-secondary)]"
            >
              @KeepTimeApp_bot'a <strong>/start</strong> yaz, sonra chat ID'ni
              gir.
            </p>

            <input
              v-model="chatId"
              type="number"
              placeholder="Chat ID (örn: 1234567890)"
              class="no-spinner min-w-0 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            />

            <button
              @click="saveTelegram"
              :disabled="!chatId || telegramLoadingButton"
              class="rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              {{ telegramLoadingButton ? "Kaydediliyor..." : "Kaydet" }}
            </button>
          </div>

          <!-- Telegram bağlıysa -->
          <div
            v-else
            class="flex items-center justify-between gap-3 px-5 pb-5 sm:px-6"
          >
            <span
              class="text-xs font-semibold text-emerald-600 dark:text-emerald-400"
            >
              ✓ Telegram bağlı
            </span>

            <button
              @click="removeTelegram(user?.id)"
              class="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] underline underline-offset-4 transition hover:bg-[var(--color-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              Bağlantıyı kes
            </button>
          </div>
        </div>
      </div>
      <div
        v-else
        class="mb-5 rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] py-5 text-center text-sm text-[var(--color-text-secondary)]"
      >
        Yükleniyor...
      </div>

      <SoundSettings />

      <!-- About Section -->
      <div class="mb-3 ml-1">
        <span class="text-base font-black tracking-tight">Hakkında</span>
      </div>
      <div
        class="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm"
      >
        <div class="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div class="flex items-center gap-3">
            <div
              class="grid size-10 shrink-0 place-items-center rounded-2xl bg-indigo-500/10"
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
                class="text-indigo-500"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </div>
            <span class="text-sm font-bold text-[var(--color-text-primary)]"
              >Versiyon</span
            >
          </div>
          <span
            class="rounded-lg bg-[var(--color-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)] tabular-nums"
            >1.0.0</span
          >
        </div>
        <!-- Uygulama hakkında: açıklama metnini bu div içine ekleyebilirsin. -->
        <div
          id="app-about-content"
          class="mx-5 mb-5 min-h-28 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm leading-relaxed text-[var(--color-text-secondary)] [overflow-wrap:anywhere] sm:mx-6 [&_p+p]:mt-3"
        >
          <!-- Uygulama hakkında yazını buraya ekle. -->
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
              class="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface)] active:scale-95 focus-visible:outline-2 focus-visible:outline-indigo-500"
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
                    index <= currentTelegramStep
                      ? 'bg-indigo-600 w-full'
                      : 'w-0'
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

              <span
                class="text-xs font-medium text-indigo-600 dark:text-indigo-300"
              >
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
                  class="shrink-0 w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-sm font-bold"
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
                    ? 'w-6 h-2 bg-indigo-600'
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
              class="flex-1 h-11 rounded-xl border border-[var(--color-border)] text-sm font-semibold text-[var(--color-text-primary)] transition-all active:scale-[0.98] disabled:opacity-30 disabled:pointer-events-none hover:bg-[var(--color-surface)]"
            >
              Geri
            </button>

            <button
              v-if="currentTelegramStep < telegramSteps.length - 1"
              @click="nextTelegramStep"
              class="flex-1 h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-sm transition-all active:scale-[0.98] hover:bg-indigo-700"
            >
              Sonraki
            </button>

            <button
              v-else
              @click="closeTelegramHelp"
              class="flex-1 h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-sm transition-all active:scale-[0.98] hover:bg-indigo-700"
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
