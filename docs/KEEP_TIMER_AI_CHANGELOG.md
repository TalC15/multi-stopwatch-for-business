# KeepTimer — AI Engineering Changelog

> Amaç: Projede yapılan önemli değişiklikleri, nedenlerini, testlerini ve bilerek ertelenen işleri kalıcı biçimde kaydetmek.
>
> Kural: Bundan sonra onaylanan her proje değişikliğinden sonra bu dosyaya tarihli bir kayıt eklenir. Kayıt; ne değişti, neden değişti, hangi dosyalar etkilendi, hangi testler yapıldı ve neyin bilerek ertelendiğini içermelidir.

---

## 2026-09-24 — Auth / Session / Socket hardening tamamlandı

### Durum

Bu faz **kapalı/dondurulmuş** kabul edilir. Yalnızca somut bir production bug'ı, güvenlik açığı, session-isolation ihlali veya veri bozulması bulunursa tekrar açılmalıdır.

Stil, isimlendirme, küçük refactor veya teorik edge-case gerekçesiyle tekrar kurcalanmamalıdır.

### Tamamlanan hedefler

- Access token süresi dolduğunda, refresh session geçerliyse sessiz refresh çalışıyor.
- Eski/stale HTTP cevapları yeni login session'ını değiştiremiyor.
- Eski refresh/logout işlemleri yeni login'i temizleyemiyor.
- Aynı browser profilindeki sekmeler per-tab session identity ile izole.
- Stale tab sonradan açılan başka session'ı sahiplenemiyor.
- Socket immutable session identity'ye bağlı.
- Socket 401 hatası mevcut ortak refresh akışını kullanıyor.
- Socket middleware 503 hataları kontrollü retry kullanıyor.
- 1s / 3s / 7s retry bittikten sonra 30 saniyelik recovery probe devam ediyor.
- Logout, access token geçersiz/expired olsa bile refresh session'ı backend'de revoke ediyor.
- Logout sonrası ilgili login session'ının açık socket'leri server tarafından kesiliyor.
- Superadmin force-logout hedef kullanıcının açık socket'lerini server tarafından kesiyor.
- Başarılı socket reconnect sonrası shared timer reconciliation çalışıyor.

---

## Frontend auth/session mimarisi

### `frontend/src/services/backendSync.js`

Temel yapı:

- `authGeneration`: stale auth işlemlerini geçersiz kılar.
- Refresh, generation + refresh token bazında single-flight.
- Refresh token login-session kimliğinin stabil referansı olarak kullanılır.
- Frontend JWT payload decode işlemi yalnızca identity matching içindir; authorization için kullanılmaz.
- Per-tab binding:
  - `sessionStorage["keeptimer-tab-auth-session"]`
- Browser genelindeki access/refresh/user bilgileri localStorage'da.
- Uygun ortamlarda Web Locks auth mutation'larını sekmeler arasında serialize eder.

Önemli helper'lar:

- `getAuthGeneration()`
- `getAccessToken()`
- `getRefreshToken()`
- `getTokenSessionIdentity(token, expectedType)`
- `getTabSessionIdentity()`
- `isTabSessionCurrent()`
- `refreshAccessToken(...)`
- `clearAuthSessionIfCurrent(...)`

Önemli event'ler:

- `keeptimer:auth-session-changed`
- `keeptimer:auth-local-logout`
- `keeptimer:auth-login-required`
- `keeptimer:auth-access-token-refreshed`

### HTTP 401 / refresh davranışı

`apiFetch()` request'in auth context'ini snapshot olarak alır ve response geldiğinde hâlâ aynı session'a ait olduğunu kontrol eder.

401 durumunda:

1. Aynı session için access token zaten değişmişse yeni token ile bir kez retry eder.
2. Aksi halde `refreshAccessToken(...)` çağrılır.
3. Refresh başarılıysa request yeniden gönderilir.
4. Refresh 401/403 ise hard auth failure.
5. Network/503 refresh failure transient kabul edilir; session temizlenmez.

### Cross-tab davranışı

Onaylanan davranış:

