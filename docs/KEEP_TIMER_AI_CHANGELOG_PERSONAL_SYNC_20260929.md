# 2026-09-29 — Kişisel senkronizasyon toparlanması

Kaynak: KeepTimer_Astra_Frontend.zip, cedf808bc193e6315ef00c81f22b8aeaa572aa85.
ZIP mevcut docs/KEEP_TIMER_AI_CHANGELOG.md dosyasını içermiyor. Bu ek kayıt,
bilinmeyen geçmişin üzerine yazmamak için ayrı dosyadır; mevcut ana changelog'a
birleştirilmesi gerekir. Önceki Phase 5 patch tabanı kullanılmadı.

- personalSyncApi: yalnız allowlist ve HTTP eşleşmesiyle üç kişisel hata kodunu tanır.
- personalSyncEngine: kayıt bazlı hatalarda bağımsız sayaçlar ilerler. Bilinmeyen
  403, şirket yetkisi, 401, ağ/timeout, 429 ve 502/503/504 bütün batch'i durdurur.
  Belirsiz 404 ve eski sürümde kalıcılaştırılmış belirsiz 404 aynı frozen istekle
  retry olur; gerçek PERSONAL_TIMER_NOT_FOUND otomatik başarı olmaz.
- personalOutbox: bozuk/yetim kayıt karantinaya alınır, başka kapsamın yerel
  kaydı değiştirilmez. Bloklu başın arkasındaki hiç gönderilmemiş son PUT
  birleştirilebilir; frozen body, mutation ID, sıralama ve son DELETE korunur.
- Çakışma incelemesi: flush başına tek tam snapshot; kayıt başına kalıcı 60 sn
  uzlaştırma beklemesi. Normal pull ayrı kalır. Yeni yerel DELETE kanıt incelemesini
  açar. Önceki güvenli tombstone uzlaştırmasının koşulları korunur.
- ACK kanıtı: aktif GET satırı ancak aynı sahiplik/şirket/UUID, beklenen revizyon+1,
  aynı mutation ID ve tam kanonik payload doğrulamasıyla geçmiş PUT'u sonuçlandırır.
  Backend'in normal duplicate-before-revision davranışı değişmez.
- Controller: kalıcı retryAt kullanılır; en az 1 sn aralıklı, görünür oturum başına
  en fazla üç zamanlanmış deneme. Offline/hidden/dispose/hesap değişiminde iptal.
  Focus/online/pageshow/visible veya açık Yeniden dene yeniden hak tanır.
  Bloklu son DELETE için kanıt kesintisi de aynı bütçe ve 60 sn cooldown ile denenir.
  Yetki engelleri zamanlanmaz. Web Lock güvenliği korunur; ikinci kuyruk yoktur.
- Home: hangi sayacın hangi işleminin durduğunu gösterir. Sunucu kaydını inceleme
  salt okunurdur. Ayrı açık onay, yeniden alınmış aynı sunucu kanıtı ve aynı yerel
  kuyruk/parmak izi olmadan hiçbir değişiklikten vazgeçilmez. Yokluk kanıt değildir.
  Yetim/izinsiz kayıtta sahte çözüm yok; tanı raporu istenir. Otomatik rebase yoktur.
- scripts/personal-sync-diagnostic.js: yalnız readonly IDB, takma kimlikler ve
  allowlist metadata; token/PIN/isim/UUID/body/HTTP gönderimi yoktur.

Regresyonlar: personalRecovery.test.js, personalDiagnostic.test.js,
stopwatchController.test.js, sharedControls.test.js. Eski HTTP sınıflandırma
testinin gerçek 404 fixture'ına yeni domain kodu ve tam snapshot alanları eklendi;
test kaldırılmadı. Standalone/shared/auth/migration değişmedi.

Son sayılar ve gerçek komut çıktıları teslimatın TEST_RAPORU.md ve logs/ klasöründedir.
Android E03/E04 ve production/PWA build bu kaynak paketiyle onaylanmış değildir.
