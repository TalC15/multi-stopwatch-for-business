# KeepTimer Phase 4 — store ve uygulama entegrasyonu

Tarih: 2026-09-27. Durum: Kod ve yerel otomatik doğrulama tamamlandı; gerçek tarayıcı/APK ve canlı ortam kabulü yapılmadı.

## Kaynak ve öncelik

Yalnız `SON GÜNCEL FRONTEND.zip`, `SON GÜNCEL BACKEND.zip` ve `Yapıştırılan metin(8).txt` esas alındı. İki changelog ve güncel `PHASE3_PERSONAL_SYNC.md` tamamen okundu. Görev metni, geçmiş faz belgelerindeki “UI bağlı değil” gibi tarihsel açıklamalardan önceliklidir. ZIP'lerde `.git` bulunmadığından gerçek commit/dal doğrulanamadı. Bildirilen önceki 83 frontend / 34 backend / 7 PostgreSQL sonucu yeni test sonucu sayılmadı.

SHA-256:

- Frontend: `faff7c14040dc552f462dc86c6233229a51ea801fec663509cb845cbd6ed91c3`
- Backend: `f1ed8acf865e25d42aa311450afe02f5413f84a9b8bc90f5453848a548713d97`
- Metin: `386207930e73e05b1a7bcb59fefe2e2aab24b93047f18d74c61e23b33b7a61a8`

## Uygulama mimarisi

Pinia store, uygulamada kullanılan `createStopwatchController` denetleyicisini kurar. Testler ayrı bir örnek uygulama yerine bu üretim denetleyicisini çalıştırır; yalnız platform etkileri, HTTP, saat ve kilitler enjekte edilir. Görünüm reactive kalır, kalıcı sayaç kaynağı IndexedDB'dir. Eski `localStorage["timers"]` okuma/yazma/watch kaldırıldı; migrasyon, silme veya kurtarma eklenmedi. Auth ve kullanıcı tercihleri localStorage kullanımını sürdürür.

| Mod | Oluşturma/değiştirme/silme | Ağ |
| --- | --- | --- |
| Standalone | Repository; işlem tamamlanınca görünüm güncellenir | Sayaç/Telegram çağrısı ve outbox yok |
| Workspace-personal | `enqueuePersonalPut(...,{isNew:true})`, `enqueuePersonalPut(...)`, `enqueuePersonalDelete(...)` | Phase 3 `flush`/`pull`; legacy timer CRUD yok |
| Shared | Mevcut backend CRUD ve Socket.IO; başarılı server snapshot'ı cache'e yazılır | Kişisel outbox kullanılmaz |

Mod mevcut kullanıcı/workspace ve shared alanından türetilir; yeni mod seçici yoktur. Standalone kayıt workspace'e girince dönüştürülmez. Giriş gerektirmeyen mevcut ana sayfa ve login sayfasındaki küçük geçiş bağlantısı, offline standalone kullanımını erişilebilir kılar. Başka yeni sayfa yoktur.

Her yerel güncelleme, en güncel DB kaydını **aynı timers+personalOutbox transaction'ında okuyup** değiştirir. Böylece iki sekmenin farklı alan değişiklikleri eski UI nesnesi üzerinden birbirini ezmez. Enqueue fonksiyonlarının mevcut sözleşmesi korunur. Yerel transaction başarısızsa UI başarı/kalıcı durum göstermeden hata döner. Ağ başarısızlığı başarılı yerel kaydı geri almaz. Silme sesi ve başarı mesajı da commit sonrasındadır.

Başlangıç, kullanıcı/workspace değişimi, başarılı kişisel mutasyon, online, focus, pageshow ve görünürlük dönüşü senkronizasyonu tetikler. Aynı denetleyicide çağrılar birleştirilir; işlem sırasında gelen yeni istek bir sonraki sonlu turda ele alınır. Yeni polling, retry zamanlayıcısı veya background scheduler yoktur. Mevcut 100 ms sayaç çizim interval'i ağ çağrısı yapmaz; yalnız hedef geçişinde bir defalık kalıcı eylem üretir. Phase 3 retryAt henüz gelmediyse yeniden deneme sonraki açık yaşam döngüsü/kullanıcı olayını bekler.

