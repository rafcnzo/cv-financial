# Serah-terima implementasi KangCatat

Workspace Windows PowerShell: `C:\laragon\www\cv-financial`. User meminta implementasi rencana PDF sampai rilis uji tertutup foto/AI. Lanjutkan pekerjaan yang belum selesai; jangan ulang eksplorasi blueprint. Gunakan skill `C:\Users\hp\.codex\skills\fokus-perbaikan-hemat-token\SKILL.md`. Jangan membaca `.env`, `.dev.vars`, credential atau lockfile kecuali konfigurasi memang memerlukannya; jangan pernah menampilkan secret. Jangan spawn agent kecuali user meminta. User meminta berhenti bila sisa usage akun mencapai 3%, lalu memberikan prompt lanjutan; tool tidak dapat membaca persentase itu. **User terakhir menyatakan usage sudah 3% dan meminta berhenti. Agent berhenti setelah memperbarui serah-terima ini. Model berikutnya hanya melanjutkan setelah user menempel prompt lanjutan.**

## Keputusan pengguna

- Rilis pertama mencakup Android Kotlin native, transaksi manual, foto/PDF, ekstraksi Claude, inbox dan konfirmasi. Email/rules/reminders/VPS adalah fase berikutnya.
- Undangan terbatas, IDR integer, UTC disimpan/WIB ditampilkan, multi-user tanpa berbagi, double-entry append-only.
- Infrastruktur wajib gratis; Claude maksimal Rp100.000/bulan; dokumen asli disimpan satu tahun.
- Domain `kangcatat.biz.id`, repo kosong disediakan user `https://github.com/rafcnzo/cv-financial.git`. Remote origin sudah disetel. Source belum dikomit/push pada saat dokumen ini dibuat.
- User memiliki Cloudflare dashboard dan Claude API key. Key belum dikirim di chat; user diminta isi `apps/api/.dev.vars` yang ignored Git. Jangan menganggap key sudah terisi.
- User mengizinkan perpindahan DNS setelah audit aman, OTP via Resend Free, GitHub privat dan cadangan harian terenkripsi ke R2.

## Yang sudah ada

- Monorepo npm workspaces, Hono Workers, Zod kontrak, SQL PostgreSQL 17, Kotlin Compose Android.
- API `/v1`: Google/OTP, refresh rotation/reuse revocation, undangan, accounts/contacts/reports/history, templates manual/split/talangan/utang/cashback/opening, reversal, drafts edit/confirm/ignore, upload/presign/finalize/hash+MIME+PDF validation, devices.
- RLS dan composite FK; nominal JSON string, bigint SQL. Constraint trigger minimal dua baris/total nol. `created_txid` melarang menambah baris pada jurnal yang sudah selesai. Runtime SQL postgres.js; katalog Drizzle tersedia untuk tooling, jangan menginstansiasi Drizzle pada koneksi raw yang sama karena ia mengubah serializer JSON (sudah ditemukan lewat tes HTTP).
- Upload bertanda tangan diarahkan ke `staging/`; finalize memverifikasi bytes dan menyalin ke key asli tersegel sehingga PUT URL yang masih berlaku tidak bisa mengganti bukti asli.
- Cloudflare Workflow Claude/validasi/draft/deteksi duplikat/FCM; maintenance retensi dan pemulihan dispatch tiap jam. Reservasi biaya mencegah retry yang tak diketahui membuka kuota.
- UI Android login, riwayat/laporan, akun/kontak, form manual/draft, split, pelunasan, pembalik, scan ML Kit/upload. Token tersimpan AES-GCM Android Keystore. Refresh dan retry HTTP tersedia.
- GitHub CI check/build, encrypted backup workflow (disabled sampai `BACKUPS_ENABLED=true`), scripts migrasi/admin/export/delete/restore, README setup/runbook.

## Fakta environment dan hasil terakhir

