<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/composables/message";
import { apiFetch, getAccessToken } from "@/services/backendSync";

const router = useRouter();
const BASE_URL = "https://multi-stopwatch-backend.onrender.com";

const users = ref([]);
const workspace = ref(null);
const loading = ref(false);
const createLoading = ref(false);
const workspaceLoading = ref(false);
const leaveLoading = ref(false);
const refreshLoading = ref(false);

const newUsername = ref("");
const newPin = ref("");
const newWorkspaceName = ref("");
const inviteCode = ref("");

const sharedModeLoading = ref(false);

function authHeader() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAccessToken()}`,
  };
}

async function fetchWorkspace() {
  const response = await apiFetch(`${BASE_URL}/workspace`, {
    headers: authHeader(),
  });
  if (response) {
    const data = await response.json();
    workspace.value = data.workspace;
  }
}

async function fetchUsers() {
  loading.value = true;
  const response = await apiFetch(`${BASE_URL}/users`, {
    headers: authHeader(),
  });
  if (response) {
    const data = await response.json();
    users.value = data.users || [];
  }
  loading.value = false;
}

async function createWorkspace() {
  if (!newWorkspaceName.value) return;
  workspaceLoading.value = true;

  const response = await apiFetch(`${BASE_URL}/workspace/create`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ name: newWorkspaceName.value }),
  });

  if (response) {
    const data = await response.json();
    if (response.ok) {
      message.success("Workspace oluşturuldu");
      newWorkspaceName.value = "";
      workspace.value = data.workspace;
      await fetchUsers();
    } else {
      message.warning(data.error || "Workspace oluşturulamadı");
    }
  }
  workspaceLoading.value = false;
}

async function joinWorkspace() {
  if (!inviteCode.value) return;
  workspaceLoading.value = true;

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
      await fetchUsers();
    } else {
      message.warning(data.error || "Geçersiz davet kodu");
    }
  }
  workspaceLoading.value = false;
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
      users.value = [];
    } else {
      message.warning(data.error);
    }
  }
  leaveLoading.value = false;
}

async function refreshInviteCode() {
  refreshLoading.value = true;

  const response = await apiFetch(`${BASE_URL}/workspace/refresh-invite`, {
    method: "POST",
    headers: authHeader(),
  });

  if (response) {
    const data = await response.json();
    if (response.ok) {
      workspace.value.invite_code = data.invite_code;
      message.success("Davet kodu yenilendi");
    } else {
      message.warning(data.error || "Kod yenilenemedi");
    }
  }
  refreshLoading.value = false;
}

async function createUser() {
  if (!newUsername.value || !newPin.value) return;
  createLoading.value = true;

  const response = await apiFetch(`${BASE_URL}/users/create`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({
      username: newUsername.value,
      pin: newPin.value,
      role: "worker",
    }),
  });

  if (response) {
    const data = await response.json();
    if (response.ok) {
      message.success(`${newUsername.value} oluşturuldu`);
      newUsername.value = "";
      newPin.value = "";
      await fetchUsers();
    } else {
      message.warning(data.error || "Kullanıcı oluşturulamadı");
    }
  }
  createLoading.value = false;
}

async function deleteUser(userId, username) {
  const response = await apiFetch(`${BASE_URL}/users/${userId}`, {
    method: "DELETE",
    headers: authHeader(),
  });

  if (response?.ok) {
    message.success(`${username} silindi`);
    await fetchUsers();
  } else {
    message.warning("Kullanıcı silinemedi");
  }
}

async function toggleSharedMode() {
  sharedModeLoading.value = true;

  const response = await apiFetch(`${BASE_URL}/workspace/toggle-shared`, {
    method: "POST",
    headers: authHeader(),
  });

  if (response) {
    const data = await response.json();
    if (response.ok) {
      workspace.value.shared_mode_enabled = data.shared_mode_enabled;
      message.success(
        data.shared_mode_enabled
          ? "Ortak ekran açıldı"
          : "Ortak ekran kapatıldı",
      );
    } else {
      message.warning("İşlem başarısız");
    }
  }
  sharedModeLoading.value = false;
}

onMounted(async () => {
  await fetchWorkspace();
  await fetchUsers();
});
</script>

<template>
  <div class="min-h-screen bg-[var(--color-surface)]">
    <nav
      class="h-14 bg-[var(--color-card)] border-b border-[var(--color-border)] px-4 flex items-center justify-between sticky top-0 z-30"
    >
      <button
        @click="router.back()"
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
      <h1 class="text-lg font-black text-[var(--color-primary-light)]">
        Yönetici Paneli
      </h1>
      <div class="w-9"></div>
    </nav>

    <main class="max-w-md mx-auto px-4 pt-6 pb-12 flex flex-col gap-6">
      <!-- Workspace -->
      <div
        class="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col gap-4"
      >
        <h2
          class="text-sm font-black tracking-widest uppercase text-[var(--color-text-muted)]"
        >
          Workspace
        </h2>

        <!-- Workspace var -->
        <div v-if="workspace" class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="font-bold text-[var(--color-text-primary)]">{{
              workspace.name
            }}</span>
            <span class="text-xs text-green-500">Aktif</span>
          </div>

          <!-- Davet kodu -->
          <div
            class="flex items-center gap-2 bg-[var(--color-surface)] rounded-xl px-4 py-3"
          >
            <span class="text-xs text-[var(--color-text-muted)]"
              >Davet Kodu:</span
            >
            <span
              class="flex-1 font-black text-[var(--color-primary-light)] tracking-widest"
              >{{ workspace.invite_code }}</span
            >
            <button
              @click="refreshInviteCode"
              :disabled="refreshLoading"
              class="text-xs text-indigo-500 font-medium disabled:opacity-40"
            >
              {{ refreshLoading ? "..." : "Yenile" }}
            </button>
          </div>

          <!-- Ortak Ekran Toggle -->
          <div
            class="flex items-center justify-between bg-[var(--color-surface)] rounded-xl px-4 py-3"
          >
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium text-[var(--color-text-primary)]"
                >Ortak Ekran</span
              >
              <span class="text-xs text-[var(--color-text-muted)]"
                >Çalışanlar birbirinin timer'larını görür</span
              >
            </div>
            <button
              @click="toggleSharedMode"
              :disabled="sharedModeLoading"
              :class="[
                'w-12 h-7 rounded-full relative transition-colors duration-300',
                workspace.shared_mode_enabled
                  ? 'bg-indigo-700'
                  : 'bg-[var(--color-border)]',
              ]"
            >
              <div
                :class="[
                  'absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-300',
                  workspace.shared_mode_enabled
                    ? 'translate-x-5 left-0.5'
                    : 'translate-x-0 left-0.5',
                ]"
              ></div>
            </button>
          </div>

          <!-- Ayrıl -->
          <button
            @click="leaveWorkspace"
            :disabled="leaveLoading"
            class="w-full py-2.5 rounded-2xl border border-red-500 text-red-500 font-bold text-sm transition active:scale-95 disabled:opacity-40"
          >
            {{ leaveLoading ? "Ayrılıyor..." : "Workspace'den Ayrıl" }}
          </button>
        </div>

        <!-- Workspace yok -->
        <div v-else class="flex flex-col gap-3">
          <div class="flex flex-col gap-2">
            <p class="text-xs text-[var(--color-text-secondary)]">
              Yeni workspace oluştur:
            </p>
            <div class="flex gap-2">
              <input
                v-model="newWorkspaceName"
                type="text"
                placeholder="Workspace adı"
                class="flex-1 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] text-sm focus:outline-none"
              />
              <button
                @click="createWorkspace"
                :disabled="!newWorkspaceName || workspaceLoading"
                class="px-4 py-2 rounded-xl bg-indigo-700 text-white text-sm font-bold disabled:opacity-40"
              >
                Oluştur
              </button>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <div class="flex-1 h-px bg-[var(--color-border)]"></div>
            <span class="text-xs text-[var(--color-text-muted)]">veya</span>
            <div class="flex-1 h-px bg-[var(--color-border)]"></div>
          </div>

          <div class="flex flex-col gap-2">
            <p class="text-xs text-[var(--color-text-secondary)]">
              Davet kodu ile katıl:
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
                :disabled="!inviteCode || workspaceLoading"
                class="px-4 py-2 rounded-xl bg-indigo-700 text-white text-sm font-bold disabled:opacity-40"
              >
                Katıl
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Yeni Worker -->
      <div
        v-if="workspace"
        class="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col gap-4"
      >
        <h2
          class="text-sm font-black tracking-widest uppercase text-[var(--color-text-muted)]"
        >
          Yeni Worker
        </h2>
        <input
          v-model="newUsername"
          type="text"
          placeholder="Kullanıcı adı"
          class="px-4 py-3 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] focus:outline-none text-sm"
        />
        <input
          v-model="newPin"
          type="password"
          placeholder="PIN"
          class="px-4 py-3 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] focus:outline-none text-sm"
        />
        <button
          @click="createUser"
          :disabled="!newUsername || !newPin || createLoading"
          class="w-full py-3 rounded-2xl bg-indigo-700 text-white font-bold transition active:scale-95 disabled:opacity-40"
        >
          {{ createLoading ? "Oluşturuluyor..." : "Worker Oluştur" }}
        </button>
      </div>

      <!-- Çalışanlar -->
      <div
        v-if="workspace"
        class="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col gap-3"
      >
        <h2
          class="text-sm font-black tracking-widest uppercase text-[var(--color-text-muted)]"
        >
          Üyeler
        </h2>
        <div
          v-if="loading"
          class="text-center py-4 text-[var(--color-text-muted)] text-sm"
        >
          Yükleniyor...
        </div>
        <div
          v-else-if="users.length === 0"
          class="text-center py-4 text-[var(--color-text-muted)] text-sm"
        >
          Henüz çalışan yok
        </div>
        <div
          v-for="user in users"
          :key="user.id"
          class="flex items-center justify-between py-3 border-b border-[var(--color-border)] last:border-0"
        >
          <div class="flex flex-col gap-0.5">
            <span
              class="font-medium text-[var(--color-text-primary)] text-sm"
              >{{ user.username }}</span
            >
            <span class="text-xs text-[var(--color-text-muted)]">{{
              user.role
            }}</span>
          </div>
          <button
            @click="deleteUser(user.id, user.username)"
            class="w-8 h-8 flex items-center justify-center text-red-500 hover:text-red-700 transition"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </main>
  </div>
</template>
