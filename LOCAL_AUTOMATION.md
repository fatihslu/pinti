# Yerel, ücretsiz PİNTİ otomasyonu

Bu yöntem, Chrome/Puppeteer tabanlı toplayıcıyı doğrudan kendi bilgisayarında
çalıştırır. Bilgisayar açık ve oturum açık kaldığı sürece:

- Düşük Fiyat Radarı her saat başı bütün kategorileri yeniler.
- Amazon Çok Satanlar üç saatte bir yenilenir.
- Kurulu alarmlar her saat başından 15 dakika sonra kontrol edilir.

Bir kez PowerShell'i proje klasöründe açıp şunu çalıştır:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-pinti-startup.ps1
```

Bu yöntem yönetici izni istemez; PİNTİ kullanıcı oturumu açıldığında otomatik
başlar. Yönetici yetkisi olan bilgisayarlarda alternatif olarak
`install-pinti-task.ps1` ile Görev Zamanlayıcı kullanılabilir.

Ardından arayüz `http://localhost:3001` adresindedir. Servis günlükleri
`logs\pinti-service.log` dosyasına yazılır.

Amazon doğrulama/CAPTCHA isterse süreç bunu aşmaya çalışmaz; günlükte hata
olarak görünür. Gerekirse Amazon'u kendi Chrome pencerende açıp doğrulamayı
tamamladıktan sonra PİNTİ taramasını tekrar başlatabilirsin.
