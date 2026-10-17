# Faz 7 revizyonu — frontend ve gerçek Android

/password-login, /account/activate, /account/reset, /account/security Vue/Tailwind CSS 4 ekranları mevcut tema token'larını kullanır. Şirket PIN ekranı korunur. Satış ekranı yeniden tasarlanmaz; Agent müşterinin ilk parolasını belirlemez. Superadmin kullanıcı/şirket yönetimi aynı URL'lerin MFA korumalı karşılıklarını kullanır. CSRF eklenir, PIN Superadmin yaratma genel formdan çıkarılır. DELETE uygun şirket hesabını devre dışı bırakır; fiziksel silmez.

## Oturum ve stale MFA

Mevcut backendSync auth mutation lock, generation/marker, RAM access ve session/user event'leri kullanılır. Pending MFA profile/access/refresh/storage yetkisi yaratmaz. Verify VE resend aynı generation/marker/challenge/context'i işlemden önce ve cevap sonrasında doğrular. B login, logout veya farklı context A challenge'ını stale yapar; geç A cevabı B kimliğini değiştiremez. Generic passwordAuthRequest listesinden resend çıkarılmıştır; bileşen bağlı resendPasswordMfa yolunu ve pending periyodik kontrolünü kullanır.

Backend ayrıca HttpOnly pre-auth nonce + mevcut refresh-cookie hash'ini challenge'a bağlar. Nonce auth session değildir. Frontend kontrolü tek güvenlik katmanı sayılmaz.

Link fragment'ı router başlamadan RAM'e alınır ve history.replaceState ile temizlenir. Token DOM/query/storage/log'a yazılmaz. GET yan etkisiz, tüketim POST. Reload token'ı kaybeder. Başka hesabın linki mevcut session'ı o hesaba taşımaz. Kendi reset/aktivasyonu server-derived userId eşleşirse local auth'u kapatır. Password-change/revoke-all yalnız halen aynı marker için scope'u kapatır; IndexedDB timer/outbox silinmez. Yeni tab çerezini silmemek için password-change cevabı cookie temizlemez; eski DB session revoke edilmiştir.

loginReady premium hakkı değildir. Expired Individual login olabilir, entitlement olmadan ücretli özellik/private yazma açılamaz. Account switch eski entitlement/outbox'ı yeni kullanıcıya taşımaz; offline kuralları korunur.

## Android

Güncel ZIP gerçek MainActivity.java, KeepTimerAuthPlugin.kt, AuthEngine.kt, NativeAuthHttp.kt, KeystoreCredentialStore.kt, manifest, backup kuralları ve Capacitor config içerir. Auth Kotlin ile yazılmıştır; hayali Java uygulaması eklenmedi.

Gerçek @PluginMethod passwordLogin({email,password}) mevcut FIFO bridge, engine monitor, sabit native HTTPS transport ve KeystoreCredentialStore'u yeniden kullanır. Payload exact-key/tip/boyut kontrolü vardır; parola çağrı datasından çıkarılır, loglanmaz/kalıcı saklanmaz. Sabit /auth/native/passwordLogin kullanılır; arbitrary URL/header proxy yoktur. Privileged/MFA reply reddedilir, yalnız worker session store'a kurulur. PublicAuthReply refresh'i JS'ye vermez. AES-GCM/AndroidKeyStore, AtomicFile/tombstone, backup/transfer exclusions ve logging-none korunur.

Kesin 401 refresh eşleşen credential'ı temizler; geçici 503 erişimi askıya alır ama credential'ı korur. Logout yalnız eşleşen session'ı temizler, geç A logout B'yi silemez. PIN worker/manager mevcut fixed endpoint'i kullanır. Native method eksikse güvenli başarısızlık vardır; web fetch/localStorage-secret fallback yoktur. Privileged login web-only; aktivasyon/reset/security güvenli web üzerinden tamamlanır.