Session generation, tab identity, refresh kimliği, kullanıcı ve workspace yakalanır; önemli await ve transaction sınırlarında tekrar kontrol edilir. API katmanındaki access-token session doğrulaması korunur. Logout/hesap değişimi şirket kayıtlarını hemen görünümden kaldırır; IndexedDB/outbox silinmez. Geciken eski yanıt yeni hesaba uygulanamaz. `saveUser` sonrası eklenen olay yalnız mevcut auth mekanizmasının store'u bilgilendirmesidir; auth/refresh state machine yeniden yazılmadı.

Dexie liveQuery, başka sekmedeki yerel değişiklikleri görünüme taşır. Shared olayları yalnız shared kayıtlara uygulanır; created olayındaki eksik sahiplik bilgisi uydurulmaz, GET ile alınır. Reconnect GET yapar. GET sürerken gelen socket/mutasyon olayı yeni okuma gereksinimi olarak tutulur. Başarısız GET cache'i temizlemez. Shared GET'in tarihsel tam liste/otorite sınırları Phase 5 kapsamında kalır.

## Çok cihazlı kişisel okuma ve silme

Mevcut active-only `GET /timers/personal` açık silme bilgisi ve eksiksiz sonuç garantisi vermez. Bu nedenle küçük, ayrı backend patch'i gereklidir. Yeni opt-in sözleşme:

```text
GET /timers/personal?syncPage=1
GET /timers/personal?syncPage=1&after=<önceki nextCursor>
{ timers: [...], tombstones: [...], nextCursor: "uuid" | null }
```

Backend auth kullanıcısı/workspace'iyle ve `is_shared=false` filtreler; UUID artan sıralı keyset sayfa boyutu en fazla 200'dür. Arşiv/silme satırları minimal kimlik, sahiplik, revizyon ve terminal durumla döner. Kısa sayfa bitiş sayılmaz: Supabase limiti 200'den az olabilir. **Yalnız boş sayfa nextCursor=null döndürür.** Eski GET cevabı değişmez; yeni SQL veya şema değişikliği yoktur.

İstemci tüm sayfaların kapsam, UUID, canonical veri, revizyon, benzersizlik ve ilerleyen cursor sözleşmesini kontrol eder. Herhangi bir sayfa başarısızsa kısmi snapshot uygulanmaz. Sonuç tek IndexedDB transaction'ında import edilir. Yeni cihaz aynı UUID'yi alır; yeniden oluşturma yapmaz.

Açık tombstone yalnız aynı kapsamda, bilinen revizyonu sunucudan ileride olmayan, temiz (`synced`/`deleted`) ve bekleyen outbox'ı bulunmayan mevcut kaydı gizler. Minimal terminal işaret korunur. Dirty, conflict, unbased, daha yeni yerel veya bekleyen kayıt ve kuyruk korunur. Listede görünmemek hiçbir zaman silme sayılmaz. Eski backend yeni sözleşmeyi sağlamazsa “sunucu güncellemesi gerekiyor” durumu gösterilir, yerel veri korunur.

Bu keyset taraması PostgreSQL point-in-time snapshot değildir. Tarama sırasında önceki cursor bölgesinde yapılan değişiklik sonraki pull'da görülür. Değişmeyen veri kümesinde tam tarama yapılır; eşzamanlılıkta yokluktan silme çıkarılmadığı için veri kaybı olmaz. Fiziksel olarak kaldırılmış ve tombstone bırakılmamış server satırı için silme tahmin edilmez. Geçersiz tarihsel aktif satır canonical doğrulamayı geçmezse pull güvenli biçimde durur; otomatik veri temizliği yoktur.

## Zaman ve bildirimler

