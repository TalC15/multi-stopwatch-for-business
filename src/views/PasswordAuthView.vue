<script setup>
import {computed,ref,nextTick,onBeforeUnmount,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {passwordLogin,completePasswordMfa,resendPasswordMfa,isPendingPasswordMfa,getUser,getAuthGeneration,getSessionMarker,AUTH_SESSION_CHANGED_EVENT,AUTH_USER_CHANGED_EVENT} from '../services/backendSync.js';
import {passwordAuthRequest} from '../services/passwordAuth.js';
import {takeAuthLink} from '../services/authLink.js';
import {isAndroidAuthPlatform} from '../services/keepTimerAuth.js';
import {connectSocket} from '../services/socket.js';
const route=useRoute(),router=useRouter();
const kind=computed(()=>route.meta.authKind);
const email=ref(''),password=ref(''),currentPassword=ref(''),confirmation=ref(''),code=ref('');
const show=ref(false),loading=ref(false),error=ref(''),notice=ref(''),finished=ref(false),pending=ref(null),link=ref(null);
const focusInput=ref(null),passwordInput=ref(null),seconds=ref(0),sessions=ref([]);
let deadline=0,alive=true,uiEpoch=0;
let authGeneration=getAuthGeneration(),authMarker=getSessionMarker();
function syncAuthContext(){
 const generation=getAuthGeneration(),marker=getSessionMarker();
 if(generation===authGeneration && marker===authMarker)return;
 authGeneration=generation;authMarker=marker;sessions.value=[];
 // Login/MFA installs its own new session; backendSync guards that completion.
 // Account-security/link operations must never write into the next context.
 if(kind.value!=='login'){
  uiEpoch++;loading.value=false;finished.value=false;error.value='';notice.value='';
  password.value='';currentPassword.value='';confirmation.value='';email.value='';
  code.value='';pending.value=null;link.value=null;deadline=0;seconds.value=0;
 }
}
globalThis.window?.addEventListener(AUTH_SESSION_CHANGED_EVENT,syncAuthContext);
globalThis.window?.addEventListener(AUTH_USER_CHANGED_EVENT,syncAuthContext);
const title=computed(()=>pending.value?'Giriş doğrulaması':kind.value==='activation'?'İlk parolanızı belirleyin':kind.value==='reset'?'Parolanızı sıfırlayın':kind.value==='change'?'Parola güvenliği':'E-posta ile giriş');
const useLink=computed(()=>['activation','reset'].includes(kind.value) && !!link.value);
const passwordForm=computed(()=>!pending.value && (kind.value==='login' || kind.value==='change' || useLink.value));
const emailForm=computed(()=>!pending.value && !useLink.value);
function countdown(value=60){deadline=Date.now()+value*1000;seconds.value=value;}
const clock=setInterval(()=>{
 syncAuthContext();
 seconds.value=Math.max(0,Math.ceil((deadline-Date.now())/1000));
 if(pending.value && !isPendingPasswordMfa(pending.value.challengeId,pending.value.context)){
  pending.value=null;code.value='';notice.value='';error.value='Oturum değişti. Yeniden giriş başlatın.';
 }
},1000);
watch(kind,async()=>{
 uiEpoch++;loading.value=false;sessions.value=[];
 link.value=takeAuthLink(kind.value);pending.value=null;finished.value=false;error.value='';notice.value='';
 password.value='';currentPassword.value='';confirmation.value='';code.value='';email.value='';
 await nextTick();(focusInput.value || passwordInput.value)?.focus();
},{immediate:true});
onBeforeUnmount(()=>{globalThis.window?.removeEventListener(AUTH_SESSION_CHANGED_EVENT,syncAuthContext);globalThis.window?.removeEventListener(AUTH_USER_CHANGED_EVENT,syncAuthContext);alive=false;uiEpoch++;clearInterval(clock);pending.value=null;link.value=null;password.value='';currentPassword.value='';code.value='';});
async function successfulLogin(result){
 if(!alive)return;
 if(!result.success){error.value=result.error || 'Giriş doğrulanamadı.';return;}
 pending.value=null;password.value='';code.value='';
 if(!['agent','superadmin'].includes(result.user.role))connectSocket();
 await router.replace(result.user.role==='agent'?'/agent/customers':result.user.role==='superadmin'?'/superadmin':'/');
}
async function submit(){
 syncAuthContext();
 if(loading.value || finished.value)return;
 const epoch=uiEpoch;
 error.value='';notice.value='';loading.value=true;
 try {
  if(pending.value){
   const p=pending.value;
   const result=await completePasswordMfa(p.challengeId,p.context,code.value);
   if(!alive || epoch!==uiEpoch || pending.value!==p || result.stale)return;
   await successfulLogin(result);code.value='';
   await nextTick();(focusInput.value || passwordInput.value)?.focus();return;
  }
  if(passwordForm.value && kind.value!=='login' && password.value!==confirmation.value){error.value='Parolalar eşleşmiyor.';return;}
  if(kind.value==='login'){
   const result=await passwordLogin(email.value,password.value);
   if(!alive || epoch!==uiEpoch)return;password.value='';
   if(result.mfaRequired===true){pending.value={challengeId:result.challengeId,context:result.context};countdown(result.retryAfter);notice.value='Kod e-posta sağlayıcısı tarafından kabul edildi. Gelen kutunuza ulaşması gecikebilir.';await nextTick();(focusInput.value || passwordInput.value)?.focus();}
   else await successfulLogin(result);
   return;
  }
  const path=kind.value==='activation'?'activation':kind.value==='reset'?'reset':null;
  const result=path?await passwordAuthRequest(path+(useLink.value?'/complete':'/request'),useLink.value?
   {challengeId:link.value.challengeId,context:link.value.context,password:password.value}:{email:email.value}):
   await passwordAuthRequest('password/change',{email:email.value,currentPassword:currentPassword.value,password:password.value});
  syncAuthContext();
  if(!alive || epoch!==uiEpoch)return;
  if(!result.ok){error.value=result.error;return;}
  if(path && !useLink.value){notice.value=result.data?.message || 'İstek alındı; e-posta teslimatı garanti edilmez.';countdown();return;}
  if(result.data?.success!==true){error.value='Sunucu sonucu doğrulanamadı.';return;}
  finished.value=true;link.value=null;password.value='';confirmation.value='';currentPassword.value='';
  notice.value='Parolanız güncellendi. Yeniden giriş yapın. Yönetim hesaplarında giriş doğrulama kodu ayrıca gerekir.';
 } catch {if(alive && epoch===uiEpoch)error.value='İşlem doğrulanamadı. Yeniden deneyin.';}
 finally {if(alive && epoch===uiEpoch)loading.value=false;}
}
async function manageSessions(revoke=false){
 syncAuthContext();
 if(loading.value)return;loading.value=true;error.value='';notice.value='';
 const epoch=uiEpoch;
 const result=await passwordAuthRequest(revoke?'sessions/revoke-all':'sessions/list',{});
 syncAuthContext();
 if(!alive || epoch!==uiEpoch)return;loading.value=false;
 if(!result.ok){error.value=result.error;return;}
 if(revoke){sessions.value=[];finished.value=true;notice.value='Tüm oturumlar iptal edildi. Yeniden giriş yapın.';}
 else sessions.value=result.data.sessions;
}
async function resend(){
 if(!pending.value || loading.value || seconds.value)return;
 loading.value=true;error.value='';notice.value='';
 const epoch=uiEpoch;
 const p=pending.value;
 const result=await resendPasswordMfa(p.challengeId,p.context);
 if(!alive || epoch!==uiEpoch || pending.value!==p){if(alive && epoch===uiEpoch)loading.value=false;return;}
 loading.value=false;
 if(result.stale){pending.value=null;code.value='';error.value=result.error;return;}
 if(result.ok && result.data?.accepted===true){code.value='';countdown(result.data.retryAfter);notice.value='Yeni kod sağlayıcı tarafından kabul edildi. Önceki kod artık geçersiz.';await nextTick();(focusInput.value || passwordInput.value)?.focus();}
 else {error.value=result.error || 'Kod yeniden gönderilemedi.';if(result.status===429)countdown(60);}
}
</script>
<template>
 <main class="flex min-h-dvh items-center justify-center bg-[var(--color-surface)] px-4 py-8 text-[var(--color-text-primary)]">
  <section class="w-full min-w-0 max-w-md overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 shadow-xl shadow-indigo-950/5 sm:p-8" aria-labelledby="auth-title">
   <p class="mb-3 text-sm font-extrabold tracking-wide text-indigo-600 dark:text-indigo-300">KeepTimer</p>
   <h1 id="auth-title" class="text-2xl font-black tracking-tight">{{title}}</h1>
   <p class="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{{pending?'Parolanız doğrulandı. Girişi tamamlamak için e-posta kodunuzu girin.':kind==='login'?'Bireysel ve yönetim hesapları için güvenli giriş.':'Bağlantılar tek kullanımlıktır. Parolanızı yalnız siz belirlersiniz.'}}</p>
   <p v-if="isAndroidAuthPlatform()" class="mt-3 text-sm text-[var(--color-text-secondary)]">Bireysel giriş için güncel güvenli native auth desteği gerekir. Aktivasyon, kurtarma ve yönetim işlemlerini web üzerinden tamamlayın.</p>
   <p v-if="kind==='reset'" class="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">Yönetim hesaplarının kurtarılması, güvenilir operatörün ayrı kimlik doğrulamasını gerektirir.</p>
   <p v-if="kind==='change' && getUser()?.role==='manager'" class="mt-3 text-sm">Şirket PIN hesabı için bu parola akışı kullanılamaz.</p>
   <form v-if="!finished" class="mt-6 flex min-w-0 flex-col gap-4" :aria-busy="loading" @submit.prevent="submit">
    <div v-if="emailForm">
     <label for="auth-email" class="mb-1.5 block text-sm font-bold">E-posta adresi</label>
     <input id="auth-email" ref="focusInput" v-model="email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254" required :disabled="loading" class="auth-input" />
    </div>
    <div v-if="kind==='change' && !pending">
     <label for="auth-current" class="mb-1.5 block text-sm font-bold">Mevcut parola</label>
     <input id="auth-current" v-model="currentPassword" type="password" autocomplete="current-password" required :disabled="loading" class="auth-input" />
    </div>
    <div v-if="passwordForm">
     <label for="auth-password" class="mb-1.5 block text-sm font-bold">{{kind==='login'?'Parola':'Yeni parola'}}</label>
     <div class="flex min-w-0 gap-2">
      <input id="auth-password" ref="passwordInput" v-model="password" :type="show?'text':'password'" :autocomplete="kind==='login'?'current-password':'new-password'" required minlength="16" :disabled="loading" aria-describedby="password-help" class="auth-input min-w-0 flex-1" />
      <button type="button" :aria-pressed="show" aria-controls="auth-password" :aria-label="show?'Parolayı gizle':'Parolayı göster'" class="auth-secondary shrink-0" @click="show=!show">{{show?'Gizle':'Göster'}}</button>
     </div>
     <p id="password-help" class="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">En az 16 karakter, en fazla 72 UTF-8 byte. Türkçe karakterler birden fazla byte olabilir.</p>
    </div>
    <div v-if="passwordForm && kind!=='login'">
     <label for="auth-confirm" class="mb-1.5 block text-sm font-bold">Yeni parola tekrar</label>
     <input id="auth-confirm" v-model="confirmation" :type="show?'text':'password'" autocomplete="new-password" required :disabled="loading" class="auth-input" />
    </div>
    <div v-if="pending">
     <label for="auth-code" class="mb-1.5 block text-sm font-bold">8 haneli doğrulama kodu</label>
     <input id="auth-code" ref="focusInput" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" required :disabled="loading" aria-describedby="otp-help" class="auth-input text-center font-mono text-xl tracking-widest" />
     <p id="otp-help" class="mt-2 text-xs leading-relaxed text-[var(--color-text-secondary)]">10 dakika içinde tamamlayın. En fazla 5 deneme; yeniden gönderme kodun süresini uzatmaz.</p>
    </div>
    <p v-if="error" role="alert" class="wrap-anywhere rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-700 dark:text-rose-300">{{error}}</p>
    <button class="min-h-12 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50" :disabled="loading || (!passwordForm && !pending && seconds>0)">{{loading?'İşlem sürüyor…':pending?'Kodu doğrula':kind==='login'?'Giriş yap':passwordForm?'Parolayı kaydet':seconds>0?`${seconds} saniye sonra tekrar iste`:'Bağlantı iste'}}</button>
    <button v-if="pending" type="button" class="auth-secondary" :disabled="loading || seconds>0" @click="resend">{{seconds?`${seconds} saniye sonra yeniden iste`:'Kodu yeniden iste'}}</button>
   </form>
   <p v-if="notice" role="status" aria-live="polite" class="mt-4 wrap-anywhere rounded-xl bg-indigo-500/5 p-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">{{notice}}</p>
   <div v-if="kind==='change' && !finished" class="mt-6 flex flex-col gap-3 border-t border-[var(--color-border)] pt-4">
    <h2 class="text-sm font-bold">Hesap oturumları</h2>
    <button type="button" class="auth-secondary" :disabled="loading" @click="manageSessions()">Oturumları görüntüle</button>
    <ul v-if="sessions.length" class="text-xs leading-relaxed text-[var(--color-text-secondary)]">
     <li v-for="session in sessions" :key="session.id" class="wrap-anywhere border-b border-[var(--color-border)] py-2">{{session.createdAt}} · {{session.revoked?'İptal edildi':'Açık'}} · Bitiş: {{session.expiresAt}}</li>
    </ul>
    <button type="button" class="auth-secondary" :disabled="loading" @click="manageSessions(true)">Bu oturum dahil tüm oturumlardan çık</button>
   </div>
   <p v-if="finished && getUser()" class="mt-3 text-sm text-[var(--color-text-secondary)]">Bağlantı mevcut hesabınıza ait değilse oturumunuz korunur. Başka hesapla giriş için önce mevcut hesabınızdan çıkın.</p>
   <nav class="mt-5 flex flex-col gap-1 text-center text-sm font-semibold text-indigo-600 dark:text-indigo-300" aria-label="Hesap bağlantıları">
    <RouterLink v-if="kind!=='login'" to="/password-login" class="auth-link">E-posta ile giriş</RouterLink>
    <RouterLink v-if="kind==='login' && !pending" to="/account/reset" class="auth-link">Parolamı unuttum</RouterLink>
    <RouterLink v-if="kind==='login' && !pending" to="/account/activate" class="auth-link">İlk aktivasyon bağlantısı iste</RouterLink>
    <RouterLink to="/login" class="auth-link">Şirket PIN girişi</RouterLink>
    <RouterLink to="/" class="auth-link">Giriş yapmadan kullan</RouterLink>
   </nav>
  </section>
 </main>
</template>
<style scoped>
@reference "../assets/main.css";
.auth-input { @apply min-h-12 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:opacity-50; }
.auth-secondary { @apply min-h-11 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50; }
.auth-link { @apply flex min-h-11 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-indigo-500; }
</style>