JS native kaynak kontrat testleri çalışır. Kotlin engine JUnit kaynak testleri eklidir; ZIP'te Gradle wrapper/build/settings yoktur. Bu nedenle Kotlin derleme veya gerçek cihaz çalışması kanıtlanmamıştır. Gradle/SDK/cihaz ve backend native oturum testi kabul kapısıdır; JS/mock native PASS diye sunulmaz.

## UI ve CSP

Auth yolları no-store; PWA runtimeCaching boş, auth navigasyonları denylist içinde. Vercel auth API/sayfaları no-store/no-referrer. Production CSP unsafe-inline/eval eklenmeden korunur.

Vue testleri gerçek bileşeni derleyerek label/autocomplete/focus, klavye submit, parola görünürlük, error/status ve MFA pending davranışını kontrol eder. Test renderer gerçek tarayıcı değildir. Teslim UI önizlemesi test-renderer DOM + derlenmiş CSS ile login/MFA/activation/reset/security durumlarını 360/390/768/1280 px açık/koyu gösterir. Gerçek overflow, ekran okuyucu, kontrast, mobil klavye, tarayıcı ve Android link kontrolleri ayrıca gerekir; screenshot veya browser PASS iddiası yoktur.

Ekran değişimi ve unmount ayrıca uiEpoch artırır. Login, verify, resend ve session yönetiminin geç cevapları yeni ekrana notice, loading, pending state veya yönlendirme yazamaz. Verify completion hem güncel epoch hem aynı pending challenge nesnesini ister. Bu revizyon orijinal Faz 7 frontend patch’inin üzerine uygulanır; önceki tam replacement ile birlikte uygulanmaz.

## 16 Ekim cihaz MFA güncellemesi

Güncel ZIP üzerine ayrı device-mfa frontend patch’i uygulanır. Önceki güvenlik patch’leri yeniden uygulanmaz. Web parola giriş ekranı status endpoint’iyle güvenli cookie bağlamını hazırlar, reload/pageshow/online/visibility dönüşlerinde durumu sunucudan alır. Sayaçlar serverNow farkı + performance.now ile yalnız görsel tahmindir; kod yetkisi/tarihi/attempt/deviceId istemciden gönderilmez. İlk OTP 120 saniye, resend 60 saniye bekleme, 3/15 dakika gönderim, resend kalan süre +30 saniye ve 6 yanlışta bu bağlama 10 dakika kilit yeni sözleşmedir. Eski dokümandaki 10 dakika OTP/5 yanlış deneme bu akış için geçerli değildir.

1–5 yanlışta kalan hak gösterilir; altıncıda Türkçe uyarı, mm:ss ve Giriş ekranına dön vardır. Dönüş DB kilidini kaldırmaz. Süre sıfırlansa bile server kilidi kaldırmadan kontrol açılmaz. Expired yeni parola girişini sunar. Send quota son canlı kodun doğrulanmasını engellemez. Pending/unknown/rejected teslimat başarı sayılmaz; durum sorgusu yeniden denenebilir. Kod yalnız accepted ise doğrulanır. API 15 saniyelik timeout ile sonsuz loading önlenir; timeout sonucu bilinmiyor olarak açıklanır.

Generation/marker hem HTTP hem JSON okumasından sonra kontrol edilir. Aynı güvenlik ekranında hesap değişirse session listesi ve MFA UI verileri temizlenir; önceki async response yeni hesaba uygulanmaz. Verify/resend op UUID’leri ağ belirsizliğinde RAM’de aynı challenge için korunur; status aynı challenge’ı sürdürür. Hassas cookie/token/OTP browser storage’a yazılmaz. Başarılı MFA mevcut role paneline yönlendirir. Tailwind 4, açık/koyu renk değişkenleri, PIN ekranı ve yönetim ekranlarının tasarımı korunur.

Native privileged MFA eklenmez. Güncel frontend ZIP’inde native Android kaynak ağacı yoktur; bridge mock testleri native derleme/cihaz kanıtı değildir. Gerçek responsive/PWA/çoklu sekme/keyboard/screen-reader ve Vercel Secure cookie davranışı staging tarayıcısında ayrıca doğrulanmalıdır.
