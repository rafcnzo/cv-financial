# KangCatat / cv-financial

Aplikasi Android Kotlin untuk pencatatan keuangan IDR dengan inbox draft AI. Setiap konfirmasi menghasilkan jurnal berpasangan; saldo tidak dihitung dari draft. Domain: `kangcatat.biz.id`. Repository: `rafcnzo/cv-financial`.

## Implementasi

- API Hono Workers dengan autentikasi Google/OTP Resend, undangan, JWT 15 menit, sesi 30 hari, rotasi refresh token dan pencabutan saat token lama digunakan lagi.
- PostgreSQL: isolasi RLS, relasi komposit per pengguna, trigger jurnal seimbang, larangan modifikasi/penambahan baris jurnal setelah tercatat, saldo awal melalui equity, pembalik, dan konfirmasi draft atomik/idempoten.
- Unggah R2 langsung dengan URL singkat, verifikasi hash/MIME/halaman PDF, salinan dokumen tersegel, kuota, reservasi biaya, Workflow Claude, inbox edit/split/konfirmasi, deteksi duplikat, FCM, retensi satu tahun.
- Android Compose: login, akun, kontak, input manual, riwayat, laporan bulanan, kamera/pemindai ML Kit, unggah PDF/foto, inbox, koreksi draft dan tautan pelunasan.
- CI API/Android dan cadangan PostgreSQL terenkripsi ke R2.

Jalur email, aturan klasifikasi otomatis, pengingat talangan, dan perpindahan VPS mengikuti fase berikutnya. Aktivasi layanan cloud memerlukan akun serta konfigurasi pada petunjuk di bawah.

## Jalankan lokal

Gunakan Node 24+ dan Docker Desktop. Database contoh hanya untuk komputer lokal.

```powershell
npm ci
docker compose up -d
$env:DATABASE_URL='postgres://cv_owner:local-only@localhost:5432/cv_financial'
npm run db:migrate
npm run db:local
npm run invite -- email-anda@example.com
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
# Isi JWT_SECRET, OTP_SECRET, Google/Resend dan kredensial R2.
npm run dev
```

`apps/api/.dev.vars` sudah dibuat pada komputer implementasi. Jangan menimpa file itu jika sudah mengisi key. File ini diabaikan Git. Role `cv_runtime` hanya mewarisi `cv_app`; role `cv_auth` hanya mewarisi `cv_system`. Koneksi pemilik database digunakan untuk migrasi/administrasi, tidak digunakan Worker.

```powershell
npm run check
$env:TEST_DATABASE_URL=$env:DATABASE_URL
npm test
npm run dry-run -w @cv/api
```

Tes integrasi tidak berjalan bila `TEST_DATABASE_URL` tidak tersedia; CI selalu menyediakannya. Jangan arahkan tes ke database pengguna nyata.

## Android

Untuk memasang JDK 17, Android SDK 35 dan Gradle secara lokal tanpa menyimpan binari di Git:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1
powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1
```

APK debug: `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Emulator memakai `http://10.0.2.2:8787`; perangkat fisik dapat memakai `adb reverse tcp:8787 tcp:8787` dan build dengan `-PAPI_BASE_URL=http://127.0.0.1:8787`. HTTP hanya diizinkan pada build debug. Build release harus memakai HTTPS.

Konfigurasi non-secret Android diberikan melalui properti Gradle `API_BASE_URL`, `GOOGLE_WEB_CLIENT_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_API_KEY`. Firebase API key Android bukan Claude API key. Jangan masukkan secret backend ke APK.

Untuk Google: buat OAuth client Android untuk package `id.biz.kangcatat` dan SHA-1 sertifikat build, serta client Web yang digunakan oleh backend dan `GOOGLE_WEB_CLIENT_ID`. Untuk FCM: daftarkan package pada Firebase, isi opsi aplikasi dan service-account backend. Android 8+ dengan Google Play services diperlukan untuk scanner, Google Sign-In dan FCM.

## Aktivasi cloud

1. Buat Neon PostgreSQL 17 region Singapura, database pengembangan dan beta terpisah. Jalankan migration dengan koneksi pemilik. Buat dua login non-superuser dengan password kuat, lalu berikan `cv_app` ke login API dan `cv_system` ke login autentikasi. Jangan beri `cv_admin`, kepemilikan tabel atau `BYPASSRLS` kepada keduanya.
2. Buat dua konfigurasi Hyperdrive **cache disabled** per environment untuk kedua login tersebut. Ganti UUID placeholder di `apps/api/wrangler.jsonc`. Gunakan endpoint Neon langsung, bukan pooler Neon tambahan.
3. R2: gunakan bucket `cv-financial-dev`, `cv-financial-beta`, `cv-financial-backups`. Token S3 runtime dibatasi ke bucket dokumen. Pasang lifecycle satu hari pada prefix `staging/`; objek asli dihapus maintenance setelah `retention_until`. Batasi bucket cadangan dengan expiry tujuh hari.
4. Resend: verifikasi subdomain pengirim pada DNS yang saat ini aktif; nameserver tidak perlu dipindahkan untuk OTP. Isi `RESEND_API_KEY` dan `RESEND_FROM`. Login hanya menerima email dalam tabel `invitations`.
5. Claude: isi `CLAUDE_API_KEY`, buat workspace proyek dan set batas USD konservatif agar total tagihan termasuk pajak/kurs tidak melampaui Rp100.000. `AI_MONTHLY_LIMIT_USD=5` adalah default sementara, bukan jaminan kurs. Tarif token dan reserve biaya harus cocok dengan model yang dipilih. Kegagalan/retry menyisakan reserve bulan berjalan agar tagihan tak diketahui tidak membuka kuota tambahan.
6. Isi secret Wrangler dari file lokal menggunakan `scripts/configure-cloud.ts`; script menolak placeholder. Jalankan `npm run deploy:beta` hanya setelah seluruh binding dan secret siap. Pengukuran CPU pada Workers Free menjadi syarat uji tertutup; parsing/hash PDF maksimal 10 MB belum menjamin CPU di bawah 10 ms tanpa pengukuran cloud nyata.

