<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/composables/message";
import { disconnectSocket, connectSocket } from "@/services/socket";
import {
  apiFetch,
  getAccessToken,
  saveTelegramChatId,
  getUser,
  cancelTelegramChatId,
  telegramControl,
} from "@/services/backendSync";
import { useStopwatchStore } from "../stores/stopwatchStore";

import { captureWorkspaceSession } from "../services/workspaceSession.js";

const store = useStopwatchStore();
const user = getUser();
const router = useRouter();
const BASE_URL = "https://multi-stopwatch-backend.onrender.com";
const workspace = ref(null);
const loading = ref(false);
const joinLoading = ref(false);
const leaveLoading = ref(false);
const inviteCode = ref("");
const chatId = ref("");
const telegramSaved = ref(null);
const telegramLoadingButton = ref(false);
const telegramLoadingDiv = ref(false);

function authHeader() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAccessToken()}`,
  };
}

const fetchWorkspace = message.withLoading("Çalışma grubu yükleniyor...", async () => {
  loading.value = true;
  const response = await apiFetch(`${BASE_URL}/workspace`, {
    headers: authHeader(),
  });
  if (response) {
    const data = await response.json();
    workspace.value = data.workspace;
  }
  loading.value = false;
});

const joinWorkspace = message.withLoading("Çalışma grubuna katılınıyor...", async () => {
  if (!inviteCode.value || joinLoading.value) return;
  const session = captureWorkspaceSession();
  joinLoading.value = true;
  try {
    const response = await apiFetch(`${BASE_URL}/workspace/join`, {
      method: "POST", headers: authHeader(), isRequestCurrent: session.isCurrent,
      body: JSON.stringify({ inviteCode: inviteCode.value }),
    });
    if (!response) return;
    const data = await response.json();
    if (!session.isCurrent()) return;
    if (response.ok) {
      if (!session.saveWorkspace(data.workspace?.id)) return;
      message.success(`${data.workspace.name} çalışma gurubuna katıldınız`);
      inviteCode.value = "";
      workspace.value = data.workspace;
      disconnectSocket(); connectSocket();
    } else message.warning(data.error || "Geçersiz davet kodu");
  } catch {
    if (session.isCurrent()) message.error("Çalışma grubuna katılınamadı");
  } finally { joinLoading.value = false; }
});

const leaveWorkspace = message.withLoading("Çalışma grubundan ayrılınıyor...", async () => {
  if (leaveLoading.value) return;
  const session = captureWorkspaceSession();
  leaveLoading.value = true;
  try {
    const response = await apiFetch(`${BASE_URL}/workspace/leave`, {
      method: "POST", headers: authHeader(), isRequestCurrent: session.isCurrent,
    });
    if (!response) return;
    const data = await response.json();
    if (!session.isCurrent()) return;
    if (response.ok) {
      if (!session.saveWorkspace(null)) return;
      message.success("Çalışma gurubundan ayrıldınız");
      workspace.value = null;
      disconnectSocket(); connectSocket();
    } else message.error(data.error || "Ayrılma başarısız");
  } catch {
    if (session.isCurrent()) message.error("Çalışma grubundan ayrılınamadı");
  } finally { leaveLoading.value = false; }
});

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

const telegramSavedControl = message.withLoading("Telegram bağlantısı kontrol ediliyor...", async () => {
  telegramLoadingDiv.value = true;
  const res = await telegramControl(user?.id);
  telegramLoadingDiv.value = false;
  telegramSaved.value = res.connected;
});

onMounted(() => {
  fetchWorkspace();
  telegramSavedControl();
});
</script>

<template>
  <div class="min-h-screen bg-[var(--color-surface)] text-[var(--color-text-primary)]">
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
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>
      <div class="flex min-w-0 flex-col items-center">
        <h1 class="text-sm font-extrabold tracking-tight sm:text-base">
          Profilim
        </h1>
        <span v-if="user" class="max-w-full truncate text-[11px] text-[var(--color-text-secondary)]">{{
          user?.username
        }}</span>
      </div>
      <div class="size-10" aria-hidden="true"></div>
    </nav>

    <main class="mx-auto flex max-w-md flex-col gap-5 px-4 pt-6 pb-12 sm:px-6">
      <!--Profil Bilgileri-->
      <div
        class="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6"
      >
        <h2
          class="mb-5 text-base font-black tracking-tight"
        >
          Profil bilgilerim
        </h2>

        <div class="flex items-center gap-4">
          <!-- Yetki rengi ve baş harf: ekip paneliyle aynı -->
          <div
            class="grid size-16 shrink-0 place-items-center rounded-2xl text-2xl font-black"
            :class="
                user?.role === 'manager'
                  ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300'
                  : user?.role === 'superadmin'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
                    : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
            "
            aria-hidden="true"
          >
            {{ user?.username?.charAt(0)?.toLocaleUpperCase("tr-TR") || "?" }}
          </div>

          <!-- Kullanıcı bilgileri -->
          <div class="flex min-w-0 flex-1 flex-col">
            <span
              class="truncate text-lg font-extrabold tracking-tight text-[var(--color-text-primary)]"
            >
              {{ user?.username || "Kullanıcı" }}
            </span>

            <span
              :class="[
                store.roleStyles[user?.role].text,
                'mt-0.5 text-[11px] font-semibold capitalize',
              ]"
            >
              {{ user?.role || "Rol belirtilmemiş" }}
            </span>
          </div>
        </div>

        <div
          class="mt-5 flex flex-col gap-3 border-t border-[var(--color-border)] pt-4"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs leading-relaxed text-[var(--color-text-secondary)]">
              Durum
            </span>

            <span
              class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
            >
              <span class="size-1.5 rounded-full bg-emerald-500"></span>
              Aktif
            </span>
          </div>
        </div>
      </div>
      <!-- Workspace Durumu -->
      <div
        class="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6 flex flex-col gap-4"
      >
        <h2
          class="text-base font-black tracking-tight"
        >
          Çalışma grubum
        </h2>

        <div
          v-if="loading"
          class="rounded-2xl bg-[var(--color-surface)] py-5 text-center text-sm text-[var(--color-text-secondary)]"
        >
          Yükleniyor...
        </div>

        <!-- Workspace var -->
        <div v-else-if="workspace" class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <div class="flex min-w-0 flex-col gap-0.5">
              <span class="truncate text-sm font-extrabold text-[var(--color-text-primary)]">{{
                workspace.name
              }}</span>
              <span class="text-xs font-medium text-emerald-600 dark:text-emerald-400">Aktif</span>
            </div>
          </div>
          <button
            @click="leaveWorkspace"
            :disabled="leaveLoading"
            class="w-full rounded-2xl border border-rose-300 px-4 py-3 text-sm font-bold text-rose-600 transition hover:bg-rose-500/5 active:scale-[0.99] disabled:opacity-40 dark:border-rose-800 dark:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
          >
            {{ leaveLoading ? "Ayrılıyor..." : "Gruptan ayrıl" }}
          </button>
        </div>

        <!-- Workspace yok -->
        <div v-else class="flex flex-col gap-3">
          <p class="text-xs leading-relaxed text-[var(--color-text-secondary)]">
            Henüz bir çalışma grubuna dahil değilsiniz. Davet kodu ile
            katılabilirsiniz.
          </p>
          <div class="flex gap-2">
            <input
              v-model="inviteCode"
              type="text"
              placeholder="Davet kodu"
              class="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm text-[var(--color-text-primary)] uppercase outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            />
            <button
              @click="joinWorkspace"
              :disabled="!inviteCode || joinLoading"
              class="shrink-0 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 active:scale-95 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              {{ joinLoading ? "..." : "Katıl" }}
            </button>
          </div>
        </div>
      </div>

      <!-- Telegram bildirimi -->
      <div
        class="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-sm sm:p-6 flex flex-col gap-4"
      >
        <h2
          class="text-base font-black tracking-tight"
        >
          Telegram bildirimi
        </h2>
        <div v-if="!telegramLoadingDiv">
          <div v-if="!telegramSaved" class="flex flex-col gap-3">
            <p class="text-xs leading-relaxed text-[var(--color-text-secondary)]">
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
              class="w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              {{ telegramLoadingButton ? "Kaydediliyor..." : "Kaydet" }}
            </button>
          </div>

          <div v-else class="flex items-center justify-between gap-3">
            <span class="text-sm font-semibold text-emerald-600 dark:text-emerald-400"
              >✓ Telegram bağlı</span
            >
            <button
              @click="removeTelegram(user?.id)"
              class="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] underline underline-offset-4 transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              Bağlantıyı kes
            </button>
          </div>
        </div>
        <div
          v-else
          class="rounded-2xl bg-[var(--color-surface)] py-5 text-center text-sm text-[var(--color-text-secondary)]"
        >
          Yükleniyor...
        </div>
      </div>
    </main>
  </div>
</template>
