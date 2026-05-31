<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useThemeStore } from "@/stores/themeStore";
import { useStopwatchStore } from "../stores/stopwatchStore";
import { useRouter } from "vue-router";

const themeStore = useThemeStore();
const router = useRouter();
const stopwatchStore = useStopwatchStore();
const presetTime = ref("");
const presetName = ref("");

function addPresetTime() {
  stopwatchStore.presetTimes.push(presetTime.value);
  localStorage.setItem(
    "presetTimes",
    JSON.stringify(stopwatchStore.presetTimes),
  );
  presetTime.value = "";
}

function addPresetName() {
  stopwatchStore.presetNames.push(presetName.value);
  localStorage.setItem("presetNames", JSON.stringify(stopwatchStore.presetNames));
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
}

function removePresetName(bIndex) {
  stopwatchStore.presetNames = stopwatchStore.presetNames.filter(
    (a,aIndex) => aIndex !== bIndex,
  );
  localStorage.setItem(
    "presetNames",
    JSON.stringify(stopwatchStore.presetNames),
  );
}

</script>

<template>
  <div class="min-h-screen bg-surface">
    <!-- Navbar -->
    <nav
      class="h-14 bg-card border-b border-border px-4 flex items-center justify-between sticky top-0 z-30"
    >
      <button
        @click="router.back()"
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
      <h1 class="text-lg font-black text-primary-light">Settings</h1>
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
            <span class="font-medium text-text-primary">Dark Mode</span>
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
        <div
          class="flex gap-3 overflow-x-auto whitespace-nowrap custom-scroll"
        >
          <span
            v-for="(presetTime, index) in stopwatchStore.presetTimes"
            :key="index"
            class="w-20% mt-3 px-2 py-2 flex items-center justify-center rounded-2xl border border-[#4F46E5] shadow-sm text-sm font-medium hover:bg-[#4F46E5]/10 transition"
          >
            {{ presetTime }}
            <button
              @click="removePresetTime(index)"
              class="w-5 ml-3 text-xl leading-none -translate-y-0.5"
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
        <div
          class="flex gap-3 overflow-x-auto whitespace-nowrap custom-scroll"
        >
          <span
            v-for="(presetName, index) in stopwatchStore.presetNames"
            :key="index"
            class="w-20% mt-3 px-2 py-2 flex items-center justify-center rounded-2xl border border-[#4F46E5] shadow-sm text-sm font-medium hover:bg-[#4F46E5]/10 transition"
          >
            {{ presetName }}
            <button
              @click="removePresetName(index)"
              class="w-5 ml-3 text-xl leading-none -translate-y-0.5"
            >
              &times
            </button>
          </span>
        </div>
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
            <span class="font-medium text-text-primary">Version</span>
          </div>
          <span class="text-sm text-text-muted">1.0.0</span>
        </div>
      </div>
    </main>
  </div>
</template>
<style>

</style>
