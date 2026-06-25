<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from '@/composables/message';

const router = useRouter();
const BASE_URL = "https://multi-stopwatch-backend.onrender.com";

const users = ref([]);
const loading = ref(false);
const createLoading = ref(false);

// Yeni kullanıcı formu
const newUsername = ref('');
const newPin = ref('');
const newRole = ref('worker');

function getToken() {
  return localStorage.getItem('accessToken');
}

function authHeader() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
}

// Kullanıcıları listele
async function fetchUsers() {
  loading.value = true;
  try {
    const response = await fetch(`${BASE_URL}/users`, {
      headers: authHeader(),
    });
    const data = await response.json();
    if (response.ok) {
      users.value = data.users;
    }
  } catch {
    message.warning('Kullanıcılar yüklenemedi');
  }
  loading.value = false;
}

// Kullanıcı oluştur
async function createUser() {
  if (!newUsername.value || !newPin.value) return;
  createLoading.value = true;

  try {
    const response = await fetch(`${BASE_URL}/users/create`, {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({
        username: newUsername.value,
        pin: newPin.value,
        role: newRole.value,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      message.success(`${newUsername.value} oluşturuldu`);
      newUsername.value = '';
      newPin.value = '';
      newRole.value = 'worker';
      await fetchUsers();
    } else {
      message.warning(data.error || 'Kullanıcı oluşturulamadı');
    }
  } catch {
    message.warning('Sunucuya bağlanılamadı');
  }

  createLoading.value = false;
}

// Kullanıcı sil
async function deleteUser(userId, username) {
  try {
    const response = await fetch(`${BASE_URL}/users/${userId}`, {
      method: 'DELETE',
      headers: authHeader(),
    });

    if (response.ok) {
      message.success(`${username} silindi`);
      await fetchUsers();
    } else {
      message.warning('Kullanıcı silinemedi');
    }
  } catch {
    message.warning('Sunucuya bağlanılamadı');
  }
}

onMounted(() => fetchUsers());
</script>

<template>
  <div class="min-h-screen bg-[var(--color-surface)]">
    
    <!-- Navbar -->
    <nav class="h-14 bg-[var(--color-card)] border-b border-[var(--color-border)] px-4 flex items-center justify-between sticky top-0 z-30">
      <button
        @click="router.back()"
        class="w-9 h-9 flex items-center justify-center text-[var(--color-primary-light)] active:scale-90 transition-transform"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
      </button>
      <h1 class="text-lg font-black text-[var(--color-primary-light)]">Yönetici Paneli</h1>
      <div class="w-9"></div>
    </nav>

    <main class="max-w-md mx-auto px-4 pt-6 pb-12 flex flex-col gap-6">

      <!-- Kullanıcı Oluştur -->
      <div class="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col gap-4">
        <h2 class="text-sm font-black tracking-widest uppercase text-[var(--color-text-muted)]">Yeni Kullanıcı</h2>

        <input
          v-model="newUsername"
          type="text"
          placeholder="Kullanıcı adı"
          class="px-4 py-3 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-primary)] transition text-sm"
        />

        <input
          v-model="newPin"
          type="password"
          placeholder="PIN"
          class="px-4 py-3 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-[var(--color-text-primary)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-primary)] transition text-sm"
        />

        <!-- Rol seçimi — sadece superadmin manager da oluşturabilir -->
        <div class="flex gap-2">
          <button
            @click="newRole = 'worker'"
            :class="[
              'flex-1 py-2 rounded-xl text-sm font-bold transition border',
              newRole === 'worker'
                ? 'bg-indigo-700 text-white border-indigo-700'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
            ]"
          >
            Worker
          </button>
          <button
            @click="newRole = 'manager'"
            :class="[
              'flex-1 py-2 rounded-xl text-sm font-bold transition border',
              newRole === 'manager'
                ? 'bg-indigo-700 text-white border-indigo-700'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
            ]"
          >
            Manager
          </button>
        </div>

        <button
          @click="createUser"
          :disabled="!newUsername || !newPin || createLoading"
          class="w-full py-3 rounded-2xl bg-indigo-700 text-white font-bold transition active:scale-95 disabled:opacity-40"
        >
          {{ createLoading ? 'Oluşturuluyor...' : 'Oluştur' }}
        </button>
      </div>

      <!-- Kullanıcı Listesi -->
      <div class="bg-[var(--color-card)] rounded-2xl border border-[var(--color-border)] p-5 flex flex-col gap-3">
        <h2 class="text-sm font-black tracking-widest uppercase text-[var(--color-text-muted)]">Kullanıcılar</h2>

        <div v-if="loading" class="text-center py-4 text-[var(--color-text-muted)] text-sm">
          Yükleniyor...
        </div>

        <div v-else-if="users.length === 0" class="text-center py-4 text-[var(--color-text-muted)] text-sm">
          Henüz kullanıcı yok
        </div>

        <div
          v-else
          v-for="user in users"
          :key="user.id"
          class="flex items-center justify-between py-3 border-b border-[var(--color-border)] last:border-0"
        >
          <div class="flex flex-col gap-0.5">
            <span class="font-medium text-[var(--color-text-primary)] text-sm">{{ user.username }}</span>
            <span class="text-xs text-[var(--color-text-muted)]">{{ user.role }}</span>
          </div>
          <button
            @click="deleteUser(user.id, user.username)"
            class="w-8 h-8 flex items-center justify-center text-red-500 hover:text-red-700 transition"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

    </main>
  </div>
</template>