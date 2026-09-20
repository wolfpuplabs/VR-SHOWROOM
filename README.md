# VR Showroom &amp; Wolfpup Virtual Mall

Dua halaman WebXR berbasis [A-Frame](https://aframe.io) yang bisa dibuka langsung di browser
(desktop, HP, maupun headset VR) tanpa proses build.

| Halaman | Isi |
| --- | --- |
| `index.html` | Showroom VR Porsche 356B (model `assets/Porsche 356B.glb`) |
| `mall.html` | Mall 3D yang bisa dijelajahi jalan kaki, lengkap dengan space ritel yang bisa disewa |

## Wolfpup Virtual Mall (`mall.html`)

Mall dibangun sepenuhnya secara prosedural dari script di dalam satu file HTML — tidak ada
dependensi selain A-Frame dari CDN.

**Denah lantai dasar**

- Koridor utama selebar 14 m dengan atrium terbuka dan air mancur di tengah
- **Blok A** (A1–A7) dan **Blok B** (B1–B7): unit toko 80–112 m² dengan etalase kaca, pintu masuk,
  papan nama, dan interior yang bisa dimasuki
- **Kios K1–K4**: kios 16 m² di tengah koridor
- Eskalator (dekoratif), papan direktori, bangku, dan tanaman koridor

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
| Interaksi | klik crosshair atau `E` | ketuk / gaze |
| Peta &amp; daftar space | `M` dan `L` | tombol di header |
| Tutup panel | `Esc` | tombol tutup |

Panel denah bisa diklik untuk berpindah lokasi, dan tombol **Kunjungi** pada daftar space
akan membawa kamera tepat ke depan unit yang dipilih.

## Menjalankan secara lokal

```bash
python3 -m http.server 8000
# lalu buka http://localhost:8000/mall.html
```

Membuka file lewat `file://` akan membuat model `.glb` gagal dimuat karena pembatasan CORS,
jadi gunakan server statis sederhana seperti di atas.