Çizim `accumulatedTime + (now-startTime)` üzerinden türetilir; her tick DB'ye yazmaz. Backend'e canonical whitelist gider, UI elapsed/remaining alanları gönderilmez. Pozitif hedef ve en fazla 35 karakter isim doğrulanır. Yeniden açma/offline süreleri başlangıç anchor'ını değiştirmez.

Count-Up hedefte `reachedTarget` kalıcılaştırır, bildirim verir ve running kalır. Pull'dan türetilen hedef bilgisi, cihazın bildirim verdiği kabul edilmez; cihazdaki bildirim işareti korunur. Countdown gerçek deadline'a göre `completed`, `endedAt`, `durationMs` kaydeder; kart mevcut `expired` görünümünü kullanır. Tick gelmeden hedef sonrası pause yapılması da hedef geçişini işler. Yerel kayıt başarısızsa tamamlandı/bildirildi gibi davranılmaz.

Mevcut yerel bildirim/TTS/haptic yardımcıları korunur. Standalone bu yolla backend kullanmaz. Kişisel Telegram planlama/iptali yalnız onaylanmış temiz kayıtlar için mevcut `/timer/start` ve `/timer/cancel` endpoint'leriyle ve session guard ile yapılır; eski CRUD kullanılmaz. Bildirim hatası sayaç kaydını/outbox'ı bozmaz; sonraki açık sync olayında tekrar denenebilir. Bu endpoint'ler bağımsız bildirim yan etkileridir, sayaç verisinin ikinci yazma yolu değildir. Offline sırasında server'ın bilmediği pause/delete, önceden kurulmuş server bildirimini anında iptal edemez.

Uygulama/OS kapalıyken yeni background çalışma garantisi eklenmedi. Foreground'a dönünce anchor'dan süre ve hedef geçişi hesaplanır. Bildirim izni, ses politikası, OS askıya alma ve gerçek APK bildirim davranışı cihaz kabul testine tabidir. Commit ile OS bildirim teslimi arasında crash olması halinde tam olarak bir kez fiziksel bildirim garantisi yoktur.

## Android ve Web Locks

Kaynakta Capacitor 8 ve Android paketi vardır; Android native proje/Gradle dosyaları yoktur. Bu ortamda ADB, Android cihaz/emülatör veya Chromium çalıştırılabilir dosyası bulunmadı. Playwright paketi bulunmasına rağmen tarayıcı binary'si yoktur. Gerçek tarayıcı veya APK testi yapılmış sayılmamalıdır.

Resmî Capacitor Android v8 belgesi Android API 24+ ve WebView Chrome 60+ tabanını belirtir; bu taban modern uygulama API'lerini tek başına garanti etmez. Web Locks güvenli origin ve destekleyen WebView gerektirir. Kurulu Vite 7 build varsayılanı Chrome 107 hedefini içerir. Bu nedenle `android.minWebViewVersion=107` açıkça eklendi. Hostname/scheme değiştirilmedi; IndexedDB origin'i taşınmadı. Bu bir APK üzerinde başarı kanıtı değildir; native projeye normal Capacitor sync ve cihaz doğrulaması gerekir.

Runtime Web Locks kontrolü aynen korunur. Kilit yoksa kişisel kayıt/outbox yerelde kalır, gönderim/pull durur ve UI güncelleme ihtiyacını gösterir. Bellek kilidi veya güvensiz lease fallback eklenmedi. Uyumlu/güncel WebView hedeflenir; gerçek hedefte destek eksikliği görülürse önce WebView ve secure-context koşulları doğrulanmalıdır.

Kaynaklar:

- https://capacitorjs.com/docs/android
- https://capacitorjs.com/docs/config
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/locks
- https://www.w3.org/TR/web-locks/

## Testler ve build

