<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/composables/message";
import {
  apiFetch,
  getAccessToken,
  saveTelegramChatId,
  getUser,
} from "@/services/backendSync";

const user = getUser();
const router = useRouter();
const BASE_URL = "https://multi-stopwatch-backend.onrender.com";

const workspace = ref(null);
const loading = ref(false);
const joinLoading = ref(false);
const leaveLoading = ref(false);
const inviteCode = ref("");
const chatId = ref("");
const telegramSaved = ref(!!localStorage.getItem("telegramChatId"));
const telegramLoading = ref(false);

function authHeader() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAccessToken()}`,
  };
}

async function fetchWorkspace() {
  loading.value = true;
  const response = await apiFetch(`${BASE_URL}/workspace`, {
    headers: authHeader(),
  });
  if (response) {
    const data = await response.json();
    workspace.value = data.workspace;
  }
  loading.value = false;
}

async function joinWorkspace() {
  if (!inviteCode.value) return;
  joinLoading.value = true;

  const response = await apiFetch(`${BASE_URL}/workspace/join`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ inviteCode: inviteCode.value }),
  });

  if (response) {
    const data = await response.json();
    if (response.ok) {
      message.success(`${data.workspace.name} workspace'ine katıldınız`);
      inviteCode.value = "";
      workspace.value = data.workspace;
    } else {
      message.warning(data.error || "Geçersiz davet kodu");
    }
  }
  joinLoading.value = false;
}

async function leaveWorkspace() {
  leaveLoading.value = true;

  const response = await apiFetch(`${BASE_URL}/workspace/leave`, {
    method: "POST",
    headers: authHeader(),
  });

  if (response) {
    const data = await response.json();
    if (response.ok) {
      message.success("Workspace'den ayrıldınız");
      workspace.value = null;
    } else {
      message.warning(data.error || "Ayrılma başarısız");
    }
  }
  leaveLoading.value = false;
}

async function saveTelegram() {
  if (!chatId.value) return;
  telegramLoading.value = true;

  const result = await saveTelegramChatId(chatId.value);

  if (result?.success) {
    localStorage.setItem("telegramChatId", chatId.value);
    telegramSaved.value = true;
    message.success("Telegram bağlandı!");
  } else {
    message.warning("Geçersiz Chat ID. Lütfen tekrar dene.");
  }
  telegramLoading.value = false;
}

function removeTelegram() {
  localStorage.removeItem("telegramChatId");
  telegramSaved.value = false;
  chatId.value = "";
}

onMounted(() => fetchWorkspace());
</script>

<template>
  <div class="min-h-screen bg-[var(--color-surface)]">
    <nav
      class="h-14 bg-[var(--color-card)] border-b border-[var(--color-border)] px-4 flex items-center justify-between sticky top-0 z-30"
    >
      <button
        @click="router.push('/')"
        class="w-9 h-9 flex items-center justify-center text-[var(--color-primary-light)] active:scale-90 transition-transform"
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
      <div class="flex flex-col items-center">
        <h1 class="text-lg font-black text-[var(--color-primary-light)]">
          Profilim
        </h1>
        <span v-if="user" class="text-xs text-[var(--color-text-secondary)]">{{
          user?.role
        }}</span>
      </div>
      <div class="w-9"></div>
    </nav>

    <main class="max-w-md mx-auto px-4 pt-6 pb-12 flex flex-col gap-6">
      <!-- Workspace Durumu -->
      <div
        class="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col gap-4"
      >
        <h2
          class="text-sm font-black tracking-widest uppercase text-[var(--color-text-muted)]"
        >
          Workspace
        </h2>

        <div
          v-if="loading"
          class="text-center py-4 text-[var(--color-text-muted)] text-sm"
        >
          Yükleniyor...
        </div>

        <!-- Workspace var -->
        <div v-else-if="workspace" class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <div class="flex flex-col gap-0.5">
              <span class="font-bold text-[var(--color-text-primary)]">{{
                workspace.name
              }}</span>
              <span class="text-xs text-green-500">Aktif</span>
            </div>
          </div>
          <button
            @click="leaveWorkspace"
            :disabled="leaveLoading"
            class="w-full py-3 rounded-2xl border border-red-500 text-red-500 font-bold text-sm transition active:scale-95 disabled:opacity-40"
          >
            {{ leaveLoading ? "Ayrılıyor..." : "Workspace'den Ayrıl" }}
          </button>
        </div>

        <!-- Workspace yok -->
        <div v-else class="flex flex-col gap-3">
          <p class="text-xs text-[var(--color-text-secondary)]">
            Henüz bir workspace'e dahil değilsiniz. Davet kodu ile
            katılabilirsiniz.
          </p>
          <div class="flex gap-2">
            <input
              v-model="inviteCode"
              type="text"
              placeholder="Davet kodu"
              class="flex-1 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] text-sm focus:outline-none uppercase"
            />
            <button
              @click="joinWorkspace"
              :disabled="!inviteCode || joinLoading"
              class="px-4 py-2 rounded-xl bg-indigo-700 text-white text-sm font-bold disabled:opacity-40"
            >
              {{ joinLoading ? "..." : "Katıl" }}
            </button>
          </div>
        </div>
      </div>

      <!-- Telegram Bildirimi -->
      <div
        class="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col gap-4"
      >
        <h2
          class="text-sm font-black tracking-widest uppercase text-[var(--color-text-muted)]"
        >
          Telegram Bildirimi
        </h2>

        <div v-if="!telegramSaved" class="flex flex-col gap-3">
          <p class="text-xs text-[var(--color-text-secondary)]">
            @KeepTimeApp_bot'a <strong>/start</strong> yaz, sonra chat ID'ni
            gir.
          </p>
          <input
            v-model="chatId"
            type="number"
            placeholder="Chat ID (örn: 8030859580)"
            class="px-4 py-3 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] text-sm focus:outline-none no-spinner"
          />
          <button
            @click="saveTelegram"
            :disabled="!chatId || telegramLoading"
            class="w-full py-3 rounded-2xl bg-indigo-700 text-white font-bold transition active:scale-95 disabled:opacity-40"
          >
            {{ telegramLoading ? "Kaydediliyor..." : "Kaydet" }}
          </button>
        </div>

        <div v-else class="flex items-center justify-between">
          <span class="text-sm text-green-500 font-medium"
            >✓ Telegram bağlı</span
          >
          <button
            @click="removeTelegram"
            class="text-xs text-[var(--color-text-muted)] underline"
          >
            Kaldır
          </button>
        </div>
      </div>
    </main>
  </div>
</template>
