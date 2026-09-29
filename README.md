# VR Showroom &amp; Wolfpup Virtual Mall

Dua halaman WebXR berbasis [A-Frame](https://aframe.io) yang bisa dibuka langsung di browser
(desktop, HP, maupun headset VR) tanpa proses build.

| Halaman | Isi |
| --- | --- |
| `index.html` | Showroom VR Porsche 356B (model `assets/Porsche 356B.glb`) |
| `mall.html` | Mall 3D yang bisa dijelajahi jalan kaki: space ritel yang bisa disewa + produk tenant dengan pratinjau 3D &amp; AR |

## Wolfpup Virtual Mall (`mall.html`)

Tanpa proses build: data, UI, dan logika leasing ada di `mall.html`, sedangkan seluruh visual 3D
dibangun prosedural oleh `mall-world.js`. Dependensi CDN hanya A-Frame (dunia 3D),
`model-viewer` (pratinjau produk + AR), dan Google Fonts untuk signage.

**Denah lantai dasar**

- Atrium dua lantai: koridor marmer 14 m, mezanin dengan balustrade kaca, kolom batu,
  dan skylight berangka baja sepanjang mall
- **Blok A** (A1–A7) dan **Blok B** (B1–B7): unit toko 80–112 m² dengan portal etalase,
  kaca penuh, fascia menyala, dan interior yang bisa dimasuki
- **Kios K1–K4** berkanopi di garis tengah koridor, dua pulau taman dengan bangku, air mancur
  bertingkat, dan eskalator ke jembatan lantai 2 (lantai 2 sendiri belum dibuka)
- Plaza masuk dengan **kantor leasing** dan **direktori digital** (keduanya bisa diklik)

**Visual & rendering (`mall-world.js`)**

- **Pencahayaan**: lampu fisik + tone mapping ACES, image-based lighting dari environment map
  yang dirender saat mulai (refleksi nyata di marmer, kaca, dan logam), lampu koridor hangat,
  dan cove LED di bawah mezanin. Matahari hanya masuk lewat skylight: atap memproyeksikan
  bayangan sehingga rangka baja skylight menggambar pola garis di lantai, kolom, dan dinding
- **Siang & malam**: tombol ☀/☾ di header, atau **?** → Lighting (Auto / Day / Night).
  *Auto* mengikuti jam perangkat (siang 06.00–18.00). Malam memakai environment map sendiri,
  cahaya bulan dingin yang tetap membentuk pola skylight, langit berbintang dengan bulan,
  lampu interior lebih hangat, light shaft padam, dan lampu taman di plaza menyala.
  Pergantian dianimasikan ±1,6 detik
- **Material PBR prosedural**: marmer berurat dengan nat, granit, kayu oak, terrazzo, beton
  poles, plester, dan logam brushed — lengkap dengan roughness map dan normal map yang
  dibuat di kanvas saat loading. Tidak ada berkas tekstur yang diunduh
- **Shader kustom**: langit gradasi dengan matahari, air mancur beriak (dua normal map yang
  bergeser), light shaft additive, dan reticle lantai
- **Etalase**: fascia menyala dengan identitas tiap tenant (huruf, warna, lantai, dinding fitur),
  lis LED status, dan **hoarding leasing** di kaca unit kosong (FOR LEASE, luas, harga, CTA).
  Interior tenant berisi rak berstok, etalase kaca produk, dan meja kasir; unit kosong tampil
  sebagai shell beton dengan lampu kerja dan decal luas di lantai
- **Signage kanvas** untuk semua teks 3D (tajam, ikut ganti bahasa, tidak butuh font CDN A-Frame)
- **Hidup**: tetesan air mancur, anak tangga eskalator bergerak, spanduk bergoyang, produk berputar,
  pin hotspot melayang
- **Material PBR berlapis** (tier medium/high, `MeshPhysicalMaterial`): marmer lantai dengan
  urat *domain-warped* dua skala, dasar *honed* + lapisan **clearcoat** poles yang kilapnya
  dipecah peta noda/bekas pel (juga memecah pola ubin yang berulang); granit & terrazzo poles
  (terrazzo kini punya normal & roughness map dari serpih batunya), kayu berpernis, cat piano
  hitam, beton sealed, dan kain jok dengan **sheen**
- **Refleksi planar lantai** (tier high): koridor dirender ulang dari kamera cermin di
  setengah resolusi lalu disisipkan ke lapisan clearcoat marmer — Fresnel membuat pantulan
  kolom, etalase, dan lampu kuat di sudut miring; noda poles mengaburkannya lewat mipmap
- **Post-processing sinematik** (`mall-post.js`, tier medium/high), buffer HDR half-float:

  RenderPass (MSAA 4× di high) → **GTAO** (ambient occlusion + denoise Poisson) → **Bloom**
  → OutputPass (ACES + sRGB) → FXAA (medium) → **Grade**: kurva S filmic, split toning
  (bayangan teal, highlight hangat), vignette, aberasi kromatik halus di tepi, film grain

  Nilai grade & bloom ikut transisi siang↔malam (malam: kontras & bloom lebih kuat). Material
  menyala (LED, signage, lampu) dibalik dari kurva ACES di shader, sehingga warnanya tetap
  persis setelah tone mapping tetapi cukup "HDR" untuk memicu bloom. Kabut eksponensial tipis
  memberi perspektif udara di koridor 68 m. Di mode VR pipeline ini otomatis dilewati.
- **Performa**: semua geometri statis digabung per material (±60–220 draw call tergantung
  sudut pandang), bayangan kontak murah di bawah objek, dan tiga tier kualitas:

  | Tier | Dipakai otomatis untuk | Beda utama |
  | --- | --- | --- |
  | Low | perangkat memori kecil | pixel ratio 1, tanpa bayangan, light shaft, semburan air, clearcoat & post-processing |
  | Medium | tablet & HP | pixel ratio ≤ 1,5, bayangan 2K, clearcoat, GTAO ½ resolusi, bloom, FXAA, grade |
  | High | desktop | pixel ratio ≤ 2, bayangan 4K lembut, tekstur lantai 2K, refleksi planar, MSAA 4×, GTAO ¾ resolusi |

  Bayangan matahari/bulan dirender ke shadow map **statis**: dihitung sekali saat memuat dan
  saat siang/malam berganti, bukan tiap frame — itu yang membuatnya muat di tablet.

  Tier bisa dipaksa dari panel bantuan (**?** → Graphics); halaman dimuat ulang untuk menerapkannya.

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
| Jalan | **klik lantai** (reticle) · `W` `A` `S` `D` / panah | **ketuk lantai** · joystick kiri bawah |
| Lihat sekeliling | drag mouse | geser layar / gerakkan kepala |
| Interaksi (unit &amp; produk) | klik etalase / pin, atau `E` saat hover | ketuk / gaze (VR) |
| Peta &amp; daftar space | `M` dan `L` | tombol di header |
| Tutup panel | `Esc` | tombol tutup |

Reticle di lantai berwarna putih kalau titiknya bisa dicapai lurus, abu-abu kalau terhalang.
Tujuan dekat ditempuh dengan berjalan mulus; tujuan jauh (tombol **Kunjungi / Visit**, klik
denah) memakai fade singkat lalu kamera langsung menghadap unitnya. Sidebar punya dua tab:
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
mall.html                      data, UI, leasing, product showcase, navigasi
mall-world.js                  renderer 3D: material, pencahayaan, arsitektur, toko, FX
mall-post.js                   post-processing (ES module): GTAO, bloom, grading sinematik
vendor/three/                  pass post-processing three.js (MIT) + shim ke THREE milik A-Frame
assets/Porsche 356B.glb        model showroom (dipakai juga oleh unit A4)
assets/products/*.glb          model produk tenant (web + AR Android)
assets/products/*.usdz         versi AR Quick Look untuk iPhone/iPad
assets/Porsche 356B.usdz       versi AR Quick Look untuk mobil showroom
_headers                       MIME type .usdz/.glb untuk Netlify / Cloudflare Pages
tools/generate-product-models.py  generator model produk (trimesh)
tools/glb-to-usdz.py              konverter .glb -> .usdz (usd-core)
.github/workflows/auto-merge.yml  auto-merge PR ke main
```