| Çalıştırma | Gerçek sonuç |
| --- | --- |
| Frontend `npm test` | **114 başarılı / 0 başarısız / 0 atlanan**; önceki 83 test korunur, 31 yeni test |
| Backend `npm test` | **35 başarılı / 0 başarısız / 7 atlanan**; 34 mevcut normal test ve 1 yeni HTTP test |
| Frontend standart `npm run build` | Uygulama derlendi; PWA terser worker aşaması ortamın `os.cpus()=[]` sonucuyla başarısız oldu |
| Aynı build, yalnız test ortamında CPU preload düzeltmesiyle | **Başarılı**, dist/sw.js ve Workbox dosyası üretildi; 18 precache girdisi |

Build preload dosyası teslim patch'ine/paketlere eklenmedi. Kullanıcının normal ortamında standart `npm run build` tekrar çalıştırılmalıdır; bu ortamda standart komutun tamamen geçtiği iddia edilmiyor.

Yeni frontend testleri: üretim controller üzerinde 21 test; kişisel sayfalı snapshot üzerinde 10 test. fake-indexeddb, mock HTTP/session/locks ve kontrollü saat kullanılır. Offline standalone CRUD/sıfır timer IO, reopen, modun korunması, tüm kişisel eylemler, atomic rollback, online flush, logout ve scope değişimi, conflict/503, aynı UUID'nin ikinci DB'ye alınması, açık silme, Count-Up/Countdown, bildirim sırası, iki controller'ın eşzamanlı alan değişiklikleri, shared outbox ayrımı/geciken GET/socket olayları doğrulanır. Sayfalama testleri hata sonrası kısmi import yapılmamasını, yoklukta korumayı, terminal revizyon/kapsam/pending korumalarını ve bozuk cursor/session değişimini kapsar.

Yeni backend testi gerçek yerel Express HTTP sunucusunu ve auth kodunu kullanır; Supabase fetch'i mock'tur. 1003 satır, zorlanan 37 satırlık servis limitiyle eksiksiz dolaşılır; silme/arşiv ayrımı, scope sorgusu, legacy GET, yanlış cursor, 503 ve workspacesiz 403 kontrol edilir. Diğer backend testlerinde mevcut PGlite/HTTP testleri çalışmıştır. Atlanan 7 test ayrı gerçek PostgreSQL bağlantısı gerektiren mevcut concurrency testleridir; yeni skip veya beklenti gevşetmesi eklenmedi.

Gerçek tarayıcı/APK kabulünde: iki sekme Web Locks yarışı, offline service worker yeniden açılışı, force-stop sonrası IndexedDB/outbox, iki gerçek cihazda aynı UUID ve silme, geciken auth/refresh cevapları, desteklenmeyen WebView, bildirim/ses izinleri ve shared çoklu cihaz akışı ayrıca çalıştırılmalıdır. Bunlar mock başarılarından çıkarılamaz.

## İnceleme, kapsam ve risk

Bağımsız Sonnet/geliştirici incelemesi henüz yapılmadı; bu belge o inceleme için hazırlanmıştır. Özellikle controller transaction sınırları, scope guard'ları, importPersonalSnapshot terminal koşulları ve HTTP pagination testi incelenmelidir. Mevcut 83 test dosyasının içerikleri değiştirilmedi; fixture yalnız yeni GET/bildirim sözleşmelerini destekleyecek şekilde genişletildi.

Repository ve DB şeması yeterli olduğu için bu fazda değiştirilmedi. Yeni dependency, migration, veri modu seçici veya scheduler yoktur. Controller platform etkilerini tek yerde toplar; ayrı clock modülü çizim/canonical durum ayrımını görünür kılar. Eşzamanlı mutasyonlar ve cross-tab read-modify-write riskine karşı transaction kullanılır; hatada belirsiz yerel veri silinmez. Snapshot taraması bütün scope'u belleğe alır; çok büyük veri kümelerinde artımlı sürüm protokolü ileride değerlendirilebilir.

