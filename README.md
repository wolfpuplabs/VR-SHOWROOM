# VR Showroom &amp; Wolfpup Virtual Mall

Dua halaman WebXR berbasis [A-Frame](https://aframe.io) yang bisa dibuka langsung di browser
(desktop, HP, maupun headset VR) tanpa proses build.

| Halaman | Isi |
| --- | --- |
| `index.html` | Showroom VR Porsche 356B (model `assets/Porsche 356B.glb`) |
| `mall.html` | Mall 3D yang bisa dijelajahi jalan kaki: space ritel yang bisa disewa + produk tenant dengan pratinjau 3D &amp; AR |

## Wolfpup Virtual Mall (`mall.html`)

Mall dibangun sepenuhnya secara prosedural dari script di dalam satu file HTML — tidak ada
proses build, hanya dua dependensi dari CDN: A-Frame (dunia 3D) dan `model-viewer`
(pratinjau produk + AR).

**Denah lantai dasar**

- Koridor utama selebar 14 m dengan atrium terbuka dan air mancur di tengah
- **Blok A** (A1–A7) dan **Blok B** (B1–B7): unit toko 80–112 m² dengan etalase kaca, pintu masuk,
  papan nama, dan interior yang bisa dimasuki
- **Kios K1–K4**: kios 16 m² di tengah koridor
- Eskalator (dekoratif), papan direktori, bangku, dan tanaman koridor

**Product showcase + AR**

- Setiap toko yang sudah terisi tenant punya **booth produk** dan meja kasir di dalamnya —
  produknya berdiri sebagai model 3D sungguhan di atas display, bukan gambar
- Klik produk (di dunia 3D, dari daftar **Products**, atau dari panel unit) untuk membuka
  panel produk: pratinjau 3D yang bisa diputar, harga, deskripsi, dan spesifikasi
- Tombol **View in AR / Lihat di AR** memakai [`<model-viewer>`](https://modelviewer.dev)
  dan jalan di dua platform: **Android** lewat WebXR / Scene Viewer (`.glb`) dan
  **iPhone/iPad** lewat AR Quick Look (`.usdz`, atribut `ios-src`). Produk muncul di
  ruangan nyata dengan ukuran aslinya — gelas kopi 13 cm tetap 13 cm, Porsche tetap 4 m.
  Di desktop tombol AR otomatis disembunyikan dan diganti catatan
- Model produk ada di `assets/products/`: `.glb` (~420 KB) untuk web/Android dan
  `.usdz` (~980 KB) untuk iOS. Dibuat ulang lewat dua skrip:

  ```bash
  pip install trimesh numpy usd-core
  python3 tools/generate-product-models.py   # bikin .glb produk
  python3 tools/glb-to-usdz.py               # turunkan .usdz + miniatur Porsche 1:18
  ```

  Showroom A4 memakai `Porsche 356B.glb` yang sudah ada di repo, sekaligus jadi dua
  produk: mobilnya sendiri dan miniatur 1:18 yang diturunkan otomatis dari model itu
- Semua `.usdz` sudah Y-up, satuan meter, mandiri (tanpa berkas eksternal), dan memakai
  `UsdPreviewSurface` sesuai syarat AR Quick Look
- Kalau Quick Look tidak mau terbuka di iOS, biasanya soal MIME type `.usdz` di hosting.
  Berkas `_headers` di root sudah mengatur ini untuk Netlify / Cloudflare Pages

**Bahasa**

- Toggle **EN / ID** di header. Default **English**, pilihan tersimpan di `localStorage`
- Ganti bahasa ikut mengubah teks di dalam dunia 3D juga: papan unit, papan direktori,
  label produk, dan format harga

**Leasing / sewa space**

- Setiap unit punya status: `Tersedia` (hijau), `Dipesan` (biru), `Disewa` (merah) —
  warnanya terlihat langsung pada lis etalase, papan leasing 3D, daftar space, dan denah
- Klik etalase (atau tekan <kbd>E</kbd>) untuk membuka detail: luas, dimensi, harga sewa,
  service charge, dan fasilitas
- Form pengajuan sewa menghitung otomatis total kontrak, diskon durasi panjang (6–36 bulan),
  deposit 3 bulan, serta tanggal berakhirnya kontrak
- Pesanan disimpan di `localStorage` browser, bisa dibatalkan, diekspor ke JSON, atau direset
- Unit yang sudah disewa bisa dimasuki ke daftar tunggu

**Kontrol**

| Aksi | Desktop | Mobile / VR |
| --- | --- | --- |
| Jalan | `W` `A` `S` `D` / tombol panah | joystick kiri bawah |
| Lihat sekeliling | drag mouse | geser layar / gerakkan kepala |
| Interaksi (unit &amp; produk) | klik crosshair atau `E` | ketuk / gaze |
| Peta &amp; daftar space | `M` dan `L` | tombol di header |
| Tutup panel | `Esc` | tombol tutup |

Panel denah bisa diklik untuk berpindah lokasi, dan tombol **Kunjungi / Visit** pada daftar
space akan membawa kamera tepat ke depan unit yang dipilih. Sidebar punya dua tab:
**Spaces for rent** (unit yang disewakan) dan **Products** (katalog produk seluruh tenant).

## Menjalankan secara lokal

```bash
python3 -m http.server 8000
# lalu buka http://localhost:8000/mall.html
```

Membuka file lewat `file://` akan membuat model `.glb` gagal dimuat karena pembatasan CORS,
jadi gunakan server statis sederhana seperti di atas.

Untuk mencoba **AR di HP**, halaman harus diakses lewat **HTTPS** (atau `localhost`) —
Scene Viewer, WebXR, dan Quick Look menolak origin `http://` biasa. Cara tercepat: deploy
ke hosting statis apa pun (GitHub Pages, Netlify, Vercel) lalu buka `mall.html` dari HP.

## Auto-merge

`.github/workflows/auto-merge.yml` membuat **setiap PR ke `main` ter-merge otomatis
(squash) begitu semua check-nya hijau**. Workflow tidak pernah meng-checkout kode dari
PR — hanya memanggil API GitHub lewat `gh` — jadi aman dipakai dengan `pull_request_target`.

Alur kerjanya: dipicu saat PR dibuka/di-push, saat check suite selesai, atau manual lewat
**Actions → Auto-merge → Run workflow**. Kalau masih ada check berjalan, workflow menunggu
sampai 30 menit; kalau ada yang gagal, PR dibiarkan terbuka. PR yang tertinggal dari `main`
diperbarui dulu, PR konflik dilewati. Bila merge langsung ditolak (mis. `main` mewajibkan
review), workflow menyalakan auto-merge bawaan GitHub sebagai gantinya.

Dua prasyarat di **Settings** repo:

1. **General → Pull Requests → Allow auto-merge** — supaya auto-merge bawaan GitHub
   (termasuk fallback di atas) bisa dipakai
2. **Actions → General → Workflow permissions → Read and write permissions** — tanpa ini
   `GITHUB_TOKEN` tidak berhak melakukan merge

Pengecualian dan penyetelan (lihat blok `env` di file workflow):

| Perkara | Perilaku |
| --- | --- |
| Label `no-automerge` | PR itu dilewati auto-merge |
| PR draft | Dilewati sampai ditandai *ready for review* |
| PR dari fork | **Dilewati** (`ALLOW_FORKS: 'false'`). Menyalakannya berarti siapa pun yang membuka PR dari fork bisa menulis ke `main` |
| Metode merge | `MERGE_METHOD: squash` (bisa `merge` / `rebase`) |
| Batas tunggu check | `MAX_WAIT_MINUTES: '30'` |

## Struktur berkas

```
index.html                     showroom VR Porsche
mall.html                      mall + leasing + product showcase (satu file)
assets/Porsche 356B.glb        model showroom (dipakai juga oleh unit A4)
assets/products/*.glb          model produk tenant (web + AR Android)
assets/products/*.usdz         versi AR Quick Look untuk iPhone/iPad
assets/Porsche 356B.usdz       versi AR Quick Look untuk mobil showroom
_headers                       MIME type .usdz/.glb untuk Netlify / Cloudflare Pages
tools/generate-product-models.py  generator model produk (trimesh)
tools/glb-to-usdz.py              konverter .glb -> .usdz (usd-core)
.github/workflows/auto-merge.yml  auto-merge PR ke main
```