- Aynı browser profilindeki tab'ler localStorage üzerinden tek aktif browser login'i paylaşır.
- Eski session'a bağlı stale tab yeni session'ı sahiplenemez.
- Stale tab reload edilirse eski binding korunur ve login'e düşer.
- Farklı browser/device session'ları bağımsızdır.

---

## Socket authentication ve recovery

### `frontend/src/services/socket.js`

Socket yalnızca kendi oluşturulduğu immutable session identity ile geçerlidir.

Bir socket instance yalnızca şu koşullarda current kabul edilir:

- global current socket odur,
- kayıtlı socket session identity eşleşir,
- tab session identity eşleşir,
- `isTabSessionCurrent()` true'dur.

Timer-event callback'leri ve reconnect callback'leri stale socket instance'larının UI state'ini değiştirmesini engelleyen guard'larla çalışır.

### Socket 401 recovery

Socket middleware 401 verdiğinde:

- reddedilen handshake token kaydedilir,
- daha yeni access token zaten varsa onunla retry edilir,
- yoksa ortak `refreshAccessToken(...)` akışı çağrılır,
- başarılı refresh access-token-refreshed event'i ile reconnect'i tetikler,
- hard refresh failure yalnız hâlâ current olan auth session'ı temizler,
- transient refresh failure session'ı korur ve kontrollü socket retry planlar.

### 503 / transient recovery

Kısa retry gecikmeleri:

- 1 saniye
- 3 saniye
- 7 saniye

Bunlar bittikten sonra:

- connection hâlâ isteniyorsa,
- socket instance hâlâ current ise,
- tab/session hâlâ current ise,

30 saniyede bir düşük frekanslı recovery probe devam eder.

Başarılı connect retry/probe state'ini sıfırlar.

Logout veya session change pending retry timer'larını iptal eder ve eski socket'i geçersiz kılar.

Normal transport/network reconnect davranışı Socket.IO'ya bırakılır.

### Reconnect reconciliation

Socket reconnect sonrası shared timer reconciliation çalışır; kaçırılmış realtime event'ler yüzünden UI'nın stale kalması engellenir.

---

## Backend session/socket lifecycle

### Socket room'ları

Authenticated socket'ler server tarafından şu odalara alınır:

- `user-${user.id}`
- `session-${sessionId}`
- varsa `workspace-${workspaceId}`

Client workspace room seçmez.

### Logout sözleşmesi

Eski `/auth/logout` geçerli access token gerektiriyordu.

Yeni davranış:

- `/auth/logout` refresh token alır.
- Backend şunları doğrular:
  - JWT geçerliliği
  - `type === "refresh"`
  - user id
  - session id
  - DB session
  - refresh token hash eşleşmesi
- Yalnız o session revoke edilir.
- Zaten revoked session için logout idempotent davranır.

Revoke sonrası:

`io.in(\`session-${session.id}\`).disconnectSockets(true)`

ile o login session'ına bağlı açık socket'ler anında kesilir.

### Superadmin force logout

Force-logout hedef kullanıcının tüm aktif session'larını revoke eder.

Ardından:

`io.in(\`user-${id}\`).disconnectSockets(true)`

ile hedef kullanıcının açık socket'leri anında kesilir.

---

## Yapılan testler

### HTTP refresh

Geçti:

- Bozuk access token signature → refresh → aynı session için yeni access → request başarılı.
- Revoked refresh session → hard fail → güvenli local cleanup → login required.
- Refresh network/transient failure → session korunur, false logout olmaz.

### Socket 401 race — iki ordering

Geçti:

- Socket 401 önce, refresh event sonra.
- Refresh event önce, eski socket handshake 401 sonra.

Her iki durumda da doğru session token ile reconnect oldu.

### Socket-only 401

HTTP request olmadan test edildi:

- access signature bozuldu,
- socket reconnect denedi,
- socket 401 aldı,
- socket ortak refresh flow'u tetikledi,
- yeni access token geldi,
- socket reconnect oldu,
- reconciliation tamamlandı.

Geçti.

### 503 bounded retry

Simüle edilen middleware-style 503 state sonrası:

- socket inactive/disconnected,
- kontrollü retry,
- `reconnect: true`,
- shared reconciliation tamamlandı.