Conflict/error/forbidden otomatik çözümlenmez; UI korunmuş yerel değişikliği bildirir. Manuel çözüm arayüzü, Phase 5 shared server-authoritative mutasyon tasarımı ve Phase 6 kapsamlı gerçek cihaz/üretim kabul matrisi bu faza eklenmedi. Yerel depolamayı kullanıcı/OS temizlerse sunucuya hiç gönderilmemiş standalone/outbox geri getirilemez; yeni yedek sistemi kapsam dışıdır.

Commit, push, main merge, canlı SQL, canlı timer yazma veya deploy yapılmadı. Ayrı backend patch'i yeni frontend'in güvenilir çok cihazlı silme okuması için gereklidir; backend güncellemesi olmadan bu davranış tamamlanmış sayılmaz. Yayın sırası backend, ardından frontend olmalıdır; yayın bu teslimin parçası değildir.

## Uygulama

Patch'ler ilgili **son ZIP'in repo köküne** göre hazırlanır; frontend patch'ini backend klasöründe veya eski ZIP'te uygulamayın. Temiz kopyalarda `git apply --check`, gerçek apply ve kaynak dosyalarıyla byte karşılaştırması teslim sırasında yapılır. Komutlar commit/deploy içermez:

```sh
# Backend repo kökünde
 git apply --check KeepTimer_Phase4_Backend.patch
 git apply KeepTimer_Phase4_Backend.patch
 npm ci
 npm test

# Frontend repo kökünde
 git apply --check KeepTimer_Phase4_Frontend.patch
 git apply KeepTimer_Phase4_Frontend.patch
 npm ci
 npm test
 npm run build
```

Mevcut yerel değişikliklerle çakışırsa `--reject`/zorlamalı kısmi uygulama yerine farkları inceleyin. Android native proje bulunan kullanıcı ortamında başarılı build sonrasında mevcut Capacitor sync/APK akışı ve yukarıdaki cihaz testleri çalıştırılmalıdır.

## Bütün değişen ve eklenen dosyalar

### frontend

| Dosya | Durum | Gerekçe |
| --- | --- | --- |
| `capacitor.config.json` | Değişti | Android WebView alt sınırını mevcut build hedefiyle açıkça eşleştirme. |
| `docs/KEEP_TIMER_AI_CHANGELOG.md` | Değişti | Tarihli Phase 4 değişim ve test kaydı. |
| `docs/PHASE3_PERSONAL_SYNC.md` | Değişti | Tarihsel Phase 3 metnine güncel Phase 4 sözleşmesi yönlendirmesi. |
| `docs/PHASE4_STORE_INTEGRATION.md` | Yeni | Mimari, gerekçeler, testler, sınırlar ve tüm dosya envanteri. |
| `src/App.vue` | Değişti | Yerel store başlangıcını uygulama açılışına bağlama. |
| `src/components/layout/Navbar.vue` | Değişti | Hesap değişimini reactive kullanıcıdan gösterme ve standalone giriş bağlantısı. |
| `src/components/layout/SettingsDrawer.vue` | Değişti | Eski kullanıcı snapshot'ı yerine güncel store kullanıcısı. |
| `src/components/stopwatch/AddModal.vue` | Değişti | Async commit sonucuna göre oluşturma/başlatma; shared izin ve kapsam kontrolü. |
| `src/components/stopwatch/StopwatchCard.vue` | Değişti | Pause/delete sonucu başarılı olmadan başarı yan etkisi uygulamama. |
| `src/router/index.js` | Değişti | Mevcut ana sayfayı standalone için oturumsuz erişilebilir kılma. |
| `src/services/backendSync.js` | Değişti | Kullanıcı değişim olayı ve mevcut shared çağrılara isteğe bağlı scope guard aktarımı. |
| `src/stores/stopwatchController.js` | Yeni | Modlara göre atomik eylemler, lifecycle sync, izolasyon, liveQuery ve shared olaylar. |
| `src/stores/stopwatchController.test.js` | Yeni | Üretim controller üzerinde 21 entegrasyon testi. |
| `src/stores/stopwatchStore.js` | Değişti | Legacy kalıcılık yerine gerçek controller'ı kuran Pinia wrapper. |
| `src/stores/timerClock.js` | Yeni | Kalıcı anchor'dan çizim ve hedef geçişi; shared server dönüşümü. |
| `src/sync/personalOutbox.js` | Değişti | Açık terminal import korumaları ve cihaz Count-Up bildirim durumunun korunması. |
| `src/sync/personalSnapshot.test.js` | Yeni | 10 sayfalama, atomic import, tombstone ve scope testi. |
| `src/sync/personalSyncApi.js` | Değişti | Doğrulanmış sayfalı snapshot ve guarded kişisel bildirim yan etkileri. |
| `src/sync/personalSyncEngine.js` | Değişti | Pull işlemini sayfalı snapshot'a bağlama; mevcut lock/flush korunur. |
| `src/sync/personalSyncModel.js` | Değişti | Kimlik/revizyon/terminal durum doğrulayıcısı. |
| `src/sync/testSupport/fixtures.js` | Değişti | Mock sunucuda sayfalı okuma ve bildirim endpoint'leri. |
| `src/views/HomeView.vue` | Değişti | Async toplu eylem, store başlangıcı ve küçük sync durum metinleri. |
| `src/views/LoginView.vue` | Değişti | Mevcut standalone ana sayfaya geçiş. |
| `vite.config.js` | Değişti | Cache'lenmiş uygulamanın offline navigation fallback'i. |

