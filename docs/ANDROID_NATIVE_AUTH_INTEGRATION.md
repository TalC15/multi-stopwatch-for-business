# Android native auth — belirsiz login/storage sonucu

`KeystoreCredentialStore.replace()` credential'ı commit ettikten sonra verification
`read()` geçici storage/Keystore hatası verebilir. Bu durumda
`AUTH_STORAGE_UNAVAILABLE`, HTTP-benzeri `status=503` ve `indeterminate=true`
korunur; JS'ye login başarısı veya access token dönmez. Yeni credential diskte
bulunabilir. Eski credential'ın kesin korunduğu varsayılmamalıdır.

**Indeterminate login/storage sonucunda native session state uzlaştırılmadan
socket/sync/yeni authenticated scope başlatılmamalı.**

Sonraki frontend entegrasyonu native `getSessionState()` sonucunu beklenen session
marker'ıyla uzlaştırmalı; bu metadata authentication kanıtı değildir. Uyumlu session
için başarılı refresh ile access token RAM'e alınmadan yeni authenticated kapsam
başlatılmamalıdır. State okuması da geçici hata verirse uzlaştırma tamamlanmış sayılmaz.
Secret silme, plaintext fallback veya otomatik rollback uygulanmaz.

Bu aşama frontend routing/socket/sync entegrasyonunu uygulamaz.
