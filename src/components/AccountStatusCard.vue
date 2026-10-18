<script setup>
import { computed } from 'vue';
const props = defineProps({ experience: { type: Object, required: true }, count: { type: Number, default: 0 }, ready: Boolean,
  pendingCount: { type: Number, default: 0 }, syncStatus: { type: String, default: 'idle' }, details: Boolean });
const emit = defineEmits(['retry']);
const data = computed(() => props.experience.currentData?.value ?? props.experience.state.data);
const individual = computed(() => data.value?.account.kind === 'individual');
const status = computed(() => ({ active: 'Aktif', pending: 'Başlaması bekleniyor', expired: 'Süresi doldu', cancelled: 'İptal edilmiş' })[data.value?.subscription.status] || 'Abonelik bulunamadı');
const formatDate = value => value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const syncNotice = computed(() => {
  if (props.syncStatus === 'unsupported-locks') return 'Değişikliklerinizi eşitlemek için tarayıcınızı veya Android System WebView uygulamasını güncelleyin. Kayıtlarınız korunuyor.';
  if (props.syncStatus === 'backend-update-required') return 'Eşitleme şu anda kullanılamıyor. Cihazdaki değişiklikleriniz korunuyor.';
  if (props.syncStatus === 'auth-required') return 'Değişikliklerinizi eşitlemek için yeniden giriş yapın. Cihazdaki kayıtlarınız korunuyor.';
  if (props.syncStatus === 'forbidden') return 'Sunucu kişisel değişiklikleri kabul etmedi. Veriler bu cihazda korunuyor; henüz hesabınıza aktarılmış sayılmaz.';
  if (props.syncStatus === 'conflict') return 'Bazı kişisel değişiklikler sunucuyla çakışıyor. Kayıtlarınız korunuyor; aşağıdaki çakışmaları inceleyin.';
  if (props.pendingCount > 0) return `${props.pendingCount} kişisel değişiklik bu cihazda kayıtlı; sunucuya aktarılmayı bekliyor.`;
  if (props.syncStatus === 'retry') return 'Eşitleme tamamlanamadı. Cihazdaki kayıtlarınız korunuyor; yeniden deneyebilirsiniz.';
  return null;
});
</script>
<template>
  <section v-if="syncNotice || details && individual" aria-labelledby="account-status-title"
    class="mb-5 min-w-0 rounded-card border border-border bg-card p-4 text-text-primary shadow-sm sm:p-5">
    <h2 id="account-status-title" class="break-words text-base font-bold">{{ details && individual ? 'Abonelik' : 'Eşitleme' }}</h2>
    <template v-if="details && individual">
      <p class="mt-2 text-sm text-text-secondary">Son alınan hesap bilgisi: {{ status }}. Kayıtlarınız korunur.</p>
      <div v-for="(label, field) in { startsAt: 'Başlangıç', endsAt: 'Bitiş' }" :key="field" class="mt-2 flex flex-wrap justify-between gap-2 text-sm text-text-secondary">
        <span>{{ label }}</span><time v-if="data.subscription[field]" :datetime="data.subscription[field]">{{ formatDate(data.subscription[field]) }}</time><span v-else>—</span>
      </div>
    </template>
    <p v-if="syncNotice" role="status" aria-live="polite" class="mt-3 break-words text-sm leading-6 text-text-secondary">{{ syncNotice }}</p>
    <button type="button" :disabled="experience.state.refreshing" @click="emit('retry')"
      class="mt-3 min-h-11 w-full rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-primary-light dark:text-text-primary hover:bg-primary-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:opacity-60 sm:w-auto">
      {{ syncNotice ? 'Yeniden dene' : 'Bilgileri yenile' }}
    </button>
  </section>
</template>