- Node 26.6.0, npm 11.18.0; CI memakai Node 24. Docker Desktop berjalan.
- PostgreSQL Docker `cv-financial-postgres-1`, database `cv_financial`, owner `cv_owner`, password demo lokal `local-only`, port 5432. Migration 0001–0004 sudah diterapkan. `cv_runtime` mewarisi `cv_app`, `cv_auth` mewarisi `cv_system`; keduanya password demo lokal `local-only`.
- Perintah tes: `$env:TEST_DATABASE_URL='postgres://cv_owner:local-only@localhost:5432/cv_financial'; npm test`. Hasil terakhir **21 tes lulus** termasuk RLS, composite FK, imbalance, immutable ledger, concurrent confirmations/idempotence, OTP attempts, refresh reuse, per-user dedupe dan sealed upload.
- `npm run check` lulus; `npm run dry-run -w @cv/api` lulus, bundle sekitar 1.85 MiB. `npm audit` setelah update Drizzle/Vitest menunjukkan nol vulnerability.
- `DATABASE_URL` lokal yang sama + `npx tsx scripts/restore-check.ts` berhasil dump/restore transaksi seimbang ke DB disposable dan memverifikasi saldo.
- Toolchain portable sudah terpasang `.tools/jdk` (JDK17), `.tools/android-sdk` (SDK35), `.tools/gradle`. Gradle wrapper dibuat di `apps/android`; SDK download awal gagal TLS lalu berhasil resume. Android Studio GUI belum dipasang.
- Build APK awal gagal karena manifest debug cleartext konflik; sudah diperbaiki memakai `tools:replace`. Build ulang melalui `scripts/build-android.ps1` berjalan pada exec session **8251**; hasil akhirnya perlu diperiksa. Target `apps/android/app/build/outputs/apk/debug/app-debug.apk`. `adb devices` terakhir tidak menemukan perangkat; pengujian UI nyata belum dilakukan.
- Cloudflare Wrangler OAuth **berhasil login**. R2 sudah diaktifkan user; tiga bucket **sudah dibuat**: `cv-financial-dev`, `cv-financial-beta`, `cv-financial-backups`, semuanya Standard. Lifecycle staging dev/beta satu hari dan prefix database/ backup tujuh hari sudah ditambahkan.
- Hyperdrive IDs di `wrangler.jsonc` masih placeholder nol. Neon belum tersedia. Neon plugin ditemukan dan disarankan tetapi **belum terkonfirmasi terpasang/terhubung**; jangan menganggap tersedia. R2 S3 key, Google OAuth, Resend, Firebase dan Claude secret belum diverifikasi. API belum dideploy.
- Nameserver domain masih Domainesia (`nsx1.domainesia.com`, `nsx2.domainesia.com`); audit MX/A/TXT belum lengkap (resolver lokal SERVFAIL). Tidak ada DNS yang diubah.

## Pekerjaan prioritas berikutnya

1. Tunggu/periksa build Android dan perbaiki error nyata sampai `assembleDebug` lulus. Lanjutkan tes UI/emulator bila tersedia; jangan mengklaim sideload/login/capture nyata telah teruji.
2. Periksa bug rilis: retry ambigu setelah transaksi sukses, upload crash recovery, quota/cost guards, FCM login registration, pagination riwayat (UI saat ini memuat 100 entri saja), dan parsing PDF/hash yang mungkin melebihi CPU Workers Free 10 ms. Performa cloud adalah gate yang belum teruji.
3. Rapikan konfigurasi environment dan helper sesuai README; pastikan secret tidak masuk Git. Buat commit konkret dan push ke origin yang diberikan user setelah check/tests/build lulus. Git credential helper `manager` tersedia; `git ls-remote origin` berhasil dan kosong, write authorization belum diuji.
4. Buat/tautkan Neon hanya setelah koneksinya nyata tersedia. Terapkan migrations dengan owner, buat restricted logins, Hyperdrive cache-disabled, isi bindings dan secret, lalu deploy beta dan uji real flow. Jangan memakai owner DB untuk Worker.
5. Aktifkan Google OAuth/Resend/FCM serta Claude workspace cap dan konversi USD konservatif <=Rp100.000. Gunakan secret lokal/dashboard, jangan minta key di chat.
6. Cadangan nyata R2/GitHub encryption+restore masih membutuhkan secrets/workflow activation. Local dump/restore sudah diuji. Set billing hard stop GitHub/Cloudflare sesuai kuota gratis.
7. Update dokumen ini dengan hasil akhir dan pekerjaan tersisa sebelum serah-terima. Jangan menyatakan seluruh proyek selesai bila aktivasi cloud/performa/flow nyata belum lulus.

## Status verifikasi 2026-10-13

- `scripts/build-android.ps1` → `assembleDebug` BUILD SUCCESSFUL; APK debug 13,6 MB. Belum diuji di perangkat/emulator.
- `npm run check`, `npm test` (21 lulus, DB Docker lokal) dan `dry-run` Worker lulus.
- Pemindaian secret pada file yang di-commit bersih. PDF blueprint tidak ikut commit.
- Belum dikerjakan: review bug rilis (butir 2 di atas), Neon/Hyperdrive, deploy, Google/Resend/FCM, DNS, uji CPU Workers Free.

## Perubahan paling akhir

- Default batas R2 dokumen menjadi **2 GiB per environment**, sehingga dev+beta maksimal 4 GiB; backup cap **3 GiB**. Script backup memangkas salinan lama sebelum upload (tetap menyimpan backup terbaru) lalu memastikan total kapasitas. Lifecycle backup tujuh hari sudah aktif.
- Template `.dev.vars.example` reserve AI per percobaan menjadi 0.02 USD; file `.dev.vars` aktual tidak ditimpa karena mungkin sudah diisi user. Review konsistensi harga/model/reserve sebelum aktivasi cloud.
- Koreksi UI: transaksi yang sudah tersimpan menutup form sebelum reload untuk menghindari duplikasi saat reload gagal; pembacaan file kompatibel Android 8; login Google mendaftarkan token FCM.
- README, HANDOFF, helper configure-cloud, backup pruning dan restore-check sudah dibuat. Check/tests terakhir lulus sebelum beberapa perubahan helper terakhir; jalankan check/test yang relevan lagi setelah melanjutkan. Belum ada commit atau push GitHub.