Geçti.

### Long-tail recovery probe

1s / 3s / 7s retry'ların tükenmiş olduğu state simüle edildi.

Sonuç:

- 30 saniyelik recovery probe socket'i yeniden bağladı,
- reconciliation tamamlandı,
- kullanıcı login'e atılmadı.

Geçti.

### Expired/invalid access ile logout

Test:

1. Refresh token yedeklendi.
2. Access token signature bozuldu.
3. Session identity aynı kaldı.
4. Normal Logout yapıldı.
5. Yedek eski refresh token ile `/auth/refresh` çağrıldı.

Sonuç:

- UI login ekranına geçti.
- Backend `401` döndürdü:
  - `Oturum sonlandırılmış, tekrar giriş yapın`

Bu, expired/invalid access'e rağmen backend refresh session'ın revoke edildiğini doğruladı.

### Server-side logout socket disconnect

Frontend'in normal local disconnect'i kullanılmadan `/auth/logout` doğrudan çağrıldı.

Sonuç:

- `200 { success: true }`
- socket reason: `io server disconnect`
- final:
  - `connected: false`
  - `active: false`

Geçti.

### Superadmin force-logout socket disconnect

İki ayrı browser context kullanıldı.

- Hedef kullanıcı authenticated socket ile bağlıydı.
- Superadmin force-logout çağırdı.
- Backend 200 döndürdü.
- Hedef kullanıcının socket'i server tarafından disconnect edildi.

Geçti.

---

## Bu fazdaki commit mesajları

Bilinen commit mesajları:

- `fix(auth): harden cross-tab session isolation`
- `fix(auth): harden socket authentication recovery`
- `fix(auth): harden socket recovery and logout revocation`
- `fix(auth): disconnect revoked session sockets`
- `fix(auth): disconnect sockets on force logout`
- `fix(auth): add long-tail socket recovery`

Commit hash'leri bu dosyaya kaydedilmedi.

---

## Kırılmaması gereken invariants

1. Eski auth request yeni login'i temizleyemez veya overwrite edemez.
2. Stale tab başka tab'in yeni login session'ını sahiplenemez.
3. Frontend JWT decode authorization için kullanılmaz.
4. Socket workspace membership server tarafından belirlenir.
5. Socket bir session'dan başka session'a sessizce migrate edemez.
6. Stale socket callback/event current UI state'ini değiştiremez.
7. Shared timer server-authoritative kalır.
8. Normal transport reconnect Socket.IO'ya bırakılır.
9. Logout local-first kalır; backend ulaşılamasa da UI logout gecikmez.
10. Backend session revoke edildiğinde açık socket'ler de kapatılır.

---

## Bilerek ertelenen işler

- Dev/HMR sırasında duplicate top-level listener/log görülebilir; production kritik değil.
- Offline-first timer repository/outbox/sync mimarisi ayrı faz.
- IndexedDB/Dexie planı ayrı faz.
- Telegram scheduler'ın backend restart sonrası persistence konusu ayrı bilinen sınırlama.

---

## Timer data-mode bağlamı

KeepTimer üç modu ayırır:

1. `workspace_id == null`
   - standalone/local-only
   - hedef mimaride fully offline

2. workspace + `is_shared == false`
   - company-owned personal timer
   - local-first + DB sync
   - creator operates

3. workspace + `is_shared == true`
   - company shared timer
   - server/DB authoritative
   - local display cache
   - backend yokken mutation queue edilmez; mutation blocked

Önemli: Mode 1 ve Mode 2 yalnızca `is_shared == false` oldukları için aynı kategoriye indirgenmemelidir.

---

## Bundan sonraki kayıt şablonu

```md
## YYYY-MM-DD — Kısa değişiklik başlığı

### Neden
Değişikliğe yol açan problem veya gereksinim.

### Değişenler
- Dosya/path
- Davranış değişikliği
- Önemli implementation detayı

### Invariants
Gelecekte korunması gereken kurallar.

### Testler
- Yapılan test
- Beklenen sonuç
- Gerçek sonuç

### Commit
`type(scope): message`

### Ertelenenler
Bilerek sonraya bırakılan işler.
```