### backend

| Dosya | Durum | Gerekçe |
| --- | --- | --- |
| `docs/KEEP_TIMER_AI_CHANGELOG.md` | Değişti | Tarihli Phase 4 değişim ve test kaydı. |
| `docs/PHASE4_PERSONAL_PAGES.md` | Yeni | Minimal backend okuma sözleşmesi ve eşzamanlılık sınırı. |
| `src/server.js` | Değişti | Eski endpoint üzerinde opt-in scope filtreli terminal/keyset okuma. |
| `test/personal-pages-http.test.js` | Yeni | Gerçek yerel HTTP ve mock Supabase ile pagination sözleşmesi testi. |

## 2026-09-27 — Shared regresyon düzeltmeleri (birleştirilmiş patch)

- `src/data/timerRepository.js`: shared önbellekte yerel bildirim teslim işareti (`sharedAlarmDelivered`) korunur.
- `src/stores/timerClock.js` ve `src/stores/stopwatchController.js`: cihazın bildirim teslim işareti sunucunun hedef zaman/durum bilgisinden ayrılır. Cihazda zaten tamamlanmış Countdown sırf yerel bildirim için yeniden sunucuya yazılmaz.
- Shared `deleted` socket olayı ve başarılı yerel shared DELETE, ilgili workspace cache kaydını geçersiz kılar; silme ilk GET ile yarışsa eski GET sonucu geri uygulanmaz.
- `src/stores/stopwatchController.test.js`: Astra tarafından 114 üzerine 8 shared fix ve 5 shared delete regresyon testi eklendi; **127 başarılı** sonucu Astra tarafından raporlandı. Bu sonuç kullanıcının yerel ortamında ayrıca doğrulanmalıdır.
- Backend sayfalı kişisel okuma patch’i değişmedi. Shared değişiklikleri ayrı backend SQL/migration gerektirmez.
- Standart `npm run build` kullanıcı ortamında, gerçek Android APK/Web Locks ve gerçek PostgreSQL eşzamanlılık testleri ayrıca doğrulanacaktır.

## 2026-09-27 — Son inceleme ve tam patch

Bu belgedeki önceki test sayıları tarihsel sonuçlardır. Son teslimde frontend **136/136**, backend **35 başarılı / 7 atlanan / 0 başarısız** sonucuna ulaştı. Son incelemedeki ek düzeltmeler, yeni dosyalar, build ortamı sınırı, temiz ZIP'e tam patch uygulaması ve değerlendirme için [PHASE4_FINAL_REVIEW.md](PHASE4_FINAL_REVIEW.md) esas alınmalıdır.
