<script setup>
import { computed } from 'vue';
import { STANDALONE_LIMIT, STANDALONE_LIMIT_MESSAGE } from '../data/timerRepository.js';
const props = defineProps({ experience: { type: Object, required: true }, count: { type: Number, default: 0 }, ready: Boolean,
  pendingCount: { type: Number, default: 0 }, syncStatus: { type: String, default: 'idle' } });
const emit = defineEmits(['retry']);
const data = computed(() => props.experience.state.data);
const standalone = computed(() => props.experience.state.status === 'standalone');
const individual = computed(() => data.value?.account.kind === 'individual');
const status = computed(() => ({ active: 'Aktif', pending: 'Başlaması bekleniyor', expired: 'Süresi doldu', cancelled: 'İptal edilmiş' })[data.value?.subscription.status] || 'Abonelik bulunamadı');
const verified = computed(() => props.experience.state.status === 'verified');
const features = ['Sesli okuma', 'Telegram', 'Hazır ayarlar'];
const formatDate = value => value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const notice = computed(() => {
  if (standalone.value) return !props.ready ? 'Cihazdaki sayaçlarınız açılıyor…' : props.count >= STANDALONE_LIMIT ? STANDALONE_LIMIT_MESSAGE : 'Sayaçlarınız bu cihazda saklanır. Normal alarm ve bildirimler kullanılabilir.';
  if (props.experience.state.status === 'loading') return 'Hesabınız ve kullanım haklarınız sunucudan doğrulanıyor…';
  if (!verified.value) return 'Haklar doğrulanamadı. Cihazdaki kayıtlarınız korunuyor; mevcut sayaçlar yerel çalışır. Yeni kişisel sayaç ve ücretli özellikler için bağlantı gerekiyor.';
  if (data.value?.subscription.isEntitled) return 'Yalnız size ait kişisel sayaçlar hesabınızla eşitlenir. Cihazdaki ücretsiz sayaçlar otomatik aktarılmaz.';
  return { pending: 'Aboneliğiniz henüz başlamadı. Özel kayıtlarınız okunabilir; ücretli özellikler başlangıçtan sonra sunucu doğrulamasıyla açılır.',
    expired: 'Aboneliğinizin süresi doldu. Özel kayıtlarınız silinmez. Yenileme sonrası aynı kayıtlarla devam edebilirsiniz.',
    cancelled: 'Sunucu şu anda ücretli kullanım hakkı vermiyor. Özel kayıtlarınız korunur.' }[data.value?.subscription.status] || 'Ücretli kullanım hakkı doğrulanamadı. Özel kayıtlarınız korunur.';
});
const syncNotice = computed(() => {
  if (!individual.value) return null;
  if (['forbidden', 'auth-required'].includes(props.syncStatus)) return 'Sunucu kişisel değişiklikleri kabul etmedi. Veriler bu cihazda korunuyor; henüz hesabınıza aktarılmış sayılmaz.';
  if (props.syncStatus === 'conflict') return 'Bazı kişisel değişiklikler sunucuyla çakışıyor. Cihazdaki kayıtlarınız korunuyor; çakışma çözülmeden eşitlenmiş sayılmaz.';
  if (props.pendingCount > 0) return `${props.pendingCount} kişisel değişiklik bu cihazda kayıtlı; sunucuya aktarılmayı bekliyor.`;
  if (props.syncStatus === 'retry') return 'Eşitleme tamamlanamadı. Cihazdaki kayıtlarınız korunuyor; bağlantı ve kullanım hakkı doğrulandığında yeniden denenir.';
  return null;
});
</script>

<template>
  <section v-if="standalone || individual || !data" aria-labelledby="account-status-title"
    class="mb-5 min-w-0 rounded-card border border-border bg-card p-4 text-text-primary shadow-sm sm:p-5">
    <div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <p class="mb-1 text-xs font-semibold uppercase tracking-wider text-text-secondary">Kullanımınız</p>
        <h2 id="account-status-title" class="break-words text-base font-bold tracking-tight">
          {{ standalone ? 'Ücretsiz Kullanım' : individual ? 'Bireysel Kullanıcı' : 'Hesap doğrulaması' }}
        </h2>
      </div>
      <span v-if="standalone && ready" class="shrink-0 rounded-lg bg-primary-bg px-3 py-1.5 text-sm font-bold tabular-nums text-primary-light dark:text-text-primary" aria-label="Cihazdaki süreölçer sayısı">{{ count }} / {{ STANDALONE_LIMIT }}</span>
      <span v-else-if="!standalone" class="max-w-full break-words rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-secondary">
        {{ !verified ? experience.state.status === 'loading' ? 'Doğrulanıyor' : 'Doğrulanamadı' : status }}
      </span>
    </div>
    <p class="mt-3 break-words text-sm leading-6 text-text-secondary" role="status" aria-live="polite">{{ notice }}</p>
    <p v-if="syncNotice" class="mt-3 rounded-lg border border-border bg-surface p-3 text-sm leading-6 text-text-secondary" role="status">{{ syncNotice }}</p>
    <div v-if="individual && data.subscription.startsAt" class="mt-3 flex flex-wrap justify-between gap-1 border-t border-border pt-3 text-xs text-text-secondary">
      <span>{{ verified ? 'Abonelik başlangıcı' : 'Son doğrulanan başlangıç' }}</span><time :datetime="data.subscription.startsAt" class="max-w-full break-words font-semibold text-text-primary">{{ formatDate(data.subscription.startsAt) }}</time>
    </div>
    <div v-if="individual && data.subscription.endsAt" class="mt-2 flex flex-wrap justify-between gap-1 text-xs text-text-secondary">
      <span>{{ verified ? 'Abonelik bitişi' : 'Son doğrulanan bitiş' }}</span><time :datetime="data.subscription.endsAt" class="max-w-full break-words font-semibold text-text-primary">{{ formatDate(data.subscription.endsAt) }}</time>
    </div>
    <ul class="mt-3 flex flex-wrap gap-2" aria-label="Ücretli özellikler">
      <li v-for="(label, i) in features" :key="label" class="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary">
        <span aria-hidden="true" class="text-primary-light">{{ experience.canFeature(['tts', 'telegram', 'presets'][i]) ? '✓' : '—' }}</span>
        {{ label }} <span class="sr-only">{{ experience.canFeature(['tts', 'telegram', 'presets'][i]) ? 'kullanılabilir' : 'kullanılamıyor' }}</span>
      </li>
    </ul>
    <p v-if="standalone" class="mt-2 text-xs leading-5 text-text-secondary">Sesli okuma, Telegram ve hazır ayarlar doğrulanmış ücretli hesaplarda kullanılabilir.</p>
    <button v-if="!standalone" type="button" :disabled="experience.state.status === 'loading'" @click="emit('retry')"
      class="mt-3 min-h-11 w-full rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-primary-light dark:text-text-primary transition-colors hover:bg-primary-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light dark:focus-visible:outline-text-secondary disabled:cursor-wait disabled:opacity-60 sm:w-auto">
      {{ experience.state.status === 'loading' ? 'Doğrulanıyor…' : 'Hakları yeniden doğrula' }}
    </button>
  </section>
</template>