Kapasitas aplikasi membatasi reservasi dokumen pada 2 GiB per environment (4 GiB untuk dev+beta) dan database 400 MiB (batas Neon Free 0,5 GB). Cadangan dibatasi 3 GiB dan salinan tertua dipangkas sebelum batas terlampaui. Pantau **total akun R2** termasuk file di luar aplikasi, request, operasi R2 dan kuota GitHub. Paket berbayar/overage harus tetap dimatikan. Bila batas tercapai, unggahan ditolak; transaksi manual tetap tersedia.

## API

Semua route memakai prefix `/v1`; route selain autentikasi membutuhkan bearer access token. Mutasi keuangan dan unggahan membutuhkan `Idempotency-Key` 8â€“128 karakter. Retry harus memakai key dan payload yang sama; key berbeda dengan payload identik dapat mewakili transaksi baru.

| Route | Perilaku |
|---|---|
| `POST /auth/google`, `/auth/otp/request`, `/auth/otp/verify` | Login pengguna undangan |
| `POST /auth/refresh`, `/auth/logout` | Rotasi token / cabut sesi |
| `GET /accounts`, `/contacts`, `/transactions`, `/reports` | Saldo, piutang/utang, riwayat, laporan per rentang UTC |
| `POST /accounts`, `/contacts` | Tambah rekening atau kontak (akun piutang/utang dibuat bersama) |
| `POST /transactions`, `/transactions/:id/reverse` | Catat manual / pembalik |
| `POST /uploads`, `/uploads/:id/complete` | Tiket PUT R2 / verifikasi dan antrekan ekstraksi |
| `GET /documents`, `/documents/:id/url`, `/drafts` | Status dokumen, bukti asli, inbox |
| `PATCH /drafts/:id` | Simpan koreksi dengan versi optimistik |
| `POST /drafts/:id/confirm`, `/drafts/:id/ignore` | Konfirmasi atomik atau abaikan |
| `POST /devices` | Daftarkan token notifikasi |

Nominal JSON berupa string integer positif; baris jurnal di respons berisi nominal bertanda. Template transaksi memiliki `kind`, `amount`, `accountId`, `counterpartAccountId` (atau `allocations` untuk split), `occurredAt` ISO 8601, `description`, serta `settlesEntryId` opsional. Konfirmasi/koreksi draft menerima `{version, transaction}`. Saldo awal masuk `opening`; transfer, talangan, pinjaman dan saldo awal tidak masuk laporan pemasukan/pengeluaran.

## Cadangan, ekspor, dan penghapusan

Aktifkan workflow backup lewat variable GitHub `BACKUPS_ENABLED=true`. Isi secret `BACKUP_DATABASE_URL`, `AGE_RECIPIENT` (public recipient), `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`, serta variable `R2_ENDPOINT` dan `R2_BACKUP_BUCKET`. Simpan **private key age di luar GitHub**. Koneksi backup harus melihat semua pengguna; verifikasi jumlah data pada latihan restore. Cadangan database tidak menduplikasi dokumen R2.

```bash
age --decrypt -i private-key.txt database.dump.age > restore.dump
psql "$RESTORE_DATABASE_URL" -f db/roles.sql
pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-acl restore.dump
```

Restore ke database baru; siapkan role lewat `db/roles.sql` sebelum restore, lalu buat login/grant runtime dan cek entri serta saldo sebelum mengganti koneksi. Jangan menimpa database aktif selama latihan restore. Latihan lokal: `npx tsx scripts/restore-check.ts` dengan `DATABASE_URL` lokal.

`npm run export:user -- UUID` mengekspor data ke folder TEMP dengan koneksi owner. Untuk hapus pengguna: ekspor manifest, hapus semua objek R2 dengan prefix UUID pengguna, kemudian set `CONFIRM_DELETE_USER=UUID` dan jalankan `npm run delete:user -- UUID`. Hapus email undangan juga bila pengguna tidak boleh mendaftar kembali. Secret session/OTP dan backup perlu ditangani sesuai kebijakan retensi; data cadangan kedaluwarsa setelah tujuh hari.

## Fase berikutnya

Email memakai subdomain `ingest.kangcatat.biz.id` setelah seluruh record DNS diekspor dan disalin. Nameserver saat eksplorasi masih milik Domainesia; audit A/MX/TXT belum lengkap karena resolver mengembalikan SERVFAIL. Jangan mengganti nameserver sebelum audit selesai. Bila perpindahan gagal, implementasikan adapter inbound Resend pada subdomain atau alamat `.resend.app`.

Aturan klasifikasi, saran pelunasan, pengingat, adapter Node/job runner VPS dan migrasi komersial dikerjakan setelah rilis foto/AI lolos pengujian cloud. SQL migration adalah sumber skema dan constraint; katalog Drizzle hanya memetakan tabel untuk tooling.
