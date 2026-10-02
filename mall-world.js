/* =====================================================================
   WOLFPUP VIRTUAL MALL — world renderer
   ---------------------------------------------------------------------
   Seluruh visual 3D mall dibangun di sini langsung dengan three.js (yang
   dibawa A-Frame): tekstur PBR prosedural, image-based lighting, geometri
   yang digabung per material, signage kanvas, dan efek-efek kecil
   (air mancur, eskalator, light shaft).

   mall.html memegang data, UI, dan logika leasing; modul ini hanya
   menerima konteks lewat MallWorld.create(ctx) dan mengembalikan API
   kecil untuk memperbarui tampilan (status unit, bahasa, hover, reticle).
   ===================================================================== */
(function () {
  'use strict';
  var T = AFRAME.THREE;

  /* ============================ kualitas grafis ============================ */
  var PRESETS = {
    // bayangan matahari/bulan dirender sekali ke shadow map statis (hanya dihitung ulang
    // saat siang↔malam berganti), jadi cukup murah untuk tablet
    low:    { name: 'low',    pixelRatio: 1,   tex: 512,  floorTex: 1024, shadows: false, shadowSize: 0,    softShadows: false, points: 1, flora: 0.5, shafts: false, jets: false, aniso: 2, reflect: 0 },
    medium: { name: 'medium', pixelRatio: 1.5, tex: 512,  floorTex: 1024, shadows: true,  shadowSize: 2048, softShadows: false, points: 2, flora: 1,   shafts: true,  jets: true,  aniso: 4, reflect: 0 },
    high:   { name: 'high',   pixelRatio: 2,   tex: 1024, floorTex: 2048, shadows: true,  shadowSize: 4096, softShadows: true,  points: 4, flora: 1,   shafts: true,  jets: true,  aniso: 8, reflect: 0.5 }
  };

  function detectQuality(pref) {
    if (pref && PRESETS[pref]) return PRESETS[pref];
    var touch = (navigator.maxTouchPoints || 0) > 0;
    var mem = navigator.deviceMemory || 8;
    var small = Math.min(screen.width, screen.height) < 500;
    if (mem < 4 || (touch && small && mem < 6)) return PRESETS.low;
    if (touch) return PRESETS.medium;          // tablet & HP: tanpa shadow map real-time
    return PRESETS.high;
  }

  /* ============================== utilitas ================================ */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hexRgb(hex) {
    var h = hex.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }

  // value noise 2D yang bisa di-tile (periode dalam satuan kisi) + fbm
  function TileNoise(seed) {
    var rnd = mulberry32(seed), n = 256;
    this.v = new Float32Array(n * n);
    for (var i = 0; i < n * n; i++) this.v[i] = rnd();
    this.n = n;
  }
  TileNoise.prototype.at = function (x, y, period) {
    var n = this.n, p = period;
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
    var x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    var v = this.v;
    var a = v[(y0 & 255) * n + (x0 & 255)], b = v[(y0 & 255) * n + (x1 & 255)];
    var c = v[(y1 & 255) * n + (x0 & 255)], d = v[(y1 & 255) * n + (x1 & 255)];
    var u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    return lerp(lerp(a, b, u), lerp(c, d, u), w);
  };
  // u,v dalam 0..1 → fbm yang mulus di tepi tile
  TileNoise.prototype.fbm = function (u, v, baseFreq, oct) {
    var sum = 0, amp = 0.5, norm = 0, f = baseFreq;
    for (var o = 0; o < oct; o++) {
      sum += amp * this.at(u * f, v * f, f);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  };

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h || w;
    return c;
  }

  // normal map dari height field (Sobel), tetap tileable
  function heightToNormal(height, size, strength) {
    var c = makeCanvas(size), ctx = c.getContext('2d');
    var img = ctx.createImageData(size, size), d = img.data;
    function H(x, y) { return height[((y + size) % size) * size + ((x + size) % size)]; }
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
        var dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
        var nx = -dx * strength, ny = -dy * strength, nz = 1;
        var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        var i = (y * size + x) * 4;
        d[i] = (nx / l * 0.5 + 0.5) * 255;
        d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
        d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function upscale(canvas, size) {
    if (canvas.width === size) return canvas;
    var c = makeCanvas(size), ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, size, size);
    return c;
  }

  /* ========================== tekstur prosedural ========================== */
  // Semua tekstur dibuat sekali saat mulai: tidak ada unduhan gambar sama sekali.
  function TextureFactory(renderer, Q) {
    this.Q = Q;
    this.aniso = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy());
    this.cache = {};
  }
  TextureFactory.prototype.tex = function (canvas, srgb, repeat) {
    var t = new T.CanvasTexture(canvas);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = this.aniso;
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    if (repeat) t.repeat.set(repeat, repeat);
    return t;
  };

  // generator umum: fn(u, v) → {r,g,b, h (tinggi 0..1), rough (0..1)}
  TextureFactory.prototype.bake = function (key, genSize, outSize, fn, normalStrength) {
    if (this.cache[key]) return this.cache[key];
    var S = genSize;
    var col = makeCanvas(S), rgh = makeCanvas(S);
    var cctx = col.getContext('2d'), rctx = rgh.getContext('2d');
    var cimg = cctx.createImageData(S, S), rimg = rctx.createImageData(S, S);
    var height = new Float32Array(S * S), out = {};
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        fn(x / S, y / S, out);
        var i = y * S + x, j = i * 4;
        cimg.data[j] = out.r; cimg.data[j + 1] = out.g; cimg.data[j + 2] = out.b; cimg.data[j + 3] = 255;
        var r = clamp01(out.rough) * 255;
        rimg.data[j] = r; rimg.data[j + 1] = r; rimg.data[j + 2] = r; rimg.data[j + 3] = 255;
        height[i] = out.h;
      }
    }
    cctx.putImageData(cimg, 0, 0); rctx.putImageData(rimg, 0, 0);
    var set = {
      map: this.tex(upscale(col, outSize), true),
      roughnessMap: this.tex(upscale(rgh, outSize), false),
      normalMap: this.tex(upscale(heightToNormal(height, S, normalStrength || 2), outSize), false)
    };
    this.cache[key] = set;
    return set;
  };

  // marmer poles format besar: 2×2 ubin per tekstur, urat halus, nat tipis
  TextureFactory.prototype.marble = function () {
    var N = new TileNoise(11), N2 = new TileNoise(29), N3 = new TileNoise(47);
    var S = Math.min(this.Q.floorTex, 1024);
    // dengan clearcoat, lapisan dasar dibuat "honed" (lebih kasar); kilapnya dari lapisan coat
    var honed = this.Q.name !== 'low';
    return this.bake('marble', S, this.Q.floorTex, function (u, v, o) {
      var tile = (Math.floor(u * 2) + Math.floor(v * 2) * 2);
      var tu = (u * 2) % 1, tv = (v * 2) % 1;
      var gd = Math.min(tu, 1 - tu, tv, 1 - tv);
      var grout = gd < 0.0035;
      // domain warping dua tingkat → urat bercabang yang tidak terlihat "sinus"
      var w1 = N.fbm(u, v, 4, 5), w2 = N3.fbm(u + w1 * 0.08, v - w1 * 0.05, 8, 4);
      var vein = Math.abs(Math.sin((u * 1.3 + v * 0.7 + tile * 0.21) * 9 + w1 * 7.5 + w2 * 2.2));
      vein = Math.pow(1 - vein, 14) * 0.8 + Math.pow(1 - vein, 70) * 0.55;
      var fine = Math.abs(Math.sin((v * 1.6 - u * 0.5 + tile * 0.37) * 23 + w2 * 11));
      fine = Math.pow(1 - fine, 90) * 0.4 * (0.4 + w1);
      var cloud = N2.fbm(u, v, 3, 4);
      var crystal = N3.at(u * 512, v * 512, 512);
      var base = 200 + (cloud - 0.5) * 20 + (tile % 2 ? 3 : -2) + (crystal - 0.5) * 5;
      var vv = Math.min(1, vein + fine);
      // urat sedikit hangat keabu-abuan, awan dasar sedikit krem
      var r = base - vv * 74 + cloud * 3, g = base - 3 - vv * 74, b = base - 10 - vv * 68;
      if (grout) { r = 150; g = 146; b = 140; }
      o.r = r; o.g = g; o.b = b;
      o.h = grout ? 0 : 0.6 + cloud * 0.05 - vv * 0.035 - (gd < 0.008 ? (0.008 - gd) * 20 : 0);
      o.rough = grout ? 0.85 : honed ? 0.36 + cloud * 0.12 + vv * 0.1 : 0.2 + cloud * 0.1 + vein * 0.05;
    }, 3);
  };

  // granit gelap untuk apron etalase & lantai showroom
  TextureFactory.prototype.granite = function () {
    var N = new TileNoise(5), rnd = mulberry32(99);
    var S = Math.min(this.Q.tex, 512);
    var speck = new Float32Array(S * S);
    for (var i = 0; i < S * S * 0.06; i++) speck[(rnd() * S * S) | 0] = rnd();
    return this.bake('granite', S, this.Q.tex, function (u, v, o) {
      var n = N.fbm(u, v, 8, 4);
      var sp = speck[((v * S) | 0) * S + ((u * S) | 0)];
      var base = 46 + n * 22 + sp * 60;
      o.r = base; o.g = base + 1; o.b = base + 4;
      o.h = 0.5 + n * 0.05; o.rough = 0.22 + n * 0.12;
    }, 1.2);
  };

  // kayu oak papan (lantai toko, booth, bangku)
  TextureFactory.prototype.wood = function () {
    var N = new TileNoise(7), N2 = new TileNoise(71);
    var S = Math.min(this.Q.tex, 512);
    return this.bake('wood', S, this.Q.tex, function (u, v, o) {
      var plank = Math.floor(v * 6);
      var pv = (v * 6) % 1;
      var seam = pv < 0.02 || pv > 0.98;
      var grain = N.fbm(u * 0.25 + plank * 0.37, v * 6 * 0.18, 16, 4);
      var rings = Math.sin((grain * 22 + v * 60 + plank * 3.1)) * 0.5 + 0.5;
      var tone = N2.fbm(u, v, 2, 2) * 0.3 + (plank % 3) * 0.05;
      var r = 150 + rings * 38 + tone * 60, g = 104 + rings * 28 + tone * 40, b = 64 + rings * 16 + tone * 22;
      if (seam) { r *= 0.55; g *= 0.55; b *= 0.55; }
      o.r = r; o.g = g; o.b = b;
      o.h = seam ? 0 : 0.5 + rings * 0.04;
      o.rough = seam ? 0.9 : 0.45 + rings * 0.12;
    }, 2.5);
  };

  // terrazzo krem dengan serpih warna (serpih di tepi digambar ulang di sisi seberang → tileable)
  TextureFactory.prototype.terrazzo = function () {
    if (this.cache.terrazzo) return this.cache.terrazzo;
    var S = Math.min(this.Q.tex, 512), rnd = mulberry32(17);
    var c = makeCanvas(S), ctx = c.getContext('2d');
    ctx.fillStyle = '#e9e2d6'; ctx.fillRect(0, 0, S, S);
    var cols = ['#b9a58c', '#8c9aa6', '#d3b48a', '#6f7a70', '#f4efe6', '#a56d52', '#40464e'];
    for (var i = 0; i < S * 2.2; i++) {
      var x = rnd() * S, y = rnd() * S, r = (0.4 + rnd() * rnd() * 3.2) * S / 256;
      var sides = 5 + (rnd() * 3 | 0), pts = [];
      for (var k = 0; k < sides; k++) {
        var a = k / sides * Math.PI * 2 + rnd() * 0.6, rr = r * (0.6 + rnd() * 0.6);
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      ctx.fillStyle = cols[(rnd() * cols.length) | 0];
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
        ctx.beginPath();
        for (var q = 0; q < pts.length; q++) ctx[q ? 'lineTo' : 'moveTo'](x + ox * S + pts[q][0], y + oy * S + pts[q][1]);
        ctx.closePath(); ctx.fill();
      }
    }
    // serpih batu lebih mengilap & sedikit menonjol dari matriks semen
    var px = ctx.getImageData(0, 0, S, S).data, hgt = new Float32Array(S * S);
    var rc = makeCanvas(S), rctx = rc.getContext('2d'), rimg = rctx.createImageData(S, S), N = new TileNoise(19);
    for (var p = 0; p < S * S; p++) {
      var dr = px[p * 4] - 233, dg = px[p * 4 + 1] - 226, db = px[p * 4 + 2] - 214;
      var chip = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / 40);
      var nz = N.fbm((p % S) / S, Math.floor(p / S) / S, 8, 3);
      hgt[p] = chip * 0.5 + nz * 0.08;
      var rv = (0.4 - chip * 0.2 + nz * 0.12) * 255;
      rimg.data[p * 4] = rimg.data[p * 4 + 1] = rimg.data[p * 4 + 2] = rv; rimg.data[p * 4 + 3] = 255;
    }
    rctx.putImageData(rimg, 0, 0);
    var set = {
      map: this.tex(upscale(c, this.Q.tex), true),
      roughnessMap: this.tex(upscale(rc, this.Q.tex), false),
      normalMap: this.tex(upscale(heightToNormal(hgt, S, 1.2), this.Q.tex), false)
    };
    this.cache.terrazzo = set;
    return set;
  };

  // beton poles (unit kosong) & plester dinding
  TextureFactory.prototype.concrete = function () {
    var N = new TileNoise(3), rnd = mulberry32(5);
    var S = Math.min(this.Q.tex, 512);
    var pores = new Float32Array(S * S);
    for (var i = 0; i < S * S * 0.004; i++) pores[(rnd() * S * S) | 0] = 1;
    return this.bake('concrete', S, this.Q.tex, function (u, v, o) {
      var n = N.fbm(u, v, 6, 5), p = pores[((v * S) | 0) * S + ((u * S) | 0)];
      var base = 150 + (n - 0.5) * 46 - p * 40;
      o.r = base; o.g = base - 1; o.b = base - 3;
      o.h = 0.5 + n * 0.1 - p * 0.3; o.rough = 0.45 + n * 0.25 + p * 0.3;
    }, 1.5);
  };

  TextureFactory.prototype.plaster = function () {
    var N = new TileNoise(13);
    var S = Math.min(this.Q.tex, 256);
    return this.bake('plaster', S, Math.min(this.Q.tex, 512), function (u, v, o) {
      var n = N.fbm(u, v, 8, 4);
      var base = 240 + (n - 0.5) * 10;
      o.r = base; o.g = base - 2; o.b = base - 6;
      o.h = n * 0.3; o.rough = 0.8 + n * 0.1;
    }, 0.6);
  };

  // logam brushed: goresan horizontal di roughness map
  TextureFactory.prototype.brushed = function () {
    var N = new TileNoise(23);
    var S = 256;
    return this.bake('brushed', S, 256, function (u, v, o) {
      var s = N.fbm(u * 0.02, v, 64, 3);
      o.r = o.g = o.b = 200 + s * 40;
      o.h = s * 0.2; o.rough = 0.25 + s * 0.2;
    }, 0.4);
  };

  // noda poles/bekas pel untuk clearcoatRoughnessMap: nilai rendah = kilap cermin
  TextureFactory.prototype.smudge = function () {
    if (this.cache.smudge) return this.cache.smudge;
    var N = new TileNoise(83), N2 = new TileNoise(89), S = 256;
    var c = makeCanvas(S), ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
      var u = x / S, v = y / S;
      var blot = N.fbm(u, v, 3, 5);
      var wipe = Math.abs(Math.sin((u * 0.8 + v * 1.1) * 14 + N2.fbm(u, v, 4, 3) * 6));
      var val = 0.22 + Math.pow(clamp01((blot - 0.45) * 2.4), 1.6) * 0.6 + Math.pow(1 - wipe, 6) * 0.14 + N2.at(u * 128, v * 128, 128) * 0.06;
      var i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp01(val) * 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    var t = this.tex(c, false);
    this.cache.smudge = t;
    return t;
  };

  // tekstur daun (alpha): pelepah palem & rumpun daun
  TextureFactory.prototype.frond = function () {
    if (this.cache.frond) return this.cache.frond;
    var S = 256, c = makeCanvas(S, S * 2), ctx = c.getContext('2d'), rnd = mulberry32(41);
    ctx.clearRect(0, 0, S, S * 2);
    ctx.strokeStyle = '#4c6b2f'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(S / 2, S * 2); ctx.quadraticCurveTo(S / 2 + 8, S, S / 2, 4); ctx.stroke();
    for (var i = 0; i < 46; i++) {
      var t = i / 46, y = S * 2 - t * S * 2 + 6, len = Math.sin(t * Math.PI) * S * 0.46 + 10;
      for (var side = -1; side <= 1; side += 2) {
        var g = ctx.createLinearGradient(S / 2, y, S / 2 + side * len, y - len * 0.45);
        g.addColorStop(0, '#3f6e2a'); g.addColorStop(1, rnd() > 0.5 ? '#79a948' : '#5e8f3a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(S / 2, y);
        ctx.quadraticCurveTo(S / 2 + side * len * 0.5, y - len * 0.1 - 6, S / 2 + side * len, y - len * 0.45);
        ctx.quadraticCurveTo(S / 2 + side * len * 0.5, y - len * 0.1 + 4, S / 2, y + 7);
        ctx.fill();
      }
    }
    var t2 = new T.CanvasTexture(c);
    t2.colorSpace = T.SRGBColorSpace; t2.anisotropy = this.aniso;
    this.cache.frond = t2;
    return t2;
  };

  TextureFactory.prototype.foliage = function () {
    if (this.cache.foliage) return this.cache.foliage;
    var S = 256, c = makeCanvas(S), ctx = c.getContext('2d'), rnd = mulberry32(77);
    ctx.clearRect(0, 0, S, S);
    for (var i = 0; i < 120; i++) {
      var a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * S * 0.36;
      var x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.9;
      var len = 18 + rnd() * 20, rot = rnd() * Math.PI * 2;
      var shade = 0.6 + rnd() * 0.4;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.fillStyle = 'rgb(' + (58 * shade | 0) + ',' + (112 * shade | 0) + ',' + (48 * shade | 0) + ')';
      ctx.beginPath(); ctx.ellipse(0, 0, len * 0.5, len * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(20,40,15,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-len * 0.45, 0); ctx.lineTo(len * 0.45, 0); ctx.stroke();
      ctx.restore();
    }
    var t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = this.aniso;
    this.cache.foliage = t;
    return t;
  };

  // bayangan kontak: gradasi radial gelap → transparan
  TextureFactory.prototype.blob = function (square) {
    var key = square ? 'blobSq' : 'blob';
    if (this.cache[key]) return this.cache[key];
    var S = 128, c = makeCanvas(S), ctx = c.getContext('2d');
    if (square) {
      var img = ctx.createImageData(S, S);
      for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
        var dx = Math.abs(x / (S - 1) * 2 - 1), dy = Math.abs(y / (S - 1) * 2 - 1);
        var d = Math.max(Math.pow(dx, 4) + Math.pow(dy, 4), 0);
        var a = clamp01(1 - Math.pow(d, 0.35)) * 0.62;
        var i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; img.data[i + 3] = a * 255;
      }
      ctx.putImageData(img, 0, 0);
    } else {
      var g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, 'rgba(0,0,0,.62)'); g.addColorStop(0.45, 'rgba(0,0,0,.34)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    }
    var t = new T.CanvasTexture(c);
    this.cache[key] = t;
    return t;
  };

  TextureFactory.prototype.glow = function () {
    if (this.cache.glow) return this.cache.glow;
    var S = 128, c = makeCanvas(S), ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    var t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    this.cache.glow = t;
    return t;
  };

  // normal map air (dua lapis digeser berlawanan arah di shader air)
  TextureFactory.prototype.waterNormal = function () {
    if (this.cache.water) return this.cache.water;
    var N = new TileNoise(61), S = 256, h = new Float32Array(S * S);
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) h[y * S + x] = N.fbm(x / S, y / S, 6, 4);
    var t = this.tex(heightToNormal(h, S, 6), false);
    this.cache.water = t;
    return t;
  };

  /* ============================ material library =========================== */
  function MaterialLibrary(tf, Q, envMap) {
    this.tf = tf; this.Q = Q; this.env = envMap;
    this.paints = {};
    var self = this;
    // Tier medium/high memakai MeshPhysicalMaterial untuk lapisan clearcoat (lantai poles,
    // pernis kayu, cat piano) dan sheen (kain). Tier low tetap MeshStandardMaterial.
    var rich = Q.name !== 'low';
    var PHYS = ['clearcoat', 'clearcoatRoughness', 'clearcoatRoughnessMap', 'sheen', 'sheenColor', 'sheenRoughness'];
    function std(o) {
      var phys = rich && PHYS.some(function (k) { return k in o; });
      if (!phys) PHYS.forEach(function (k) { delete o[k]; });
      var m = phys ? new T.MeshPhysicalMaterial(o) : new T.MeshStandardMaterial(o);
      m.envMapIntensity = o.envMapIntensity || 1;
      return m;
    }
    function withTex(set, o) {
      o.map = set.map; if (set.roughnessMap) o.roughnessMap = set.roughnessMap;
      if (set.normalMap) { o.normalMap = set.normalMap; o.normalScale = new T.Vector2(o.ns || 0.6, o.ns || 0.6); }
      delete o.ns;
      return std(o);
    }
    var marble = tf.marble(), granite = tf.granite(), wood = tf.wood(), terr = tf.terrazzo(),
        conc = tf.concrete(), plas = tf.plaster(), brushed = tf.brushed();
    // noda poles dibuat lebih besar dari ubin supaya pola ubin tidak terlihat berulang
    var smudge = rich ? tf.smudge() : null, smudgeWide = null;
    if (smudge) { smudgeWide = smudge.clone(); smudgeWide.repeat.set(0.37, 0.37); smudgeWide.needsUpdate = true; }

    this.marble   = withTex(marble,  { roughness: 1, metalness: 0, envMapIntensity: 0.8, ns: 0.35,
                                       clearcoat: 1, clearcoatRoughness: 0.2, clearcoatRoughnessMap: smudgeWide });
    this.granite  = withTex(granite, { roughness: 1, metalness: 0, envMapIntensity: 1.0, ns: 0.4,
                                       clearcoat: 0.7, clearcoatRoughness: 0.12, clearcoatRoughnessMap: smudge });
    this.wood     = withTex(wood,    { roughness: 1, metalness: 0, ns: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.28 });
    this.woodDark = withTex(wood,    { roughness: 1, metalness: 0, color: 0x6b4b33, ns: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.22 });
    this.terrazzo = withTex(terr,    { roughness: 1, metalness: 0, ns: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1, clearcoatRoughnessMap: smudge });
    this.concrete = withTex(conc,    { roughness: 1, metalness: 0, ns: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.35 });
    this.plaster  = withTex(plas,    { roughness: 1, metalness: 0, color: 0xf3f0ea, ns: 0.3 });
    this.ceiling  = withTex(plas,    { roughness: 1, metalness: 0, color: 0xfaf8f4, ns: 0.2 });
    this.fascia   = std({ color: 0xf4f2ee, roughness: 0.32, metalness: 0 });
    this.stoneLight = std({ color: 0xe6e0d6, roughness: 0.45, metalness: 0 });
    this.metalDark  = std({ color: 0x1b1e24, roughness: 1, metalness: 0.75, roughnessMap: brushed.roughnessMap });
    this.metalSteel = std({ color: 0xaeb5bd, roughness: 1, metalness: 1, roughnessMap: brushed.roughnessMap, envMapIntensity: 1.2 });
    this.brass      = std({ color: 0xc9a45c, roughness: 0.28, metalness: 1, envMapIntensity: 1.3 });
    this.blackGloss = std({ color: 0x0f1115, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 });
    this.rubber     = std({ color: 0x0c0d0f, roughness: 0.55, metalness: 0 });
    this.bark       = std({ color: 0x5a4636, roughness: 0.95, metalness: 0 });
    this.soil       = std({ color: 0x2e241c, roughness: 1, metalness: 0 });
    this.planter    = std({ color: 0xe9e4dc, roughness: 0.5, metalness: 0 });
    this.cushion    = std({ color: 0x3a3f47, roughness: 0.85, metalness: 0, sheen: 1, sheenColor: new T.Color(0x9aa3b4), sheenRoughness: 0.55 });

    // kaca etalase: tanpa transmission pass (mahal di iPad), refleksi dari env map
    this.glass = new T.MeshPhysicalMaterial({
      color: 0xd6ecf2, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.2,
      envMapIntensity: 2.6, depthWrite: false, side: T.DoubleSide, specularIntensity: 1, ior: 1.5
    });
    this.glassRail = this.glass.clone(); this.glassRail.color.set(0xe4ecee); this.glassRail.opacity = 0.18;
    this.glassSky = this.glass.clone(); this.glassSky.opacity = 0.12; this.glassSky.color.set(0xe8f4ff);
    this.glassCase = this.glass.clone(); this.glassCase.opacity = 0.14;

    // material emisif — tidak ikut tone mapping supaya terasa menyala
    function led(hex, k) { var m = new T.MeshBasicMaterial({ color: hex, toneMapped: false }); if (k) m.color.multiplyScalar(k); return m; }
    this.ledWarm  = led(0xfff0d2);
    this.ledCool  = led(0xeaf4ff);
    this.panel    = led(0xfff6e6, 0.95);
    this.screen   = led(0x0d1726);

    // daun (alpha-tested), bayangan kontak
    this.frond = std({ map: tf.frond(), alphaTest: 0.45, side: T.DoubleSide, roughness: 0.75, metalness: 0 });
    this.foliage = std({ map: tf.foliage(), alphaTest: 0.4, side: T.DoubleSide, roughness: 0.8, metalness: 0 });
    this.shadow = new T.MeshBasicMaterial({ map: tf.blob(false), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.shadowSq = new T.MeshBasicMaterial({ map: tf.blob(true), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

    // penanda siapa yang boleh memproyeksikan bayangan real-time (tier high)
    [this.metalDark, this.metalSteel, this.wood, this.woodDark, this.planter, this.stoneLight, this.fascia,
     this.blackGloss, this.bark, this.frond, this.foliage, this.cushion, this.brass, this.plaster, this.ceiling,
     this.rubber].forEach(function (m) { m.userData.cast = true; });
    [this.marble, this.granite, this.wood, this.terrazzo, this.concrete, this.plaster, this.stoneLight, this.fascia,
     this.ceiling, this.blackGloss, this.planter, this.metalDark, this.metalSteel, this.woodDark, this.brass,
     this.cushion].forEach(function (m) { m.userData.receive = true; });

    this.statusCache = {};
  }
  // cat dinding berwarna (dinding fitur tenant, dsb.)
  MaterialLibrary.prototype.paint = function (hex, rough) {
    var key = hex + '|' + (rough || 0.7);
    if (!this.paints[key]) {
      var m = new T.MeshStandardMaterial({ color: hex, roughness: rough || 0.7, metalness: 0 });
      m.userData.receive = true; m.userData.cast = true;
      this.paints[key] = m;
    }
    return this.paints[key];
  };
  // strip LED status: satu material per unit supaya warnanya bisa berubah sendiri
  MaterialLibrary.prototype.statusLed = function () {
    return new T.MeshBasicMaterial({ color: 0x36d399, toneMapped: false });
  };

  /* ===================== image-based lighting & langit ===================== */
  // "ruangan studio" kecil yang dirender ke PMREM → refleksi realistis di marmer,
  // kaca, dan logam tanpa satu pun berkas HDR yang perlu diunduh
  // night=true → langit gelap di skylight, cahaya toko & downlight hangat jadi dominan
  function buildEnvironment(renderer, night) {
    var scene = new T.Scene();
    var box = new T.BoxGeometry(1, 1, 1);
    var base = night ? new T.Color(0.035, 0.034, 0.04) : new T.Color(0.17, 0.163, 0.152);
    var room = new T.Mesh(box, new T.MeshBasicMaterial({ side: T.BackSide, color: base }));
    room.scale.set(40, 14, 80); room.position.y = 7;
    scene.add(room);
    function emit(hex, k, x, y, z, sx, sy, sz) {
      var m = new T.MeshBasicMaterial({ color: hex });
      m.color.multiplyScalar(k);
      var e = new T.Mesh(box, m);
      e.position.set(x, y, z); e.scale.set(sx, sy, sz);
      scene.add(e);
    }
    if (night) {
      emit(0x2a3d6e, 0.5, 0, 13.8, 0, 9, 0.2, 70);              // skylight: langit malam
    } else {
      emit(0xdfe9ff, 3.6, 0, 13.8, 0, 9, 0.2, 70);               // skylight panjang
      emit(0xfff3e0, 16, 4, 13.7, -4, 2.5, 0.2, 4);              // "matahari" terpantul (sorot spekular)
    }
    for (var z = -30; z <= 30; z += 10) {
      emit(0xffcf96, night ? 2.2 : 2.0, -19.8, 3, z, 0.2, 3, 7); // cahaya toko kiri
      emit(0xffcf96, night ? 2.2 : 2.0, 19.8, 3, z, 0.2, 3, 7);  // cahaya toko kanan
      emit(0xffe6c4, night ? 4.5 : 5, -6, 5.1, z, 1.2, 0.1, 1.2); // downlight mezanin
      emit(0xffe6c4, night ? 4.5 : 5, 6, 5.1, z, 1.2, 0.1, 1.2);
    }
    emit(night ? 0x17140f : 0x5a5248, 1, 0, 0.05, 0, 40, 0.1, 80); // pantulan lantai
    var pmrem = new T.PMREMGenerator(renderer);
    var rt = pmrem.fromScene(scene, 0.03);
    pmrem.dispose();
    return rt.texture;
  }

  function buildSky(sunDir, moonDir) {
    var mat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      uniforms: {
        uTopDay: { value: new T.Color(0x3a73c4) }, uHorDay: { value: new T.Color(0xd3e4f2) },
        uTopNight: { value: new T.Color(0x040814) }, uHorNight: { value: new T.Color(0x16223d) },
        uGround: { value: new T.Color(0x9a9186) },
        uSun: { value: sunDir.clone().normalize() }, uMoon: { value: moonDir.clone().normalize() },
        uNight: { value: 0 }
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main(){',
        '  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);',
        '  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = p.xyww;',
        '}'].join('\n'),
      fragmentShader: [
        'uniform vec3 uTopDay; uniform vec3 uHorDay; uniform vec3 uTopNight; uniform vec3 uHorNight; uniform vec3 uGround;',
        'uniform vec3 uSun; uniform vec3 uMoon; uniform float uNight;',
        'varying vec3 vDir;',
        'float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
        'void main(){',
        '  vec3 d = normalize(vDir); float h = d.y;',
        '  vec3 top = mix(uTopDay, uTopNight, uNight), hor = mix(uHorDay, uHorNight, uNight);',
        '  vec3 col = h > 0.0 ? mix(hor, top, pow(h, 0.55)) : mix(hor, uGround * (1.0 - 0.9 * uNight), pow(-h, 0.35));',
        '  float s = max(dot(d, normalize(uSun)), 0.0);',
        '  col += (1.0 - uNight) * vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.22);',
        '  float m = max(dot(d, normalize(uMoon)), 0.0);',
        '  col += uNight * (vec3(0.9, 0.93, 1.0) * smoothstep(0.99935, 0.9996, m) * 1.8 + vec3(0.25, 0.35, 0.6) * pow(m, 60.0) * 0.35);',
        '  vec3 g = floor(d * 280.0);',
        '  float star = step(0.9972, hash(g)) * smoothstep(0.02, 0.3, h) * (0.5 + 0.5 * hash(g + 7.3));',
        '  col += uNight * star * vec3(0.92, 0.95, 1.0);',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '}'].join('\n')
    });
    var sky = new T.Mesh(new T.SphereGeometry(900, 32, 16), mat);
    sky.frustumCulled = false; sky.renderOrder = -10;
    return sky;
  }

  /* ========================= builder + penggabungan ======================== */
  // Kumpulkan geometri per material, lalu gabungkan jadi satu mesh per material:
  // ratusan balok arsitektur cukup digambar dengan belasan draw call.
  function Builder(colliders) {
    this.colliders = colliders;
    this.buckets = new Map();
    this.frame(0, 0, 0);
  }
  Builder.prototype.frame = function (x, z, rotY) {
    this.fx = x; this.fz = z; this.fr = rotY || 0;
    this.m = new T.Matrix4().makeRotationY(this.fr).setPosition(x, 0, z);
    return this;
  };
  Builder.prototype.toWorld = function (x, z) {
    var c = Math.cos(this.fr), s = Math.sin(this.fr);
    return [this.fx + x * c + z * s, this.fz - x * s + z * c];
  };
  Builder.prototype.collider = function (x, z, w, d, ry) {
    var pts = [], c = Math.cos(ry || 0), s = Math.sin(ry || 0);
    [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].forEach(function (p) {
      pts.push([x + p[0] * c + p[1] * s, z - p[0] * s + p[1] * c]);
    });
    var self = this, wx = [], wz = [];
    pts.forEach(function (p) { var q = self.toWorld(p[0], p[1]); wx.push(q[0]); wz.push(q[1]); });
    this.colliders.push({ x1: Math.min.apply(0, wx), x2: Math.max.apply(0, wx), z1: Math.min.apply(0, wz), z2: Math.max.apply(0, wz) });
  };
  Builder.prototype.add = function (mat, g) {
    g.applyMatrix4(this.m);
    var list = this.buckets.get(mat);
    if (!list) { list = []; this.buckets.set(mat, list); }
    list.push(g);
    return g;
  };
  function orient(g, o) {
    if (o.rz) g.rotateZ(o.rz);
    if (o.rx) g.rotateX(o.rx);
    if (o.ry) g.rotateY(o.ry);
  }
  // UV sesuai ukuran dunia supaya tekstur ber-tile tidak melar
  function boxUV(g, w, h, d, tile) {
    var uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (var f = 0; f < 6; f++) for (var k = 0; k < 4; k++) {
      var i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
    }
  }
  Builder.prototype.box = function (mat, x, y, z, w, h, d, o) {
    o = o || {};
    var g = new T.BoxGeometry(w, h, d);
    if (o.tile) boxUV(g, w, h, d, o.tile);
    orient(g, o);
    g.translate(x, y, z);
    if (o.collide) this.collider(x, z, w, d, o.ry);
    return this.add(mat, g);
  };
  Builder.prototype.plane = function (mat, x, y, z, w, h, o) {
    o = o || {};
    var g = new T.PlaneGeometry(w, h);
    if (o.tile) { var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / o.tile + (o.uOff || 0), uv.getY(i) * h / o.tile + (o.vOff || 0)); }
    orient(g, o);
    g.translate(x, y, z);
    return this.add(mat, g);
  };
  // lantai horizontal; offset UV dari posisi dunia supaya pola ubin menyambung antar potongan
  Builder.prototype.floor = function (mat, x, z, w, d, y, tile) {
    return this.plane(mat, x, y || 0, z, w, d, {
      rx: -Math.PI / 2, tile: tile,
      uOff: tile ? (x - w / 2) / tile : 0, vOff: tile ? (-z - d / 2) / tile : 0
    });
  };
  Builder.prototype.cyl = function (mat, x, y, z, rt, rb, h, o) {
    o = o || {};
    var g = new T.CylinderGeometry(rt, rb, h, o.seg || 24, 1, !!o.open, o.t0 || 0, o.tl || Math.PI * 2);
    orient(g, o);
    g.translate(x, y, z);
    if (o.collide) this.collider(x, z, Math.max(rt, rb) * 2, Math.max(rt, rb) * 2, 0);
    return this.add(mat, g);
  };
  Builder.prototype.torus = function (mat, x, y, z, r, tube, o) {
    o = o || {};
    var g = new T.TorusGeometry(r, tube, o.rs || 8, o.ts || 32, o.arc || Math.PI * 2);
    orient(g, o);
    g.translate(x, y, z);
    return this.add(mat, g);
  };
  Builder.prototype.shadow = function (mats, x, z, w, d, square) {
    return this.plane(square ? mats.shadowSq : mats.shadow, x, 0.012, z, w, d, { rx: -Math.PI / 2 });
  };
  Builder.prototype.flush = function (parent, shadowsOn) {
    var merge = T.BufferGeometryUtils.mergeGeometries;
    this.buckets.forEach(function (list, mat) {
      var anyNonIndexed = list.some(function (g) { return !g.index; });
      if (anyNonIndexed) list = list.map(function (g) { return g.index ? g.toNonIndexed() : g; });
      var merged = merge(list, false);
      list.forEach(function (g) { g.dispose(); });
      if (!merged) return;
      var mesh = new T.Mesh(merged, mat);
      mesh.castShadow = !!(shadowsOn && mat.userData.cast);
      mesh.receiveShadow = !!(shadowsOn && mat.userData.receive);
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      parent.add(mesh);
    });
    this.buckets.clear();
  };

  /* ============================ signage kanvas ============================ */
  var FONT = {
    ui: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
    serif: '"Playfair Display", Georgia, "Times New Roman", serif',
    wide: '"Montserrat", "Helvetica Neue", Helvetica, Arial, sans-serif'
  };
  function font(weight, px, fam) { return weight + ' ' + Math.round(px) + 'px ' + (FONT[fam] || FONT.ui); }
  // teks dengan letter-spacing manual (letterSpacing kanvas belum ada di semua WebKit)
  function spaced(ctx, text, x, y, spacing, align) {
    text = String(text);
    if (!spacing) { ctx.textAlign = align || 'center'; ctx.fillText(text, x, y); return; }
    var widths = [], total = 0;
    for (var i = 0; i < text.length; i++) { var w = ctx.measureText(text[i]).width; widths.push(w); total += w + (i ? spacing : 0); }
    var cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
    ctx.textAlign = 'left';
    for (var j = 0; j < text.length; j++) { ctx.fillText(text[j], cx, y); cx += widths[j] + spacing; }
  }
  function spacedWidth(ctx, text, spacing) {
    var total = 0; text = String(text);
    for (var i = 0; i < text.length; i++) total += ctx.measureText(text[i]).width + (i ? spacing : 0);
    return total;
  }
  // kecilkan ukuran font sampai muat
  function fit(ctx, text, weight, px, fam, maxW, spacing) {
    var size = px;
    ctx.font = font(weight, size, fam);
    while (size > 8 && spacedWidth(ctx, text, spacing || 0) > maxW) { size *= 0.92; ctx.font = font(weight, size, fam); }
    return size;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Sign: bidang datar bertekstur kanvas. glow=true → menyala (tidak kena tone mapping).
  function Sign(w, h, opts) {
    opts = opts || {};
    var px = opts.px || 1024, ph = Math.max(16, Math.round(px * h / w));
    this.canvas = makeCanvas(px, ph);
    this.ctx = this.canvas.getContext('2d');
    this.W = px; this.H = ph;
    this.draw = opts.draw;
    this.texture = new T.CanvasTexture(this.canvas);
    this.texture.colorSpace = T.SRGBColorSpace;
    this.texture.anisotropy = opts.aniso || 4;
    this.texture.generateMipmaps = true;
    var mo = { map: this.texture, transparent: !!opts.transparent, side: opts.double ? T.DoubleSide : T.FrontSide };
    if (opts.glow) { mo.toneMapped = false; this.material = new T.MeshBasicMaterial(mo); }
    else { mo.roughness = opts.rough || 0.55; mo.metalness = 0; this.material = new T.MeshStandardMaterial(mo); }
    if (opts.transparent) this.material.depthWrite = false;
    if (opts.intensity) this.material.color.setScalar(opts.intensity);
    this.mesh = new T.Mesh(new T.PlaneGeometry(w, h), this.material);
    this.mesh.renderOrder = opts.transparent ? 2 : 0;
    this.redraw();
  }
  Sign.prototype.redraw = function () {
    var c = this.ctx;
    c.save(); c.clearRect(0, 0, this.W, this.H);
    if (this.draw) this.draw(c, this.W, this.H, this);
    c.restore();
    this.texture.needsUpdate = true;
  };
  Sign.prototype.place = function (x, y, z, rotY, rotX) {
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.set(rotX || 0, rotY || 0, 0, 'YXZ');
    return this;
  };

  /* ======================= pin hotspot (sprite melayang) ==================== */
  function pinTexture(kind) {
    var S = 256, c = makeCanvas(S), g = c.getContext('2d');
    var col = kind === 'lease' ? '#1fbf85' : kind === 'reserved' ? '#3d8bff' : '#ff8a1f';
    // halo
    var halo = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S / 2);
    halo.addColorStop(0, col + '88'); halo.addColorStop(1, col + '00');
    g.fillStyle = halo; g.fillRect(0, 0, S, S);
    // lingkaran
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2);
    g.fillStyle = col; g.fill();
    g.lineWidth = S * 0.035; g.strokeStyle = 'rgba(255,255,255,.95)'; g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (kind === 'ar') {
      g.font = font('800', S * 0.2, 'wide'); g.fillText('AR', S / 2, S / 2 + 2);
    } else if (kind === 'lease') {
      g.font = font('800', S * 0.3, 'ui'); g.fillText('+', S / 2, S / 2 + 2);
    } else {
      g.lineWidth = S * 0.045; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(S * 0.38, S * 0.51); g.lineTo(S * 0.47, S * 0.6); g.lineTo(S * 0.64, S * 0.41); g.stroke();
    }
    var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  /* ================================ world ================================= */
  var COL_Z = [19.5, 10.5, 1.5, -7.5, -16.5, -25.5];   // kolom di celah antar unit
  var LV = { fascia: 4.6, slabB: 5.0, slabT: 5.4, l2Top: 9.6, roof: 10.3, sky: 11.0 };
  var VOID_X = 4.4;                                      // tepi void atrium (mezanin di luar ini)

  function create(ctx) {
    var sceneEl = ctx.sceneEl, renderer = sceneEl.renderer, scene = sceneEl.object3D;
    var Q = detectQuality(ctx.quality);
    var MALL = ctx.MALL;
    var W = {
      Q: Q, root: new T.Group(), ticks: [], units: {}, i18n: [], pins: [],
      features: [], hover: { unit: null, product: null }, time: 0
    };
    W.root.name = 'mall-world';
    scene.add(W.root);

    function step(label, frac, fn) {
      return function () {
        if (ctx.progress) ctx.progress(frac, label);
        return new Promise(function (res) {
          requestAnimationFrame(function () { setTimeout(function () { fn(); res(); }, 0); });
        });
      };
    }

    /* ---------------------- renderer, lighting, sky ---------------------- */
    function setupRenderer() {
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio));
      renderer.shadowMap.enabled = Q.shadows;
      renderer.shadowMap.type = Q.softShadows ? T.PCFSoftShadowMap : T.PCFShadowMap;
      renderer.shadowMap.autoUpdate = false;      // semua objek bayangan statis → cukup sekali
      W.tf = new TextureFactory(renderer, Q);
    }

    // Dua keadaan pencahayaan; transisi siang↔malam me-lerp semua nilai ini.
    var TOD = {
      day: {
        dir: new T.Vector3(0.24, 1, 0.3).normalize(), color: new T.Color(0xfff0d8),
        sun: Q.shadows ? 12 : 1.4, hemiSky: new T.Color(0xeaf2ff), hemiGround: new T.Color(0x74644f), hemi: Q.shadows ? 0.1 : 0.4,
        point: 30, exposure: Q.shadows ? 0.82 : 0.95, envGain: 0.5,
        fog: new T.Color(0xd4d9df), fogDensity: 0.0022
      },
      night: {
        dir: new T.Vector3(-0.32, 0.9, -0.3).normalize(), color: new T.Color(0x9fb6ff),
        sun: Q.shadows ? 0.6 : 0.2, hemiSky: new T.Color(0x1b2442), hemiGround: new T.Color(0x0d0c0b), hemi: Q.shadows ? 0.03 : 0.08,
        point: 55, exposure: 0.78, envGain: 0.75,
        fog: new T.Color(0x0c0f17), fogDensity: 0.0075
      }
    };

    function setupLighting() {
      W.sunDir = TOD.day.dir.clone();
      if (window.MallSky) {
        // panorama 360° HDR dibuat otomatis (langit fisik, awan, siluet kota) → latar + HDRI
        W.pano = MallSky.create(renderer, {
          width: Q.name === 'high' ? 4096 : 2048, sunDir: TOD.day.dir, moonDir: TOD.night.dir, seed: 3.7
        });
        var pmrem = new T.PMREMGenerator(renderer);
        W.pano.render(1); W.envSkyNight = pmrem.fromEquirectangular(W.pano.texture).texture;
        W.pano.render(0); W.envSkyDay = pmrem.fromEquirectangular(W.pano.texture).texture;
        pmrem.dispose();
        W.pano.k = 0;
        W.envDay = W.envSkyDay; W.envNight = W.envSkyNight;     // diganti light probe saat finish
        W.sky = MallSky.dome(W.pano.texture);
      } else {
        W.envDay = buildEnvironment(renderer, false);
        W.envNight = buildEnvironment(renderer, true);
        W.sky = buildSky(TOD.day.dir, TOD.night.dir);
      }
      scene.environment = W.envDay;
      scene.add(W.sky);

      W.hemi = new T.HemisphereLight(0xeaf2ff, 0x74644f, TOD.day.hemi);
      W.root.add(W.hemi);

      // satu directional light berperan sebagai matahari (siang) atau bulan (malam)
      var sun = new T.DirectionalLight(TOD.day.color, TOD.day.sun);
      sun.target.position.set(0, 0, -2);
      if (Q.shadows) {
        sun.castShadow = true;
        sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
        sun.shadow.bias = -0.00025;
        sun.shadow.normalBias = Q.shadowSize >= 4096 ? 0.02 : 0.035;
        sun.shadow.radius = 2;
      }
      W.root.add(sun); W.root.add(sun.target);
      W.sun = sun;

      // lampu hangat di sepanjang koridor (jumlah mengikuti tier kualitas)
      var zs = Q.points >= 4 ? [22, 6, -10, -26] : Q.points >= 2 ? [14, -14] : [0];
      W.points = zs.map(function (z) {
        var p = new T.PointLight(0xffe2bd, TOD.day.point, 22, 2);
        p.position.set(0, 4.4, z);
        W.root.add(p);
        return p;
      });
      W.tod = { k: 0, target: 0 };
      // kabut eksponensial tipis: perspektif udara di koridor 68 m (langit tidak terpengaruh)
      scene.fog = new T.FogExp2(TOD.day.fog.getHex(), TOD.day.fogDensity);
    }

    // kamera bayangan dipas ke kotak gedung dilihat dari arah cahaya → resolusi tidak terbuang
    var shadowFitCam = new T.OrthographicCamera();
    function fitShadow() {
      if (!Q.shadows) return;
      var sun = W.sun, sc = sun.shadow.camera;
      sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
      shadowFitCam.position.copy(sun.position);
      shadowFitCam.lookAt(sun.target.position);
      shadowFitCam.updateMatrixWorld();
      var inv = shadowFitCam.matrixWorldInverse, v = new T.Vector3();
      var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      [MALL.minX, MALL.maxX].forEach(function (x) {
        [0, LV.sky + 0.6].forEach(function (y) {
          [MALL.minZ - 1, MALL.maxZ + 1].forEach(function (z) {
            v.set(x, y, z).applyMatrix4(inv);
            mn[0] = Math.min(mn[0], v.x); mn[1] = Math.min(mn[1], v.y); mn[2] = Math.min(mn[2], v.z);
            mx[0] = Math.max(mx[0], v.x); mx[1] = Math.max(mx[1], v.y); mx[2] = Math.max(mx[2], v.z);
          });
        });
      });
      sc.left = mn[0]; sc.right = mx[0]; sc.bottom = mn[1]; sc.top = mx[1];
      sc.near = Math.max(0.5, -mx[2] - 1); sc.far = -mn[2] + 1;
      sc.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
    }

    // k: 0 = siang penuh, 1 = malam penuh
    var tmpDir = new T.Vector3();
    function applyTOD(k) {
      var D = TOD.day, N = TOD.night, e = k * k * (3 - 2 * k);
      W.tod.k = k;
      // arah cahaya: pakai arah matahari selama masih "siang", lalu arah bulan
      tmpDir.copy(e < 0.5 ? D.dir : N.dir);
      W.sun.position.copy(tmpDir).multiplyScalar(60).add(W.sun.target.position);
      // redup ke 0 di tengah transisi supaya pergantian arah bayangan tidak terlihat meloncat
      var fadeMid = Math.abs(e - 0.5) * 2;
      W.sun.color.copy(e < 0.5 ? D.color : N.color);
      W.sun.intensity = (e < 0.5 ? D.sun : N.sun) * fadeMid;
      W.hemi.color.copy(D.hemiSky).lerp(N.hemiSky, e);
      W.hemi.groundColor.copy(D.hemiGround).lerp(N.hemiGround, e);
      W.hemi.intensity = lerp(D.hemi, N.hemi, e);
      W.points.forEach(function (p) { p.intensity = lerp(D.point, N.point, e); });
      renderer.toneMappingExposure = lerp(D.exposure, N.exposure, e);
      if (W.hdrU) W.hdrU.uHdrExposure.value = renderer.toneMappingExposure;
      if (W.pano) {
        // panorama dibuat ulang saat transisi (dibatasi tiap 3 frame) dan sekali di posisi akhir
        W.panoTick = (W.panoTick || 0) + 1;
        if (W.pano.k !== e && (e === 0 || e === 1 || W.panoTick % 3 === 0)) { W.pano.render(e); W.pano.k = e; }
      } else {
        W.sky.material.uniforms.uNight.value = e;
      }
      scene.environment = e < 0.5 ? W.envDay : W.envNight;
      if (W.shaftMat) W.shaftMat.uniforms.uStrength.value = 1 - e;
      (W.lampGlows || []).forEach(function (g) { g.material.opacity = e * 0.95; });
      (W.lampHeads || []).forEach(function (m) { m.color.setScalar(0.25 + e * 0.75); });
      if (scene.fog) { scene.fog.color.copy(D.fog).lerp(N.fog, e); scene.fog.density = lerp(D.fogDensity, N.fogDensity, e); }
      if (W.post) W.post.setNight(e);
      // intensitas cahaya tak langsung (light probe) per siang/malam
      if (W.envMats) {
        var gain = lerp(D.envGain, N.envGain, e);
        for (var mi = 0; mi < W.envMats.length; mi++) W.envMats[mi].m.envMapIntensity = W.envMats[mi].base * gain;
      }
      fitShadow();
    }

    /* --------------- global illumination: light probe dari mall itu sendiri --------------- */
    // Mall dirender ke cubemap dari tengah koridor (matahari, langit HDR, lampu, signage
    // yang menyala, pantulan lantai & dinding), lalu dijadikan PMREM untuk cahaya tak
    // langsung (diffuse + spekular) semua material. Tier high mengulang sekali lagi memakai
    // hasil pertama → dua pantulan cahaya (bounce). Dilakukan sekali per siang/malam saat memuat.
    function captureProbe(k) {
      applyTOD(k);
      scene.environment = k ? W.envSkyNight : W.envSkyDay;
      var size = Q.name === 'high' ? 256 : 128, bounces = Q.name === 'high' ? 2 : 1;
      var cubeRT = new T.WebGLCubeRenderTarget(size, { type: T.HalfFloatType });
      var cam = new T.CubeCamera(0.1, 1500, cubeRT);
      cam.position.set(0, 3.2, 4.5);
      scene.add(cam);
      var pins = W.pins.map(function (p) { var v = p.sprite ? p.sprite.visible : true; if (p.sprite) p.sprite.visible = false; return v; });
      var pmrem = new T.PMREMGenerator(renderer), probe = null;
      W.capturing = true;
      for (var b = 0; b < bounces; b++) {
        renderer.shadowMap.needsUpdate = true;
        cam.update(renderer, scene);
        var next = pmrem.fromCubemap(cubeRT.texture);
        if (probe) probe.dispose();
        probe = next;
        scene.environment = probe.texture;
      }
      W.capturing = false;
      W.pins.forEach(function (p, i) { if (p.sprite) p.sprite.visible = pins[i]; });
      scene.remove(cam); cubeRT.dispose(); pmrem.dispose();
      return probe.texture;
    }

    // PCSS: bayangan matahari tajam di dekat kaki objek dan melembut makin jauh
    // (contact-hardening), seperti bayangan sungguhan. Hanya tier high.
    function installPCSS() {
      if (!Q.softShadows || T.ShaderChunk.shadowmap_pars_fragment.indexOf('pcssShadow') >= 0) return;
      var sc = W.sun.shadow.camera;
      var frustum = Math.max(sc.right - sc.left, sc.top - sc.bottom), range = sc.far - sc.near;
      var f = function (v) { return v.toFixed(6); };
      var code = [
        '#define PCSS_RANGE ' + f(range),
        '#define PCSS_FRUSTUM ' + f(frustum),
        '#define PCSS_SUN_TAN 0.022',                                      // ±1,3° (matahari + difusi kaca skylight)
        '#define PCSS_MAX_UV ' + f(0.9 / frustum),
        '#define PCSS_MIN_UV ' + f(1.6 / Q.shadowSize),
        'vec2 pcssDisk(int i, float n, float rot){ float r = sqrt((float(i) + 0.5) / n); float a = float(i) * 2.399963 + rot; return vec2(cos(a), sin(a)) * r; }',
        'float pcssShadow(sampler2D map, vec4 c){',
        '  float rot = rand(gl_FragCoord.xy) * 6.283185;',
        '  float zR = c.z, sum = 0.0, nb = 0.0;',
        '  for (int i = 0; i < 12; i++) {',
        '    float d = unpackRGBAToDepth(texture2D(map, c.xy + pcssDisk(i, 12.0, rot) * PCSS_MAX_UV));',
        '    if (d < zR) { sum += d; nb += 1.0; }',
        '  }',
        '  if (nb < 0.5) return 1.0;',
        '  float zB = sum / nb;',
        '  float r = clamp((zR - zB) * PCSS_RANGE * PCSS_SUN_TAN / PCSS_FRUSTUM, PCSS_MIN_UV, PCSS_MAX_UV);',
        '  float lit = 0.0;',
        '  for (int i = 0; i < 20; i++) lit += step(zR, unpackRGBAToDepth(texture2D(map, c.xy + pcssDisk(i, 20.0, rot + 1.3) * r)));',
        '  return lit / 20.0;',
        '}',
        ''
      ].join('\n');
      var chunk = T.ShaderChunk.shadowmap_pars_fragment;
      chunk = chunk.replace('#ifdef USE_SHADOWMAP', '#ifdef USE_SHADOWMAP\n' + code);
      chunk = chunk.replace('#if defined( SHADOWMAP_TYPE_PCF )', 'return pcssShadow( shadowMap, shadowCoord );\n\t\t#if defined( SHADOWMAP_TYPE_PCF )');
      T.ShaderChunk.shadowmap_pars_fragment = chunk;
    }

    function setupMaterials() {
      W.mat = new MaterialLibrary(W.tf, Q, W.envDay);
      W.B = new Builder(ctx.colliders);          // satu builder → geometri statis digabung per material
    }

    /* ----------------------------- arsitektur ---------------------------- */
    function buildArchitecture() {
      var M = W.mat, B = W.B.frame(0, 0, 0);
      var L = MALL.minZ, R = MALL.maxZ, len = R - L, cz = (L + R) / 2;

      // --- lantai koridor: marmer, apron granit, lis kuningan ---
      B.floor(M.marble, 0, cz, 11.2, len, 0, 2.4);
      [-1, 1].forEach(function (s) {
        B.floor(M.granite, s * 6.3, cz, 1.4, len, 0.001, 1.6);
        B.box(M.brass, s * 5.6, 0.002, cz, 0.05, 0.004, len);
      });
      // lingkaran inlay di sekitar air mancur
      [3.3, 3.55].forEach(function (r) {
        var g = new T.RingGeometry(r, r + 0.05, 96); g.rotateX(-Math.PI / 2); g.translate(0, 0.003, 0);
        B.add(M.brass, g);
      });
      var disc = new T.CircleGeometry(3.3, 96); disc.rotateX(-Math.PI / 2); disc.translate(0, 0.0015, 0);
      B.add(M.granite, disc);

      // --- dinding luar gedung ---
      var HT = LV.roof;
      B.box(M.plaster, MALL.minX - 0.25, HT / 2, cz, 0.5, HT, len, { tile: 2.5, collide: true });
      B.box(M.plaster, MALL.maxX + 0.25, HT / 2, cz, 0.5, HT, len, { tile: 2.5, collide: true });
      B.box(M.plaster, 0, HT / 2, L - 0.25, MALL.maxX - MALL.minX + 1, HT, 0.5, { tile: 2.5, collide: true });

      // --- mezanin: pelat, fascia tepi void, lampu cove, plafon bawah + downlight ---
      [-1, 1].forEach(function (s) {
        var xm = s * (VOID_X + 7) / 2, wm = 7 - VOID_X;
        B.box(M.fascia, xm, (LV.slabB + LV.slabT) / 2, cz, wm, LV.slabT - LV.slabB, len);
        B.box(M.fascia, s * (VOID_X + 0.04), 5.2, cz, 0.12, 0.62, len);                // tepi pelat
        B.box(M.ledWarm, s * (VOID_X + 0.16), 4.93, cz, 0.05, 0.03, len);               // cove LED
        B.plane(M.ceiling, xm, LV.slabB - 0.005, cz, wm, len, { rx: Math.PI / 2, tile: 2.5 });
        for (var z = L + 1.5; z < R; z += 3) {
          var dl = new T.CircleGeometry(0.11, 20); dl.rotateX(Math.PI / 2); dl.translate(s * 5.75, LV.slabB - 0.01, z);
          B.add(M.ledWarm, dl);
          var rim = new T.RingGeometry(0.11, 0.15, 20); rim.rotateX(Math.PI / 2); rim.translate(s * 5.75, LV.slabB - 0.012, z);
          B.add(M.metalSteel, rim);
        }
        // balustrade kaca + handrail di lantai 2
        var railL = len - 4.5, railC = cz + 2.25;                                       // berhenti sebelum jembatan utara
        B.box(M.glassRail, s * (VOID_X + 0.08), LV.slabT + 0.55, railC, 0.03, 1.05, railL);
        B.box(M.metalDark, s * (VOID_X + 0.08), LV.slabT + 0.04, railC, 0.1, 0.08, railL);
        B.cyl(M.metalSteel, s * (VOID_X + 0.08), LV.slabT + 1.1, railC, 0.03, 0.03, railL, { rx: Math.PI / 2, seg: 10 });
        // plafon & atap di atas deretan toko
        B.box(M.plaster, s * (7 + MALL.maxX) / 2, LV.roof + 0.2, cz, MALL.maxX - 7, 0.4, len, { tile: 2.5 });
        B.box(M.fascia, s * (VOID_X + 1.3), LV.roof + 0.35, cz, 2.6 + 0.2, 0.7, len);
        B.box(M.fascia, s * (VOID_X + 0.2), (LV.roof + LV.sky) / 2 + 0.2, cz, 0.3, LV.sky - LV.roof + 0.4, len);
      });

      // --- kolom bundar di bawah tepi mezanin ---
      COL_Z.forEach(function (z) {
        [-1, 1].forEach(function (s) {
          var x = s * 4.95;
          B.cyl(M.stoneLight, x, 2.5, z, 0.34, 0.34, 5.0, { seg: 28, collide: true });
          B.cyl(M.granite, x, 0.09, z, 0.42, 0.42, 0.18, { seg: 28 });
          B.torus(M.brass, x, 0.19, z, 0.37, 0.02, { rx: Math.PI / 2, ts: 40 });
          B.torus(M.metalSteel, x, 4.75, z, 0.36, 0.035, { rx: Math.PI / 2, ts: 40 });
          B.shadow(M, x, z, 1.6, 1.6);
        });
      });

      // --- pier batu di celah antar unit + dinding ujung di garis etalase ---
      [-1, 1].forEach(function (s) {
        COL_Z.forEach(function (z) { B.box(M.stoneLight, s * 7.1, LV.slabB / 2, z, 0.4, LV.slabB, 1.0, { collide: true }); });
        B.box(M.stoneLight, s * 7.1, LV.slabB / 2, 30, 0.4, LV.slabB, 4, { collide: true });
        B.box(M.stoneLight, s * 7.1, LV.slabB / 2, -35, 0.4, LV.slabB, 2, { collide: true });
      });

      // --- fasad lantai 2 (belum dibuka: interior gelap + tanda leasing) ---
      [-1, 1].forEach(function (s) {
        ctx.Z_SLOTS.forEach(function (z) {
          var x = s * 7;
          B.box(M.glass, x, (LV.slabT + LV.l2Top) / 2, z, 0.06, LV.l2Top - LV.slabT, 7.7);
          for (var k = -2; k <= 2; k++) B.box(M.metalDark, x, (LV.slabT + LV.l2Top) / 2, z + k * 1.925, 0.08, LV.l2Top - LV.slabT, 0.06);
          B.box(M.metalDark, x, LV.l2Top + 0.05, z, 0.1, 0.1, 8);
          B.box(M.paint('#2a2c31', 0.9), s * 9.5, (LV.slabT + LV.l2Top) / 2, z, 0.1, LV.l2Top - LV.slabT, 7.8);
          B.box(M.panel, s * 8.2, LV.l2Top - 0.35, z, 2.2, 0.04, 0.5);
          B.box(M.paint('#34373d', 0.95), s * 8.2, LV.slabT + 0.01, z, 2.4, 0.02, 7.8);
        });
        for (var i = 0; i < ctx.Z_SLOTS.length - 1; i++) {
          var zg = (ctx.Z_SLOTS[i] + ctx.Z_SLOTS[i + 1]) / 2;
          B.box(M.fascia, s * 7, (LV.slabT + LV.roof) / 2, zg, 0.4, LV.roof - LV.slabT, 1.0);
        }
      });

      // --- skylight: kaca + rangka baja + kuda-kuda di tiap garis kolom ---
      B.plane(M.glassSky, 0, LV.sky, cz, 9.8, len, { rx: Math.PI / 2 });
      for (var xr = -4.8; xr <= 4.81; xr += 1.2) B.box(M.metalSteel, xr, LV.sky - 0.06, cz, 0.08, 0.12, len);
      for (var zr = L + 0.4; zr < R; zr += 0.8) B.box(M.metalSteel, 0, LV.sky - 0.05, zr, 9.8, 0.07, 0.07);
      COL_Z.concat([28.5, -34.5]).forEach(function (z) {
        B.box(M.metalDark, 0, LV.sky - 0.3, z, 9.8, 0.12, 0.14);
        B.box(M.metalDark, 0, LV.roof + 0.15, z, 9.4, 0.1, 0.12);
        for (var k = -4; k < 4; k++) {
          var x0 = k * 1.15 + 0.575, up = (k % 2 === 0);
          B.box(M.metalDark, x0, (LV.roof + LV.sky) / 2 - 0.05, z, 0.05, Math.hypot(1.15, 0.55), 0.05, { rz: up ? 1.12 : -1.12 });
        }
      });

      // --- jembatan utara di lantai 2 (tempat eskalator tiba) ---
      B.box(M.fascia, 0, (LV.slabB + LV.slabT) / 2, L + 2, 14, LV.slabT - LV.slabB, 4);
      B.plane(M.ceiling, 0, LV.slabB - 0.005, L + 2, 14, 4, { rx: Math.PI / 2 });
      B.box(M.fascia, 0, 5.2, L + 4.04, 14, 0.62, 0.12);
      B.box(M.ledWarm, 0, 4.93, L + 4.16, 14, 0.03, 0.05);
      [-1, 1].forEach(function (s) {
        B.box(M.glassRail, s * 3.5, LV.slabT + 0.55, L + 4.02, 1.8, 1.05, 0.03);
        B.cyl(M.metalSteel, s * 3.5, LV.slabT + 1.1, L + 4.02, 0.03, 0.03, 1.8, { rz: Math.PI / 2, seg: 10 });
      });

      // --- dinding utara: panel kayu + logo menyala di atas jembatan ---
      for (var xs = -6.8; xs <= 6.8; xs += 0.2) B.box(M.woodDark, xs, 2.5, L + 0.06, 0.12, 5.0, 0.08);
      B.box(M.paint('#1b1d22', 0.6), 0, 7.6, L + 0.05, 14, 4.4, 0.05);

      // --- fasad masuk (selatan): kaca penuh + pintu otomatis terbuka ---
      var zS = R + 0.1;
      [-1, 1].forEach(function (s) {
        B.box(M.plaster, s * (6 + MALL.maxX) / 2, HT / 2, zS + 0.15, MALL.maxX - 6, HT, 0.5, { tile: 2.5, collide: true });
        B.box(M.glass, s * 4.1, 2.4, zS, 3.8, 4.8, 0.05);
        B.box(M.metalDark, s * 6.05, 2.55, zS, 0.12, 5.1, 0.2);
        B.box(M.metalDark, s * 2.2, 2.4, zS, 0.1, 4.8, 0.18);
      });
      B.box(M.metalDark, 0, 4.9, zS, 12.2, 0.2, 0.25);
      B.box(M.glass, 0, 7.6, zS, 12, 5.2, 0.05);
      for (var xm2 = -6; xm2 <= 6; xm2 += 1.5) B.box(M.metalDark, xm2, 7.6, zS, 0.07, 5.2, 0.12);
      B.box(M.metalDark, 0, LV.roof, zS, 12.2, 0.3, 0.3);
      // kanopi luar & keset
      B.box(M.metalDark, 0, 4.6, zS + 2.2, 13, 0.18, 4.4);
      B.box(M.ledWarm, 0, 4.5, zS + 4.35, 12.6, 0.03, 0.04);
      B.floor(M.paint('#2a2b2e', 0.95), 0, R - 1.3, 6, 2.2, 0.004);

      // --- plaza luar: paving + rumput ---
      B.floor(M.concrete, 0, R + 30, 160, 60, -0.02, 3);
      [-1, 1].forEach(function (s) { B.floor(M.paint('#5f7d45', 1), s * 22, R + 12, 18, 10, -0.01); });

    }

    /* ============================ unit & produk ============================ */
    // identitas visual tiap tenant (warna, huruf, lantai, dinding fitur)
    var BRANDS = {
      A1: { name: 'Nusantara Batik', sub: 'WASTRA · BATIK TULIS', style: 'serif', bg: '#2a1c12', fg: '#e8c88a', accent: '#c9964f', floor: 'wood', wall: '#6b4a2f', stock: ['#8c5a34', '#c9964f', '#3f5d52'] },
      A3: { name: 'TechNest', sub: 'GADGETS & WEARABLES', style: 'sans', bg: '#0a1220', fg: '#5fd4ff', accent: '#2aa9e0', floor: 'terrazzo', wall: '#18222f', stock: ['#2b3442', '#5fd4ff', '#e7ebf2'] },
      A4: { name: 'PORSCHE GALLERY', sub: 'CLASSIC · SINCE 1948', style: 'wide', bg: '#0c0c0e', fg: '#e9e9e9', accent: '#c8102e', floor: 'granite', wall: '#17181c', stock: [] },
      A6: { name: 'Kopi Senja', sub: 'SPECIALTY COFFEE', style: 'serif', bg: '#3a2417', fg: '#f3d9b1', accent: '#d98b4a', floor: 'wood', wall: '#5a3a26', stock: ['#6b4430', '#d98b4a', '#f3e6d0'] },
      B1: { name: 'Aroma Bakery', sub: 'PATISSERIE · ARTISAN BREAD', style: 'serif', bg: '#fbefe9', fg: '#a8435b', accent: '#e8a0b4', floor: 'terrazzo', wall: '#f1d7dc', stock: ['#e8a0b4', '#f6e2c0', '#c98b4b'] },
      B4: { name: 'ZEN FITNESS', sub: 'GYM · YOGA STUDIO', style: 'wide', bg: '#0e1d17', fg: '#7ee0a6', accent: '#39b77a', floor: 'rubber', wall: '#1d3429', stock: ['#2b2f38', '#5aa9a0', '#7ee0a6'] },
      K1: { name: 'Juice Bar Segar', sub: 'FRESH · COLD PRESSED', style: 'round', bg: '#ff8a1f', fg: '#ffffff', accent: '#ffb347', stock: [] }
    };
    var STATUS_HEX = { available: '#36d399', booked: '#5aa9ff' };

    function el(tag, attrs, parent) {
      var e = document.createElement(tag);
      for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(e);
      return e;
    }
    var DEG = 180 / Math.PI;

    // ---------- penggambar signage ----------
    function drawBrand(c, w, h, b, compact) {
      c.fillStyle = b.bg; c.fillRect(0, 0, w, h);
      c.textBaseline = 'middle'; c.fillStyle = b.fg;
      var sub = !compact && b.sub, nameY = sub ? h * 0.42 : h * 0.52;
      if (b.style === 'serif') {
        fit(c, b.name, 'italic 600', h * 0.56, 'serif', w * 0.86);
        spaced(c, b.name, w / 2, nameY, 0);
      } else if (b.style === 'wide') {
        var sp = h * 0.06;
        fit(c, b.name, '700', h * 0.4, 'wide', w * 0.86, sp);
        spaced(c, b.name, w / 2, nameY, sp);
      } else {
        fit(c, b.name, '800', h * 0.5, 'ui', w * 0.86);
        spaced(c, b.name, w / 2, nameY, 0);
      }
      if (sub) {
        c.globalAlpha = 0.8; c.fillStyle = b.fg;
        fit(c, b.sub, '600', h * 0.14, 'ui', w * 0.8, h * 0.03);
        spaced(c, b.sub, w / 2, h * 0.8, h * 0.03);
        c.globalAlpha = 1;
      }
    }
    function drawLeaseFascia(c, w, h, u, st) {
      var col = st === 'booked' ? STATUS_HEX.booked : STATUS_HEX.available;
      c.fillStyle = '#10151f'; c.fillRect(0, 0, w, h);
      c.textBaseline = 'middle';
      c.fillStyle = '#ffffff';
      fit(c, ctx.unitName(u).toUpperCase(), '700', h * 0.42, 'wide', w * 0.5, h * 0.05);
      spaced(c, ctx.unitName(u).toUpperCase(), w * 0.06, h * 0.52, h * 0.05, 'left');
      var tag = st === 'booked' ? ctx.t('w3.reserved') : ctx.t('w3.forLease');
      c.font = font('700', h * 0.3, 'wide');
      var tw = spacedWidth(c, tag, h * 0.04) + h * 0.9;
      roundRect(c, w * 0.94 - tw, h * 0.26, tw, h * 0.48, h * 0.24);
      c.fillStyle = col; c.fill();
      c.fillStyle = '#062015';
      spaced(c, tag, w * 0.94 - tw / 2, h * 0.515, h * 0.04);
    }
    // hoarding kaca kiri: pesan besar
    function drawHoardA(c, w, h, u, st) {
      var booked = st === 'booked', col = booked ? STATUS_HEX.booked : STATUS_HEX.available;
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0e1422'); g.addColorStop(1, booked ? '#0f2344' : '#0b2a22');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      // pola garis diagonal halus
      c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = w * 0.012;
      for (var i = -h; i < w + h; i += w * 0.09) { c.beginPath(); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke(); }
      c.textBaseline = 'middle';
      c.fillStyle = col;
      c.font = font('700', w * 0.07, 'wide');
      spaced(c, (booked ? ctx.t('w3.comingSoon') : ctx.t('w3.space')).toUpperCase(), w / 2, h * 0.2, w * 0.02);
      var big = (booked ? ctx.t('w3.reserved') : ctx.t('w3.forLease')).split(' ');
      c.fillStyle = '#ffffff';
      var size = w * 0.3;
      big.forEach(function (word) { size = Math.min(size, fit(c, word, '800', w * 0.3, 'wide', w * 0.84, w * 0.01)); });
      c.font = font('800', size, 'wide');
      big.forEach(function (word, i) { spaced(c, word, w / 2, h * 0.36 + i * size * 1.05, w * 0.01); });
      // kode unit bergaris
      c.lineWidth = w * 0.012; c.strokeStyle = 'rgba(255,255,255,.35)';
      c.font = font('800', w * 0.42, 'wide'); c.textAlign = 'center';
      c.strokeText(u.id, w / 2, h * 0.72);
      c.fillStyle = 'rgba(255,255,255,.75)';
      c.font = font('600', w * 0.055, 'ui');
      spaced(c, 'WOLFPUP LEASING', w / 2, h * 0.92, w * 0.015);
    }
    // hoarding kaca kanan: detail & CTA
    function drawHoardB(c, w, h, u, st) {
      var booked = st === 'booked', col = booked ? '#1f63c9' : '#0f8a5f';
      c.fillStyle = '#f4f1ea'; c.fillRect(0, 0, w, h);
      c.fillStyle = col; c.fillRect(0, 0, w, h * 0.012);
      c.textBaseline = 'middle'; c.fillStyle = '#10151f';
      c.font = font('800', w * 0.2, 'wide'); spaced(c, u.id, w * 0.08, h * 0.1, 0, 'left');
      c.fillStyle = '#5b6273'; c.font = font('600', w * 0.055, 'ui');
      spaced(c, ctx.L(u.cat).toUpperCase(), w * 0.08, h * 0.17, w * 0.01, 'left');
      function row(label, value, y, big) {
        c.fillStyle = '#7b8394'; c.font = font('600', w * 0.05, 'ui'); spaced(c, label.toUpperCase(), w * 0.08, y, w * 0.01, 'left');
        c.fillStyle = big ? col : '#10151f';
        fit(c, value, '800', big ? w * 0.12 : w * 0.1, 'ui', w * 0.84);
        spaced(c, value, w * 0.08, y + w * 0.1, 0, 'left');
      }
      if (booked) {
        var bk = ctx.bookingOf(u) || {};
        row(ctx.t('w3.tenant'), bk.brand || '—', h * 0.3);
        row(ctx.t('w3.term'), (bk.months || '—') + ' ' + ctx.t('w3.months'), h * 0.46);
        row(ctx.t('w3.status'), ctx.t('w3.openingSoon'), h * 0.62, true);
      } else {
        row(ctx.t('w3.size'), u.area + ' m²  ·  ' + u.width + ' × ' + u.depth + ' m', h * 0.3);
        row(ctx.t('w3.rent'), ctx.shortRp(u.monthly) + ' ' + ctx.t('w3.perMonth').toLowerCase(), h * 0.46, true);
        row(ctx.t('w3.bestFor'), ctx.L(u.tagline), h * 0.62);
      }
      // CTA
      roundRect(c, w * 0.08, h * 0.8, w * 0.84, h * 0.09, h * 0.045);
      c.fillStyle = '#10151f'; c.fill();
      c.fillStyle = '#ffffff';
      fit(c, ctx.t(booked ? 'w3.tapDetails' : 'w3.tapToRent'), '700', w * 0.065, 'ui', w * 0.76);
      spaced(c, ctx.t(booked ? 'w3.tapDetails' : 'w3.tapToRent'), w / 2, h * 0.845, 0);
    }
    function drawDecal(c, w, h, u) {
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = w * 0.006; c.setLineDash([w * 0.03, w * 0.02]);
      c.strokeRect(w * 0.04, h * 0.06, w * 0.92, h * 0.88); c.setLineDash([]);
      c.fillStyle = 'rgba(255,255,255,.72)'; c.textBaseline = 'middle';
      c.font = font('800', h * 0.28, 'wide'); spaced(c, u.area + ' m²', w / 2, h * 0.42, 0);
      c.font = font('600', h * 0.09, 'ui'); spaced(c, u.width + ' × ' + u.depth + ' m  ·  ' + ctx.t('w3.readyFitOut').toUpperCase(), w / 2, h * 0.7, h * 0.012);
    }
    function drawLabel(c, w, h, pr) {
      c.fillStyle = '#0f1115'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#c9a45c'; c.fillRect(0, 0, w * 0.018, h);
      c.textBaseline = 'middle';
      c.fillStyle = '#ffffff';
      fit(c, ctx.L(pr.name), '700', h * 0.3, 'ui', w * 0.88);
      spaced(c, ctx.L(pr.name), w * 0.07, h * 0.36, 0, 'left');
      c.fillStyle = '#e8c88a'; c.font = font('700', h * 0.24, 'ui');
      spaced(c, ctx.rupiah(pr.price), w * 0.07, h * 0.72, 0, 'left');
      c.fillStyle = '#ff8a1f'; c.font = font('800', h * 0.2, 'wide');
      spaced(c, 'AR', w * 0.93, h * 0.72, h * 0.02, 'right');
    }

    // bidang tanda dua sisi dalam satu geometri (depan +z, belakang -z)
    function twoSided(geom, gap) {
      var f = geom.clone(); f.translate(0, 0, gap);
      var b = geom.clone(); b.rotateY(Math.PI); b.translate(0, 0, -gap);
      return T.BufferGeometryUtils.mergeGeometries([f, b], false);
    }

    function makeSign(w, h, opts, draw) {
      opts = opts || {};
      opts.draw = draw; opts.aniso = W.tf.aniso;
      var s = new Sign(w, h, opts);
      if (opts.emissive) {
        s.material.emissive = new T.Color(0xffffff);
        s.material.emissiveMap = s.texture;
        s.material.emissiveIntensity = opts.emissive;
      }
      return s;
    }

    // ---------- pin hotspot ----------
    var PIN_TEX = {};
    function makePin(kind) {
      if (!PIN_TEX[kind]) PIN_TEX[kind] = pinTexture(kind);
      var sp = new T.Sprite(new T.SpriteMaterial({ map: PIN_TEX[kind], depthWrite: false, transparent: true, toneMapped: false }));
      sp.scale.set(0.46, 0.46, 1);
      sp.raycast = function () {};       // raycaster A-Frame tidak punya kamera → sprite tidak boleh di-raycast
      sp.renderOrder = 5;
      sp.userData.kind = kind;
      return sp;
    }
    function setPinKind(pin, kind) {
      if (!PIN_TEX[kind]) PIN_TEX[kind] = pinTexture(kind);
      pin.material.map = PIN_TEX[kind]; pin.material.needsUpdate = true; pin.userData.kind = kind;
    }

    // ---------- target klik (entitas A-Frame, tidak digambar) ----------
    function hitBox(parent, x, y, z, w, h, d, onClick, onEnter) {
      var e = el('a-box', {
        position: x + ' ' + y + ' ' + z, width: w, height: h, depth: d,
        material: 'visible: false', 'class': 'clickable'
      }, parent);
      e.addEventListener('click', onClick);
      e.addEventListener('mouseenter', onEnter);
      e.addEventListener('mouseleave', function () { ctx.onHover(null); });
      return e;
    }
    function hitPlane(parent, x, y, z, w, h, rotYdeg, onClick, onEnter) {
      var e = el('a-plane', {
        position: x + ' ' + y + ' ' + z, rotation: '0 ' + (rotYdeg || 0) + ' 0', width: w, height: h,
        material: 'visible: false; side: double', 'class': 'clickable'
      }, parent);
      e.addEventListener('click', onClick);
      e.addEventListener('mouseenter', onEnter);
      e.addEventListener('mouseleave', function () { ctx.onHover(null); });
      return e;
    }

    // Model produk hasil generator terdiri dari beberapa bagian berwarna; digabung
    // jadi satu mesh ber-vertex-color → satu draw call per produk.
    function mergeModel(modelEl) {
      var root = modelEl.getObject3D('mesh');
      if (!root) return;
      root.updateMatrixWorld(true);
      var inv = new T.Matrix4().copy(root.matrixWorld).invert(), geoms = [], rough = 0.5, rel = new T.Matrix4();
      root.traverse(function (o) {
        if (!o.isMesh) return;
        var g = o.geometry.clone();
        rel.multiplyMatrices(inv, o.matrixWorld); g.applyMatrix4(rel);
        if (!g.attributes.normal) g.computeVertexNormals();
        var n = g.attributes.position.count, src = g.attributes.color, base = (o.material && o.material.color) || new T.Color(1, 1, 1);
        var col = new Float32Array(n * 3);
        for (var i = 0; i < n; i++) {
          col[i * 3] = base.r * (src ? src.getX(i) : 1);
          col[i * 3 + 1] = base.g * (src ? src.getY(i) : 1);
          col[i * 3 + 2] = base.b * (src ? src.getZ(i) : 1);
        }
        var ng = new T.BufferGeometry();
        ng.setAttribute('position', g.attributes.position);
        ng.setAttribute('normal', g.attributes.normal);
        ng.setAttribute('color', new T.BufferAttribute(col, 3));
        if (g.index) ng.setIndex(g.index);
        if (o.material && o.material.roughness !== undefined) rough = o.material.roughness;
        geoms.push(ng);
      });
      if (geoms.length < 2) return;
      if (geoms.some(function (g) { return !g.index; })) geoms = geoms.map(function (g) { return g.index ? g.toNonIndexed() : g; });
      var merged = T.BufferGeometryUtils.mergeGeometries(geoms, false);
      if (!merged) return;
      var mesh = new T.Mesh(merged, new T.MeshStandardMaterial({ vertexColors: true, roughness: Math.max(0.35, rough), metalness: 0.05 }));
      mesh.castShadow = Q.shadows;
      for (var c = root.children.length - 1; c >= 0; c--) root.remove(root.children[c]);
      root.add(mesh);
    }

    // ---------- produk di dalam etalase kaca ----------
    function mountProduct(rec, B, pr, x, z, baseY, caseW) {
      var M = W.mat, cw = caseW || 0.9;
      // podium + etalase kaca + lampu kecil di atap etalase
      B.box(M.blackGloss, x, baseY / 2, z, cw + 0.1, baseY, cw + 0.1, { collide: true });
      B.box(M.brass, x, baseY + 0.01, z, cw + 0.12, 0.02, cw + 0.12);
      B.box(M.glassCase, x, baseY + 0.4, z, cw, 0.78, cw);
      B.box(M.metalDark, x, baseY + 0.8, z, cw + 0.02, 0.04, cw + 0.02);
      B.box(M.ledWarm, x, baseY + 0.775, z, cw * 0.6, 0.01, 0.06);
      B.shadow(M, x, z, cw + 0.8, cw + 0.8, true);

      var holder = el('a-entity', {
        position: x + ' ' + (baseY + 0.03 + pr.lift * (pr.show || 1)) + ' ' + z,
        animation: 'property: rotation; to: 0 360 0; loop: true; dur: 16000; easing: linear'
      }, rec.el);
      var sc = pr.scale * (pr.show || 1);
      var model = el('a-gltf-model', { src: pr.model, scale: sc + ' ' + sc + ' ' + sc, shadow: Q.shadows ? 'cast: true' : null }, holder);
      model.addEventListener('model-loaded', function () { mergeModel(model); });

      // label museum di sisi depan podium
      var lab = makeSign(0.8, 0.24, { px: 512 }, function (c, w, h) { drawLabel(c, w, h, pr); });
      lab.place(x, baseY * 0.62, z + (cw + 0.1) / 2 + 0.006, 0);
      rec.group.add(lab.mesh);
      W.i18n.push(lab);

      var pin = makePin('ar');
      pin.position.set(x, baseY + 1.25, z);
      rec.group.add(pin);
      W.pins.push({ sprite: pin, base: baseY + 1.25, phase: Math.random() * 6, product: pr });

      var enter = function () { ctx.onHover({ product: pr }); };
      var click = function () { ctx.onProductClick(pr); };
      hitBox(rec.el, x, baseY + 0.45, z, cw + 0.15, 0.95, cw + 0.15, click, enter);
      el('a-sphere', { position: x + ' ' + (baseY + 1.25) + ' ' + z, radius: 0.28, material: 'visible: false', 'class': 'clickable' }, rec.el)
        .addEventListener('click', click);
      rec.products.push({ pr: pr, pin: pin });
    }

    // ---------- toko (unit deret A/B) ----------
    function buildShop(u, root) {
      var M = W.mat, B = W.B.frame(0, 0, 0);
      var rotY = u.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
      var Wd = u.dz, D = u.dx, F = D / 2, door = ctx.DOOR_W;
      var brand = BRANDS[u.id];
      var tenant = u.baseStatus === 'rented';
      B.frame(u.cx, u.cz, rotY);

      var group = new T.Group();
      group.position.set(u.cx, 0, u.cz); group.rotation.y = rotY;
      W.root.add(group);
      var aEl = el('a-entity', { position: u.cx + ' 0 ' + u.cz, rotation: '0 ' + (rotY * DEG) + ' 0', id: 'unit-' + u.id }, root);
      var rec = W.units[u.id] = { u: u, group: group, el: aEl, products: [], signs: {} };

      // --- cangkang: lantai, dinding, plafon ---
      var floorMat = !tenant ? M.concrete
        : brand.floor === 'wood' ? M.wood : brand.floor === 'terrazzo' ? M.terrazzo
        : brand.floor === 'granite' ? M.granite : M.paint('#26292e', 0.9);
      B.floor(floorMat, 0, 0, Wd, D, 0.004, floorMat === M.wood ? 1.8 : 2);
      var wallMat = tenant ? M.plaster : M.paint('#d6d3cc', 0.95);
      B.box(wallMat, -Wd / 2, 2.3, 0, 0.3, 4.6, D, { collide: true, tile: 2.5 });
      B.box(wallMat, Wd / 2, 2.3, 0, 0.3, 4.6, D, { collide: true, tile: 2.5 });
      B.box(tenant ? M.paint(brand.wall, 0.8) : wallMat, 0, 2.3, -F, Wd, 4.6, 0.3, { collide: true, tile: 2.5 });
      B.plane(tenant ? M.ceiling : M.paint('#2a2c31', 1), 0, 4.2, 0, Wd, D, { rx: Math.PI / 2, tile: 2.5 });

      // --- portal etalase: pilaster, header, kaca bermulion, pintu ---
      var gz = F - 0.05;
      [-1, 1].forEach(function (s) {
        B.box(M.blackGloss, s * (Wd / 2 - 0.15), 2.3, F, 0.3, 4.6, 0.35, { collide: true });
        var gw = (Wd - 0.6 - door) / 2, gx = s * (door / 2 + gw / 2);
        B.box(M.glass, gx, 1.98, gz, gw, 3.8, 0.03, { collide: true });
        B.box(M.metalDark, s * door / 2, 1.98, gz, 0.07, 3.8, 0.12, { collide: true });
        B.box(M.blackGloss, gx, 0.04, gz, gw, 0.08, 0.1);
      });
      B.box(M.blackGloss, 0, 4.25, F, Wd, 0.7, 0.35);
      B.box(M.metalDark, 0, 3.9, gz, Wd - 0.6, 0.06, 0.12);
      B.box(M.brass, 0, 0.004, F, door, 0.008, 0.12);
      // strip LED status tepat di bawah header (material sendiri per unit)
      rec.strip = M.statusLed();
      var sg = new T.BoxGeometry(Wd - 0.7, 0.035, 0.03);
      var strip = new T.Mesh(sg, rec.strip);
      strip.position.set(0, 3.84, F + 0.03);
      group.add(strip);

      // --- signage fasad (menyala) ---
      rec.signs.fascia = makeSign(Wd - 0.8, 0.54, { glow: true, px: 1024 }, function (c, w, h) {
        var st = ctx.statusOf(u);
        if (st === 'rented') drawBrand(c, w, h, brand, true);
        else if (st === 'booked' && ctx.bookingOf(u)) {
          drawBrand(c, w, h, { name: ctx.bookingOf(u).brand, sub: ctx.t('w3.openingSoon').toUpperCase(), style: 'wide', bg: '#0f1d33', fg: '#dce9ff' }, false);
        } else drawLeaseFascia(c, w, h, u, st);
      });
      rec.signs.fascia.place(0, 4.25, F + 0.18, 0);
      group.add(rec.signs.fascia.mesh);
      W.i18n.push(rec.signs.fascia);

      // --- hit target di atas kaca (pintu tetap terbuka untuk sinar kursor) ---
      var enterUnit = function () { ctx.onHover({ unit: u }); };
      var clickUnit = function () { ctx.onUnitClick(u); };
      [-1, 1].forEach(function (s) {
        var gw = (Wd - 0.6 - door) / 2;
        hitPlane(aEl, s * (door / 2 + gw / 2), 2.1, F + 0.25, gw, 4.2, 0, clickUnit, enterUnit);
      });
      hitPlane(aEl, 0, 4.25, F + 0.3, Wd, 0.7, 0, clickUnit, enterUnit);

      if (tenant) buildTenantInterior(u, rec, B, brand, Wd, D, F);
      else buildVacantInterior(u, rec, B, Wd, D, F, enterUnit, clickUnit);

    }

    function buildTenantInterior(u, rec, B, brand, Wd, D, F) {
      var M = W.mat, rnd = mulberry32(u.id.charCodeAt(0) * 31 + u.id.charCodeAt(1));
      var showroom = u.id === 'A4';

      // panel lampu plafon
      for (var zz = -F + 1.5; zz < F - 0.8; zz += 2.2) {
        [-1.7, 1.7].forEach(function (x) { B.plane(M.panel, x, 4.19, zz, 1.2, 0.6, { rx: Math.PI / 2 }); });
      }
      // dinding fitur + logo menyala
      var logo = makeSign(Math.min(4.6, Wd - 2), 1.1, { glow: true, px: 1024, intensity: 0.95 }, function (c, w, h) { drawBrand(c, w, h, brand, false); });
      logo.place(0, 2.75, -F + 0.17, 0);
      rec.group.add(logo.mesh);
      B.box(M.brass, 0, 2.02, -F + 0.18, Math.min(4.6, Wd - 2), 0.02, 0.02);

      if (!showroom) {
        // rak dinding kiri-kanan berisi "stok" berwarna brand
        var palette = brand.stock.map(function (h) { return M.paint(h, 0.6); });
        [-1, 1].forEach(function (s) {
          var x = s * (Wd / 2 - 0.4), z0 = -F + 0.9, z1 = F - 1.8, len = z1 - z0, zc = (z0 + z1) / 2;
          B.box(M.woodDark, x + s * 0.2, 1.4, zc, 0.04, 2.6, len + 0.1);
          for (var zu = z0; zu <= z1 + 0.01; zu += len / 3) B.box(M.metalDark, x, 1.35, zu, 0.45, 2.7, 0.04);
          [0.45, 1.05, 1.65, 2.25].forEach(function (y) {
            B.box(M.woodDark, x, y, zc, 0.45, 0.03, len);
            for (var zi = z0 + 0.15; zi < z1 - 0.1; zi += 0.22 + rnd() * 0.12) {
              var hgt = 0.12 + rnd() * 0.26, wd = 0.1 + rnd() * 0.12;
              var mat = palette[(rnd() * palette.length) | 0];
              if (rnd() > 0.35) B.box(mat, x + s * 0.02, y + hgt / 2 + 0.015, zi, 0.26, hgt, wd);
              else B.cyl(mat, x + s * 0.02, y + hgt / 2 + 0.015, zi, wd * 0.45, wd * 0.45, hgt, { seg: 12 });
            }
          });
          B.collider(x, zc, 0.5, len, 0);
        });
      }

      // kasir di tengah belakang (sesuai sketsa: booth — cashier — booth)
      var kz = -F + 1.9;
      B.box(M.paint(brand.wall, 0.55), 0, 0.52, kz, 2.6, 0.96, 0.7, { collide: true });
      B.box(M.blackGloss, 0, 0.05, kz + 0.02, 2.5, 0.1, 0.62);
      B.box(M.stoneLight, 0, 1.03, kz, 2.8, 0.05, 0.82);
      B.box(M.brass, 0, 0.62, kz + 0.356, 2.6, 0.03, 0.01);
      var pos = new T.BoxGeometry(0.34, 0.24, 0.03); pos.rotateX(-0.35); pos.translate(0.6, 1.2, kz - 0.05);
      B.add(M.screen, pos);
      B.box(M.metalDark, 0.6, 1.08, kz - 0.08, 0.04, 0.1, 0.04);
      B.shadow(M, 0, kz, 3.4, 1.5, true);
      [-0.7, 0.7].forEach(function (x) {
        B.cyl(M.metalDark, x, 3.55, kz, 0.004, 0.004, 1.3, { seg: 4 });
        B.cyl(M.metalDark, x, 2.86, kz, 0.05, 0.11, 0.14, { seg: 16, open: true });
        B.cyl(M.ledWarm, x, 2.79, kz, 0.09, 0.09, 0.005, { seg: 16 });
      });
      var cashierSign = makeSign(0.9, 0.16, { glow: true, px: 256 }, function (c, w, h) {
        c.fillStyle = '#0f1115'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffffff'; c.textBaseline = 'middle';
        fit(c, ctx.t('w3.cashier').toUpperCase(), '700', h * 0.5, 'wide', w * 0.9, h * 0.08);
        spaced(c, ctx.t('w3.cashier').toUpperCase(), w / 2, h * 0.54, h * 0.08);
      });
      cashierSign.place(0, 0.7, kz + 0.358, 0);
      rec.group.add(cashierSign.mesh);
      W.i18n.push(cashierSign);

      // dua booth display (etalase kaca) mengapit jalur masuk
      var booths = u.products.filter(function (p) { return p.booth === 0 || p.booth === 1; });
      booths.forEach(function (pr) {
        var side = pr.booth === 0 ? -1 : 1;
        var bx = showroom ? side * (Wd / 2 - 1.3) : side * 1.75;
        var bz = showroom ? F - 2.0 : F - 3.2;
        mountProduct(rec, B, pr, bx, bz, 0.95, 0.9);
      });

      if (showroom) buildShowroom(u, rec, B, F);
    }

    function buildShowroom(u, rec, B, F) {
      var M = W.mat;
      B.cyl(M.blackGloss, 0, 0.12, 0, 2.6, 2.7, 0.24, { seg: 64, collide: true });
      B.torus(M.ledCool, 0, 0.245, 0, 2.45, 0.015, { rx: Math.PI / 2, ts: 96 });
      B.torus(M.ledCool, 0, 4.1, 0, 2.2, 0.03, { rx: Math.PI / 2, ts: 96 });
      B.cyl(M.metalDark, 0, 4.15, 0, 2.28, 2.28, 0.06, { seg: 64, open: true });
      B.shadow(M, 0, 0, 6.2, 6.2);
      var car = u.products.filter(function (p) { return p.booth === 'car'; })[0];
      var turn = el('a-entity', { position: '0 0.24 0', animation: 'property: rotation; to: 0 360 0; loop: true; dur: 26000; easing: linear' }, rec.el);
      el('a-gltf-model', { src: '#porsche-model', rotation: '0 90 0', shadow: Q.shadows ? 'cast: true' : null }, turn);
      if (car) {
        var enter = function () { ctx.onHover({ product: car }); };
        var click = function () { ctx.onProductClick(car); };
        hitBox(rec.el, 0, 0.9, 0, 4.6, 1.6, 4.6, click, enter);
        var pin = makePin('ar'); pin.position.set(0, 2.35, 0); rec.group.add(pin);
        W.pins.push({ sprite: pin, base: 2.35, phase: 1.3, product: car });
        el('a-sphere', { position: '0 2.35 0', radius: 0.3, material: 'visible: false', 'class': 'clickable' }, rec.el).addEventListener('click', click);
        var lab = makeSign(1.4, 0.42, { px: 512 }, function (c, w, h) { drawLabel(c, w, h, car); });
        lab.place(1.6, 0.9, F - 1.2, -0.35); rec.group.add(lab.mesh); W.i18n.push(lab);
        B.box(M.metalDark, 1.6, 0.4, F - 1.25, 0.06, 0.8, 0.06);
      }
      // tombol membuka panel produk mobil (pratinjau 3D + View in AR)
      var link = makeSign(2.2, 0.5, { glow: true, px: 512 }, function (c, w, h) {
        roundRect(c, 0, 0, w, h, h * 0.2); c.fillStyle = '#ffb020'; c.fill();
        c.fillStyle = '#241500'; c.textBaseline = 'middle';
        fit(c, ctx.t('w3.openShowroom'), '800', h * 0.36, 'wide', w * 0.86, h * 0.04);
        spaced(c, ctx.t('w3.openShowroom'), w / 2, h * 0.53, h * 0.04);
      });
      link.place(-2.4, 1.2, -F + 0.2, 0); rec.group.add(link.mesh); W.i18n.push(link);
      hitPlane(rec.el, -2.4, 1.2, -F + 0.25, 2.2, 0.5, 0, function () { ctx.onShowroom(); }, function () { ctx.onHover({ text: ctx.t('hint.showroom') }); });
    }

    function buildVacantInterior(u, rec, B, Wd, D, F, enterUnit, clickUnit) {
      var M = W.mat;
      // lampu kerja neon di plafon ekspos
      [-1.6, 1.6].forEach(function (x) {
        B.box(M.ledCool, x, 4.12, 0, 0.08, 0.04, D * 0.6);
        B.box(M.metalDark, x, 4.16, 0, 0.14, 0.05, D * 0.62);
      });
      // decal lantai: luas & dimensi
      rec.signs.decal = makeSign(4.6, 2.3, { transparent: true, px: 1024 }, function (c, w, h) { drawDecal(c, w, h, u); });
      rec.signs.decal.place(0, 0.01, -0.6, 0, -Math.PI / 2);
      rec.group.add(rec.signs.decal.mesh);
      W.i18n.push(rec.signs.decal);

      // hoarding di kedua panel kaca
      var gw = (Wd - 0.6 - ctx.DOOR_W) / 2;
      rec.signs.hoardA = makeSign(gw - 0.06, 3.7, { px: 512, emissive: 0.45 }, function (c, w, h) { drawHoardA(c, w, h, u, ctx.statusOf(u)); });
      rec.signs.hoardB = makeSign(gw - 0.06, 3.7, { px: 512, emissive: 0.45 }, function (c, w, h) { drawHoardB(c, w, h, u, ctx.statusOf(u)); });
      var sL = -1, sR = 1;                           // kiri/kanan dilihat dari koridor
      rec.signs.hoardA.place(sL * (ctx.DOOR_W / 2 + gw / 2), 1.98, F - 0.028, 0);
      rec.signs.hoardB.place(sR * (ctx.DOOR_W / 2 + gw / 2), 1.98, F - 0.028, 0);
      rec.group.add(rec.signs.hoardA.mesh); rec.group.add(rec.signs.hoardB.mesh);
      W.i18n.push(rec.signs.hoardA); W.i18n.push(rec.signs.hoardB);

      rec.pin = makePin('lease');
      rec.pin.position.set(0, 3.25, F + 0.5);
      rec.group.add(rec.pin);
      W.pins.push({ sprite: rec.pin, base: 3.25, phase: Math.random() * 6, unit: u });
      el('a-sphere', { position: '0 3.25 ' + (F + 0.5), radius: 0.3, material: 'visible: false', 'class': 'clickable' }, rec.el)
        .addEventListener('click', clickUnit);
    }

    // ---------- kios di koridor ----------
    function roundedSlab(B, mat, y, h, size, r, o) {
      var inner = size - 2 * r;
      B.box(mat, 0, y, 0, inner, h, size, o);
      B.box(mat, 0, y, 0, size, h, inner);
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (c) { B.cyl(mat, c[0] * inner / 2, y, c[1] * inner / 2, r, r, h, { seg: 16 }); });
    }
    function buildKiosk(u, root) {
      var M = W.mat, B = W.B.frame(0, 0, 0);
      var s = u.dx, tenant = u.baseStatus === 'rented', brand = BRANDS[u.id];
      B.frame(u.cx, u.cz, 0);
      var group = new T.Group(); group.position.set(u.cx, 0, u.cz); W.root.add(group);
      var aEl = el('a-entity', { position: u.cx + ' 0 ' + u.cz, id: 'unit-' + u.id }, root);
      var rec = W.units[u.id] = { u: u, group: group, el: aEl, products: [], signs: {} };

      roundedSlab(B, M.blackGloss, 0.05, 0.1, s - 0.12, 0.36);
      roundedSlab(B, tenant ? M.wood : M.fascia, 0.55, 0.9, s, 0.4);
      roundedSlab(B, M.terrazzo, 1.03, 0.06, s + 0.1, 0.45);
      B.collider(0, 0, s, s, 0);
      B.shadow(M, 0, 0, s + 1.4, s + 1.4, true);
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (c) { B.cyl(M.metalSteel, c[0] * (s / 2 - 0.35), 2.04, c[1] * (s / 2 - 0.35), 0.04, 0.04, 1.96, { seg: 10 }); });
      roundedSlab(B, M.fascia, 3.1, 0.2, s + 0.5, 0.5);
      B.plane(M.panel, 0, 2.995, 0, s - 0.6, s - 0.6, { rx: Math.PI / 2 });
      // lis LED status di tepi kanopi
      rec.strip = M.statusLed();
      var inner = s + 0.5 - 1.0, hs = (s + 0.5) / 2 + 0.005;
      var parts = [];
      [[0, hs, inner, 0], [0, -hs, inner, 0], [hs, 0, inner, Math.PI / 2], [-hs, 0, inner, Math.PI / 2]].forEach(function (a) {
        var bg = new T.BoxGeometry(a[2], 0.04, 0.03); bg.rotateY(a[3]); bg.translate(a[0], 0, a[1]); parts.push(bg);
      });
      [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]].forEach(function (a) {
        var tg = new T.TorusGeometry(0.505, 0.018, 6, 12, Math.PI / 2);
        tg.rotateZ(-a[2]); tg.rotateX(Math.PI / 2); tg.translate(a[0] * inner / 2, 0, a[1] * inner / 2); parts.push(tg);
      });
      var rim = new T.Mesh(T.BufferGeometryUtils.mergeGeometries(parts, false), rec.strip);
      rim.position.y = 3.02; group.add(rim);

      // papan nama dua sisi di atas kanopi
      B.box(M.blackGloss, 0, 3.52, 0, s - 0.6, 0.62, 0.08);
      rec.signs.fascia = makeSign(s - 0.7, 0.54, { glow: true, px: 1024 }, function (c, w, h) {
        var st = ctx.statusOf(u);
        if (st === 'rented') drawBrand(c, w, h, brand, true);
        else if (st === 'booked' && ctx.bookingOf(u)) drawBrand(c, w, h, { name: ctx.bookingOf(u).brand, style: 'wide', bg: '#0f1d33', fg: '#dce9ff' }, true);
        else drawLeaseFascia(c, w, h, u, st);
      });
      rec.signs.fascia.mesh.geometry = twoSided(rec.signs.fascia.mesh.geometry, 0.045);
      rec.signs.fascia.place(0, 3.52, 0, 0); group.add(rec.signs.fascia.mesh);
      W.i18n.push(rec.signs.fascia);

      var enterUnit = function () { ctx.onHover({ unit: u }); };
      var clickUnit = function () { ctx.onUnitClick(u); };
      hitBox(aEl, 0, 0.6, 0, s + 0.4, 1.2, s + 0.4, clickUnit, enterUnit);
      hitBox(aEl, 0, 3.52, 0, s - 0.6, 0.62, 0.3, clickUnit, enterUnit);

      if (tenant) {
        // dispenser jus & menu
        [-1.1, -0.7, -0.3].forEach(function (x, i) {
          B.cyl(M.glassCase, x, 1.3, -1.2, 0.14, 0.14, 0.42, { seg: 16 });
          B.cyl(M.paint(['#ffb84d', '#ff6f5b', '#9ad35a'][i], 0.3), x, 1.22, -1.2, 0.13, 0.13, 0.26, { seg: 16 });
          B.cyl(M.metalSteel, x, 1.08, -1.2, 0.15, 0.15, 0.04, { seg: 16 });
        });
        var pr = u.products.filter(function (p) { return p.booth === 'counter'; })[0];
        if (pr) mountProduct(rec, B, pr, 0.9, 0.9, 1.06, 0.7);
      } else {
        // hoarding membungkus keempat sisi counter
        rec.signs.wrap = makeSign(s - 0.8, 0.8, { px: 1024, emissive: 0.4 }, function (c, w, h) {
          var st = ctx.statusOf(u), col = st === 'booked' ? STATUS_HEX.booked : STATUS_HEX.available;
          c.fillStyle = '#10151f'; c.fillRect(0, 0, w, h);
          c.fillStyle = col; c.fillRect(0, h - h * 0.06, w, h * 0.06);
          c.textBaseline = 'middle'; c.fillStyle = '#ffffff';
          var big = (st === 'booked' ? ctx.t('w3.reserved') : ctx.t('w3.forLease')).toUpperCase();
          fit(c, big, '800', h * 0.34, 'wide', w * 0.55, h * 0.03);
          spaced(c, big, w * 0.05, h * 0.36, h * 0.03, 'left');
          c.fillStyle = col; c.font = font('700', h * 0.2, 'ui');
          spaced(c, u.id + '  ·  ' + u.area + ' m²  ·  ' + ctx.shortRp(u.monthly) + ' ' + ctx.t('w3.perMonth').toLowerCase(), w * 0.05, h * 0.7, 0, 'left');
        });
        var sides = [], d = s / 2 + 0.003;
        [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach(function (a) {
          var sg = rec.signs.wrap.mesh.geometry.clone(); sg.translate(0, 0, d); sg.rotateY(a); sides.push(sg);
        });
        var wrap = new T.Mesh(T.BufferGeometryUtils.mergeGeometries(sides, false), rec.signs.wrap.material);
        wrap.position.y = 0.58; group.add(wrap);
        W.i18n.push(rec.signs.wrap);
        rec.pin = makePin('lease'); rec.pin.position.set(0, 4.2, 0); group.add(rec.pin);
        W.pins.push({ sprite: rec.pin, base: 4.2, phase: Math.random() * 6, unit: u });
      }
    }

    // ---------- pembaruan status (dipanggil saat sewa/batal) ----------
    function updateUnit(u) {
      var rec = W.units[u.id];
      if (!rec) return;
      var st = ctx.statusOf(u), brand = BRANDS[u.id];
      var hex = st === 'rented' ? (brand ? brand.accent : '#ffe2bd') : STATUS_HEX[st];
      rec.strip.color.set(hex);
      rec.baseStripColor = rec.strip.color.clone();
      ['fascia', 'hoardA', 'hoardB', 'decal', 'wrap'].forEach(function (k) { if (rec.signs[k]) rec.signs[k].redraw(); });
      if (rec.pin) {
        rec.pin.visible = st !== 'rented';
        setPinKind(rec.pin, st === 'booked' ? 'reserved' : 'lease');
      }
    }

    /* ============================== properti & FX ============================= */
    // ---------- air mancur bertingkat + air beriak (shader) + semburan ----------
    function buildFountain() {
      var M = W.mat, B = W.B.frame(0, 0, 0);
      // bak bertingkat sebagai wadah terbuka: dinding luar, dinding dalam (menghadap ke dalam),
      // bibir atas berbentuk cincin, dan dasar — air terlihat di dalamnya
      var inner = W.mat.stoneInner || (W.mat.stoneInner = M.stoneLight.clone());
      inner.side = T.BackSide;
      function basin(rIn, rOut, y0, y1, floorMat) {
        B.cyl(M.stoneLight, 0, (y0 + y1) / 2, 0, rOut, rOut + 0.03, y1 - y0, { seg: 72, open: true });
        B.cyl(inner, 0, (y0 + y1) / 2 + 0.02, 0, rIn, rIn, y1 - y0 - 0.04, { seg: 72, open: true });
        var rim = new T.RingGeometry(rIn, rOut, 72); rim.rotateX(-Math.PI / 2); rim.translate(0, y1, 0);
        B.add(M.stoneLight, rim);
        var fl = new T.CircleGeometry(rIn, 72); fl.rotateX(-Math.PI / 2); fl.translate(0, y0 + 0.06, 0);
        B.add(floorMat, fl);
      }
      basin(2.5, 2.72, 0, 0.56, M.granite);
      B.torus(M.stoneLight, 0, 0.56, 0, 2.61, 0.1, { rx: Math.PI / 2, ts: 96, rs: 12 });
      B.cyl(M.stoneLight, 0, 0.35, 0, 1.12, 1.18, 0.7, { seg: 48 });               // alas tier 2 (di bawah air)
      basin(0.92, 1.08, 0.7, 1.22, M.granite);
      B.torus(M.brass, 0, 1.22, 0, 1.0, 0.03, { rx: Math.PI / 2, ts: 72 });
      B.cyl(M.stoneLight, 0, 1.5, 0, 0.12, 0.22, 0.56, { seg: 24 });
      basin(0.52, 0.62, 1.78, 2.0, M.stoneLight);
      B.collider(0, 0, 5.5, 5.5, 0);
      B.shadow(M, 0, 0, 7.2, 7.2);

      var wn = W.tf.waterNormal(); wn.repeat.set(3, 3);
      var water = new T.MeshStandardMaterial({
        color: 0x1d5f7a, roughness: 0.12, metalness: 0, normalMap: wn, normalScale: new T.Vector2(0.45, 0.45),
        envMapIntensity: 0.75, transparent: true, opacity: 0.95
      });
      water.onBeforeCompile = function (shader) {
        shader.uniforms.uTime = { value: 0 };
        water.userData.shader = shader;
        shader.fragmentShader = 'uniform float uTime;\n' + shader.fragmentShader.replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          'vec3 mapA = texture2D( normalMap, vNormalMapUv + uTime * vec2( 0.021, 0.013 ) ).xyz * 2.0 - 1.0;\n' +
          '\tvec3 mapB = texture2D( normalMap, vNormalMapUv * 1.63 - uTime * vec2( 0.017, -0.026 ) ).xyz * 2.0 - 1.0;\n' +
          '\tvec3 mapN = normalize( vec3( mapA.xy + mapB.xy, mapA.z * mapB.z ) );');
      };
      [[2.5, 0.47], [0.92, 1.15], [0.52, 1.95]].forEach(function (d) {
        var g = new T.CircleGeometry(d[0], 64); g.rotateX(-Math.PI / 2);
        var m = new T.Mesh(g, water); m.position.y = d[1]; W.root.add(m);
      });
      W.ticks.push(function (t) { if (water.userData.shader) water.userData.shader.uniforms.uTime.value = t; });

      if (!Q.jets) return;
      // semburan: tetesan instanced di lintasan parabola dari 8 nosel ke tengah + air terjun tier atas
      var drops = new T.InstancedMesh(new T.SphereGeometry(0.035, 6, 4),
        new T.MeshBasicMaterial({ color: 0xe6f6ff, transparent: true, opacity: 0.75 }), 8 * 14 + 40);
      drops.frustumCulled = false;
      W.root.add(drops);
      var m4 = new T.Matrix4(), v = new T.Vector3(), sc = new T.Vector3();
      W.ticks.push(function (t) {
        var i = 0;
        for (var j = 0; j < 8; j++) {
          var a = j / 8 * Math.PI * 2, sx = Math.cos(a) * 2.35, sz = Math.sin(a) * 2.35;
          for (var k = 0; k < 14; k++) {
            var p = ((t * 0.55 + k / 14 + j * 0.13) % 1);
            v.set(lerp(sx, sx * 0.45, p), 0.55 + Math.sin(p * Math.PI) * 1.05, lerp(sz, sz * 0.45, p));
            var s2 = 0.7 + Math.sin(p * Math.PI) * 0.6; sc.set(s2, s2 * 1.4, s2);
            m4.compose(v, drops.quaternion, sc); drops.setMatrixAt(i++, m4);
          }
        }
        for (var q = 0; q < 40; q++) {
          var ang = q / 40 * Math.PI * 2 + t * 0.2, pr = ((t * 0.9 + q * 0.37) % 1);
          v.set(Math.cos(ang) * 0.6, 1.99 - pr * 0.75, Math.sin(ang) * 0.6);
          sc.set(0.6, 2.2, 0.6); m4.compose(v, drops.quaternion, sc); drops.setMatrixAt(i++, m4);
        }
        drops.instanceMatrix.needsUpdate = true;
      });
    }

    // ---------- eskalator naik-turun ke jembatan utara (anak tangga bergerak) ----------
    function buildEscalators() {
      var M = W.mat, B = W.B.frame(0, 0, 0);
      var z0 = -22.4, z1 = -32.0, rise = LV.slabT, run = z0 - z1, k = rise / run;
      function shearAlong(g) {                         // naikkan y seiring z berkurang
        var m = new T.Matrix4().makeShear(0, 0, 0, 0, 0, -k);
        g.applyMatrix4(m);
        return g;
      }
      [-1.25, 1.25].forEach(function (x, idx) {
        // badan rangka (cladding bawah) + skirt
        var body = new T.BoxGeometry(1.5, 1.0, run); body.translate(0, -0.45, -run / 2);
        shearAlong(body); body.translate(x, 0, z0); B.add(M.fascia, body);
        [-1, 1].forEach(function (s) {
          var gl = new T.BoxGeometry(0.02, 0.92, run); gl.translate(0, 0.56, -run / 2);
          shearAlong(gl); gl.translate(x + s * 0.66, 0, z0); B.add(M.glassRail, gl);
          var hr = new T.BoxGeometry(0.09, 0.05, run + 0.6); hr.translate(0, 1.04, -run / 2);
          shearAlong(hr); hr.translate(x + s * 0.66, 0, z0); B.add(M.rubber, hr);
          var sk = new T.BoxGeometry(0.06, 0.16, run); sk.translate(0, 0.03, -run / 2);
          shearAlong(sk); sk.translate(x + s * 0.53, 0, z0); B.add(M.metalSteel, sk);
        });
        B.box(M.metalSteel, x, 0.01, z0 + 0.7, 1.2, 0.02, 1.4);
        B.box(M.metalSteel, x, rise + 0.01, z1 - 0.3, 1.2, 0.02, 1.0);

        // anak tangga instanced
        var n = Math.ceil(run / 0.4) + 2;
        var steps = new T.InstancedMesh(new T.BoxGeometry(1.0, 0.2, 0.4), M.metalSteel, n);
        steps.frustumCulled = false; W.root.add(steps);
        var m4 = new T.Matrix4(), pos = new T.Vector3(), one = new T.Vector3(1, 1, 1), qn = new T.Quaternion();
        var dir = idx === 0 ? 1 : -1;
        W.ticks.push(function (t) {
          var off = ((t * 0.45 * dir) % 0.4 + 0.4) % 0.4;
          for (var i = 0; i < n; i++) {
            var d = i * 0.4 + off - 0.4;                 // jarak horizontal dari bawah
            var dc = Math.max(0, Math.min(run, d));
            var yTop = Math.max(0, Math.min(rise, (dc - 0.8) * k * run / (run - 1.6)));
            pos.set(x, yTop - 0.1, z0 - dc);
            m4.compose(pos, qn, one); steps.setMatrixAt(i, m4);
          }
          steps.instanceMatrix.needsUpdate = true;
        });
      });
      B.collider(0, (z0 + z1) / 2 + 0.2, 3.3, run + 0.8, 0);
      B.shadow(M, 0, z0 + 0.3, 4, 2.2, true);
      W.features.push({ type: 'rect', x1: -1.65, x2: 1.65, z1: z1, z2: z0 + 0.4, label: 'ESC' });
    }

    // ---------- tanaman ----------
    function palm(B, x, z, h, rnd) {
      var M = W.mat, segs = 7, lean = (rnd() - 0.5) * 0.25, px = x, pz = z, y = 0;
      for (var i = 0; i < segs; i++) {
        var sh = h / segs, r = lerp(0.16, 0.1, i / segs);
        B.cyl(M.bark, px, y + sh / 2, pz, r * 0.92, r, sh * 1.02, { seg: 10 });
        B.torus(M.bark, px, y + sh * 0.95, pz, r * 0.98, 0.018, { rx: Math.PI / 2, ts: 12, rs: 4 });
        y += sh; px += lean * sh * 0.3;
      }
      var fronds = 11;
      for (var f = 0; f < fronds; f++) {
        var len = 1.9 + rnd() * 0.6, g = new T.PlaneGeometry(0.55, len, 1, 8);
        var p = g.attributes.position;
        for (var vtx = 0; vtx < p.count; vtx++) {
          var ty = (p.getY(vtx) + len / 2) / len;             // 0 di pangkal → 1 di ujung
          p.setY(vtx, ty * len * 0.92);
          p.setZ(vtx, -Math.pow(ty, 2) * len * (0.45 + rnd() * 0.05));
          p.setX(vtx, p.getX(vtx) * (0.4 + Math.sin(ty * Math.PI) * 0.8));
        }
        g.computeVertexNormals();
        g.rotateX(-0.35 - rnd() * 0.5);
        g.rotateY(f / fronds * Math.PI * 2 + rnd() * 0.3);
        g.translate(px, y - 0.05, pz);
        B.add(M.frond, g);
      }
    }
    function shrubs(B, x, z, w, d, count, rnd, top) {
      var M = W.mat;
      for (var i = 0; i < count; i++) {
        var sx = x + (rnd() - 0.5) * w, sz = z + (rnd() - 0.5) * d, s = 0.45 + rnd() * 0.35;
        for (var k = 0; k < 3; k++) {
          var g = new T.PlaneGeometry(s * 1.2, s);
          g.translate(0, s / 2, 0); g.rotateY(k / 3 * Math.PI + rnd());
          g.translate(sx, top, sz); B.add(M.foliage, g);
        }
      }
    }

    // ---------- pulau taman + bangku di tengah koridor ----------
    function buildIslands() {
      var M = W.mat, B = W.B.frame(0, 0, 0), rnd = mulberry32(404);
      ctx.ISLANDS.forEach(function (iz) {
        var len = 5.0;
        B.box(M.planter, 0, 0.25, iz, 1.3, 0.5, len);
        [-1, 1].forEach(function (s) { B.box(M.brass, s * 0.64, 0.505, iz, 0.03, 0.012, len); });
        B.box(M.soil, 0, 0.5, iz, 1.18, 0.05, len - 0.12);
        shrubs(B, 0, iz, 1.0, len - 0.5, 22 * Q.flora | 0, rnd, 0.52);
        palm(B, 0, iz, 5.2, rnd);
        [-1, 1].forEach(function (s) {
          var bx = s * 0.95;
          for (var k = 0; k < 5; k++) B.box(M.wood, bx + s * (k - 2) * 0.085, 0.45, iz, 0.07, 0.04, len - 0.6);
          [-1.6, 0, 1.6].forEach(function (dz) { B.box(M.metalDark, bx, 0.22, iz + dz, 0.42, 0.44, 0.06); });
        });
        B.collider(0, iz, 2.4, len, 0);
        B.shadow(M, 0, iz, 3.2, len + 0.9, true);
        W.features.push({ type: 'rect', x1: -1.2, x2: 1.2, z1: iz - len / 2, z2: iz + len / 2, label: '' });
      });
      // ficus di sisi pintu masuk + palem di plaza luar
      [-1, 1].forEach(function (s) {
        var x = s * 5.6, z = 30.6;
        B.cyl(M.metalDark, x, 0.4, z, 0.42, 0.34, 0.8, { seg: 24, collide: true });
        B.cyl(M.soil, x, 0.79, z, 0.39, 0.39, 0.02, { seg: 20 });
        shrubs(B, x, z, 0.5, 0.5, 10 * Q.flora | 0, rnd, 0.9);
        shrubs(B, x, z, 0.35, 0.35, 8 * Q.flora | 0, rnd, 1.5);
        B.shadow(M, x, z, 1.4, 1.4);
        [[9, 36], [16, 41], [10, 50]].forEach(function (p) {
          B.cyl(M.planter, s * p[0], 0.25, p[1], 0.9, 0.95, 0.5, { seg: 24 });
          palm(B, s * p[0], p[1], 6 + rnd() * 1.5, rnd);
        });
      });
    }

    // ---------- signage global: logo, spanduk, direktori digital, meja leasing ----------
    function drawWordmark(c, w, h, dark) {
      if (dark) { c.fillStyle = '#121419'; c.fillRect(0, 0, w, h); }
      c.textBaseline = 'middle';
      c.fillStyle = '#ffb020';
      fit(c, 'WOLFPUP', '800', h * 0.5, 'wide', w * 0.9, h * 0.1);
      spaced(c, 'WOLFPUP', w / 2, h * 0.42, h * 0.1);
      c.fillStyle = '#f4f1ea';
      fit(c, 'VIRTUAL MALL', '600', h * 0.17, 'wide', w * 0.6, h * 0.12);
      spaced(c, 'VIRTUAL MALL', w / 2, h * 0.8, h * 0.12);
    }
    function buildSignage() {
      var M = W.mat, B = W.B.frame(0, 0, 0), L0 = MALL.minZ, R0 = MALL.maxZ;

      var north = makeSign(9, 2.2, { glow: true, px: 1024 }, function (c, w, h) { drawWordmark(c, w, h, false); });
      north.material.transparent = true; north.place(0, 7.7, L0 + 0.09, 0); W.root.add(north.mesh);
      var l2 = makeSign(6, 0.5, { glow: true, px: 1024 }, function (c, w, h) {
        c.fillStyle = '#10151f'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffffff'; c.textBaseline = 'middle';
        fit(c, ctx.t('w3.floor2'), '700', h * 0.42, 'wide', w * 0.9, h * 0.06);
        spaced(c, ctx.t('w3.floor2'), w / 2, h * 0.54, h * 0.06);
      });
      l2.place(0, 5.2, L0 + 4.11, 0); W.root.add(l2.mesh); W.i18n.push(l2);

      var inside = makeSign(7, 0.9, { glow: true, px: 1024 }, function (c, w, h) { drawWordmark(c, w, h, true); });
      inside.place(0, 5.45, R0 - 0.02, Math.PI); W.root.add(inside.mesh);
      var outside = makeSign(10, 1.6, { glow: true, px: 1024 }, function (c, w, h) { drawWordmark(c, w, h, false); });
      outside.material.transparent = true; outside.place(0, 5.6, R0 + 0.25, 0); W.root.add(outside.mesh);

      // papan penunjuk arah menggantung
      B.box(M.metalDark, 0, 4.0, 23.5, 5.2, 0.62, 0.08);
      [-2.2, 2.2].forEach(function (x) { B.cyl(M.metalSteel, x, 4.7, 23.5, 0.006, 0.006, 0.8, { seg: 4 }); });
      function wayDraw(leftKey, rightKey, mid) {
        return function (c, w, h) {
          c.fillStyle = '#121419'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffffff'; c.textBaseline = 'middle';
          c.font = font('700', h * 0.34, 'wide');
          spaced(c, '← ' + ctx.t(leftKey), w * 0.04, h * 0.52, h * 0.03, 'left');
          spaced(c, ctx.t(rightKey) + ' →', w * 0.96, h * 0.52, h * 0.03, 'right');
          c.fillStyle = '#ffb020'; c.font = font('700', h * 0.3, 'ui');
          spaced(c, mid(), w / 2, h * 0.52, 0);
        };
      }
      // dilihat dari pintu masuk (menghadap utara) Blok A ada di kiri; dari arah sebaliknya tertukar
      var wayF = makeSign(5.1, 0.55, { glow: true, px: 1024 }, wayDraw('w3.blockA', 'w3.blockB', function () { return '↑ ' + ctx.t('w3.escalator'); }));
      wayF.place(0, 4.0, 23.545, 0); W.root.add(wayF.mesh); W.i18n.push(wayF);
      var wayB = makeSign(5.1, 0.55, { glow: true, px: 1024 }, wayDraw('w3.blockB', 'w3.blockA', function () { return '↑ ' + ctx.t('w3.exit'); }));
      wayB.place(0, 4.0, 23.455, Math.PI); W.root.add(wayB.mesh); W.i18n.push(wayB);

      // spanduk menggantung dari rangka skylight (bergoyang pelan)
      W.banner = makeSign(1.5, 3.4, { glow: true, px: 512, double: true, intensity: 0.92 }, function (c, w, h) {
        var s = ctx.stats();
        var g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ff9f1c'); g.addColorStop(1, '#ff5e3a');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        c.fillStyle = 'rgba(255,255,255,.12)'; for (var i = 0; i < 9; i++) c.fillRect(0, h * 0.06 + i * h * 0.11, w, h * 0.004);
        c.fillStyle = '#241500'; c.textBaseline = 'middle';
        c.font = font('800', w * 0.5, 'wide'); spaced(c, String(s.available), w / 2, h * 0.22, 0);
        fit(c, ctx.t('w3.spacesAvail').toUpperCase(), '700', w * 0.1, 'wide', w * 0.86, w * 0.01);
        spaced(c, ctx.t('w3.spacesAvail').toUpperCase(), w / 2, h * 0.36, w * 0.01);
        c.fillStyle = '#ffffff'; c.font = font('600', w * 0.08, 'ui');
        spaced(c, ctx.t('w3.from'), w / 2, h * 0.5, 0);
        fit(c, ctx.shortRp(s.minPrice), '800', w * 0.16, 'ui', w * 0.86);
        spaced(c, ctx.shortRp(s.minPrice), w / 2, h * 0.58, 0);
        c.font = font('600', w * 0.07, 'ui'); spaced(c, ctx.t('w3.perMonth').toLowerCase(), w / 2, h * 0.66, 0);
        c.fillStyle = '#241500'; c.font = font('800', w * 0.1, 'wide'); spaced(c, 'WOLFPUP', w / 2, h * 0.88, w * 0.02);
      });
      W.banners = [];
      [15, -3, -21].forEach(function (z, i) {
        var m = new T.Mesh(W.banner.mesh.geometry, W.banner.material);
        m.position.set(0, 8.2, z); W.root.add(m);
        B.box(M.metalDark, 0, 9.93, z, 1.6, 0.05, 0.05);
        B.cyl(M.metalSteel, 0, 10.4, z, 0.005, 0.005, 1.0, { seg: 4 });
        W.banners.push({ mesh: m, phase: i * 1.7 });
      });
      W.ticks.push(function (t) { W.banners.forEach(function (b) { b.mesh.rotation.z = Math.sin(t * 0.6 + b.phase) * 0.012; b.mesh.rotation.y = Math.sin(t * 0.35 + b.phase) * 0.05; }); });

      // direktori digital (layar berdiri) di plaza masuk
      var dx = -4.3, dz = 28.6;
      B.box(M.metalDark, dx, 1.2, dz, 1.3, 2.4, 0.22, { collide: true });
      B.box(M.brass, dx, 0.02, dz, 1.4, 0.04, 0.34);
      B.shadow(M, dx, dz, 2.0, 1.0, true);
      W.directory = makeSign(1.14, 2.0, { glow: true, px: 512, intensity: 0.95 }, function (c, w, h) { drawDirectory(c, w, h); });
      W.directory.place(dx, 1.3, dz + 0.115, 0); W.root.add(W.directory.mesh); W.i18n.push(W.directory);
      var dirEl = el('a-plane', { position: dx + ' 1.3 ' + (dz + 0.13), width: 1.14, height: 2.0, material: 'visible: false', 'class': 'clickable' }, ctx.unitsRoot);
      dirEl.addEventListener('click', function () { ctx.onDirectory(); });
      dirEl.addEventListener('mouseenter', function () { ctx.onHover({ text: ctx.t('hint.directory') }); });
      dirEl.addEventListener('mouseleave', function () { ctx.onHover(null); });

      // meja leasing office
      var lx = 4.3, lz = 28.2;
      B.cyl(M.wood, lx, 0.52, lz, 1.3, 1.3, 1.04, { seg: 40, t0: -Math.PI * 0.45, tl: Math.PI * 0.9, open: true });
      B.cyl(M.stoneLight, lx, 1.07, lz, 1.38, 1.38, 0.06, { seg: 40, t0: -Math.PI * 0.47, tl: Math.PI * 0.94 });
      B.box(M.wood, lx, 0.52, lz - 0.3, 1.9, 1.04, 0.1);
      B.box(M.blackGloss, lx, 1.55, lz - 1.1, 2.4, 1.0, 0.08);
      var pos = new T.BoxGeometry(0.42, 0.28, 0.03); pos.rotateX(-0.3); pos.translate(lx + 0.4, 1.27, lz + 0.3); B.add(M.screen, pos);
      B.collider(lx, lz, 2.8, 1.6, 0);
      B.shadow(M, lx, lz + 0.3, 3.2, 2.2);
      var desk = makeSign(2.3, 0.9, { glow: true, px: 1024 }, function (c, w, h) {
        c.fillStyle = '#0f1115'; c.fillRect(0, 0, w, h); c.textBaseline = 'middle';
        c.fillStyle = '#ffb020'; fit(c, ctx.t('w3.leasingOffice'), '800', h * 0.3, 'wide', w * 0.9, h * 0.04);
        spaced(c, ctx.t('w3.leasingOffice'), w / 2, h * 0.36, h * 0.04);
        c.fillStyle = '#ffffff'; fit(c, ctx.t('w3.leasingCta'), '600', h * 0.16, 'ui', w * 0.9);
        spaced(c, ctx.t('w3.leasingCta'), w / 2, h * 0.7, 0);
      });
      desk.place(lx, 1.55, lz - 1.055, 0); W.root.add(desk.mesh); W.i18n.push(desk);
      var deskEl = el('a-box', { position: lx + ' 0.9 ' + lz, width: 2.6, height: 1.8, depth: 1.8, material: 'visible: false', 'class': 'clickable' }, ctx.unitsRoot);
      deskEl.addEventListener('click', function () { ctx.onLeasing(); });
      deskEl.addEventListener('mouseenter', function () { ctx.onHover({ text: ctx.t('hint.leasing') }); });
      deskEl.addEventListener('mouseleave', function () { ctx.onHover(null); });
      W.features.push({ type: 'rect', x1: dx - 0.65, x2: dx + 0.65, z1: dz - 0.2, z2: dz + 0.2, label: '' });
      W.features.push({ type: 'rect', x1: lx - 1.3, x2: lx + 1.3, z1: lz - 0.6, z2: lz + 0.8, label: '' });

      // tanda lantai 2 di beberapa fasad atas
      [[-1, 15], [1, -3], [-1, -21], [1, 24]].forEach(function (p) {
        var s = makeSign(3.2, 0.45, { glow: true, px: 512, intensity: 0.85 }, function (c, w, h) {
          c.fillStyle = '#16181d'; c.fillRect(0, 0, w, h); c.fillStyle = '#e9e6df'; c.textBaseline = 'middle';
          fit(c, ctx.t('w3.l2Soon'), '700', h * 0.4, 'wide', w * 0.9, h * 0.05);
          spaced(c, ctx.t('w3.l2Soon'), w / 2, h * 0.54, h * 0.05);
        });
        s.place(p[0] * 6.96, 8.9, p[1], -p[0] * Math.PI / 2); W.root.add(s.mesh); W.i18n.push(s);
      });

    }

    function drawDirectory(c, w, h) {
      c.fillStyle = '#0c1018'; c.fillRect(0, 0, w, h);
      c.textBaseline = 'middle'; c.fillStyle = '#ffb020';
      fit(c, ctx.t('w3.directory'), '800', w * 0.1, 'wide', w * 0.86, w * 0.015);
      spaced(c, ctx.t('w3.directory'), w / 2, h * 0.06, w * 0.015);
      c.fillStyle = '#9aa3b5'; c.font = font('600', w * 0.05, 'ui');
      spaced(c, ctx.t('w3.groundFloor'), w / 2, h * 0.105, 0);
      // denah mini berwarna status
      var mx = w * 0.12, my = h * 0.15, mw = w * 0.76, mh = h * 0.62;
      var sx = mw / (MALL.maxX - MALL.minX), sz = mh / (MALL.maxZ - MALL.minZ);
      c.fillStyle = '#1b2230'; c.fillRect(mx, my, mw, mh);
      c.fillStyle = '#2a3242'; c.fillRect(mx + (ctx.FRONT_L - MALL.minX) * sx, my, (ctx.FRONT_R - ctx.FRONT_L) * sx, mh);
      ctx.UNITS.forEach(function (u) {
        var st = ctx.statusOf(u);
        c.fillStyle = st === 'available' ? STATUS_HEX.available : st === 'booked' ? STATUS_HEX.booked : '#5a6272';
        var x = mx + (u.cx - u.dx / 2 - MALL.minX) * sx, y = my + (u.cz - u.dz / 2 - MALL.minZ) * sz;
        c.fillRect(x + 1, y + 1, u.dx * sx - 2, u.dz * sz - 2);
        c.fillStyle = '#0c1018'; c.font = font('700', w * 0.035, 'ui');
        spaced(c, u.id, x + u.dx * sx / 2, y + u.dz * sz / 2, 0);
      });
      c.fillStyle = '#ffb020'; c.beginPath();
      c.arc(mx + (0 - MALL.minX) * sx, my + (29 - MALL.minZ) * sz, w * 0.02, 0, Math.PI * 2); c.fill();
      c.font = font('700', w * 0.04, 'ui'); spaced(c, ctx.t('w3.youAreHere'), mx + (0 - MALL.minX) * sx, my + (29 - MALL.minZ) * sz + w * 0.05, 0);
      // legenda
      var ly = h * 0.82;
      [[STATUS_HEX.available, ctx.t('w3.legendAvail')], [STATUS_HEX.booked, ctx.t('w3.legendRes')], ['#5a6272', ctx.t('w3.legendLeased')]].forEach(function (it, i) {
        var x = w * 0.1 + i * w * 0.28;
        c.fillStyle = it[0]; c.fillRect(x, ly - w * 0.018, w * 0.036, w * 0.036);
        c.fillStyle = '#dfe5f0'; c.font = font('600', w * 0.04, 'ui'); spaced(c, it[1], x + w * 0.05, ly, 0, 'left');
      });
      roundRect(c, w * 0.1, h * 0.88, w * 0.8, h * 0.07, h * 0.035); c.fillStyle = '#ffb020'; c.fill();
      c.fillStyle = '#241500'; fit(c, ctx.t('w3.tapBrowse'), '700', w * 0.055, 'ui', w * 0.72);
      spaced(c, ctx.t('w3.tapBrowse'), w / 2, h * 0.915, 0);
    }

    // ---------- berkas cahaya matahari dari skylight (additive) ----------
    function buildShafts() {
      if (!Q.shafts) return;
      var dir = W.sunDir.clone().negate();
      var mat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        uniforms: { uTime: { value: 0 }, uStrength: { value: 1 }, uColor: { value: new T.Color(1.0, 0.88, 0.66) } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: [
          'uniform float uTime; uniform float uStrength; uniform vec3 uColor; varying vec2 vUv;',
          'void main(){',
          '  float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);',
          '  float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.8, vUv.y) * (0.35 + vUv.y * 0.65);',
          '  float shimmer = 0.85 + 0.15 * sin(uTime * 0.7 + vUv.x * 9.0 + vUv.y * 3.0);',
          '  gl_FragColor = vec4(uColor * edge * fade * shimmer * 0.085 * uStrength, 1.0);',
          '}'].join('\n')
      });
      W.shaftMat = mat;
      W.ticks.push(function (t) { mat.uniforms.uTime.value = t; });
      var len = LV.sky / -dir.y;
      var q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, -1, 0), dir);
      [[1.6, 14], [1.2, -1], [1.8, -16]].forEach(function (p) {
        var top = new T.Vector3(p[0], LV.sky, p[1]);
        var mid = top.clone().addScaledVector(dir, len / 2);
        for (var k = 0; k < 2; k++) {
          var g = new T.PlaneGeometry(2.2, len);
          var m = new T.Mesh(g, mat);
          m.quaternion.copy(q);
          m.rotateY(k * Math.PI / 2);
          m.position.copy(mid);
          m.renderOrder = 3;
          W.root.add(m);
        }
      });
    }

    // ---------- lampu taman plaza luar: menyala saat malam ----------
    function buildLamps() {
      var M = W.mat, B = W.B.frame(0, 0, 0);
      var glowMat = new T.SpriteMaterial({ map: W.tf.glow(), color: 0xffcf8a, transparent: true, opacity: 0,
        depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
      W.lampGlows = []; W.lampHeads = [];
      [[-6.5, 35.5], [6.5, 35.5], [-13, 38], [13, 38], [-6.5, 46], [6.5, 46]].forEach(function (p) {
        B.cyl(M.metalDark, p[0], 2.2, p[1], 0.05, 0.07, 4.4, { seg: 10 });
        B.cyl(M.metalDark, p[0], 0.1, p[1], 0.2, 0.22, 0.2, { seg: 14 });
        var headMat = new T.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false });
        var head = new T.Mesh(new T.CylinderGeometry(0.16, 0.2, 0.34, 14), headMat);
        head.position.set(p[0], 4.55, p[1]); W.root.add(head); W.lampHeads.push(headMat);
        var g = new T.Sprite(glowMat.clone()); g.scale.set(3.2, 3.2, 1);
        g.position.set(p[0], 4.55, p[1]); g.raycast = function () {}; W.root.add(g); W.lampGlows.push(g);
      });
    }

    // ---------- reticle lantai untuk tap-to-move ----------
    function buildReticle() {
      var g = new T.Group();
      var ring = new T.Mesh(new T.RingGeometry(0.26, 0.31, 48),
        new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
      var disc = new T.Mesh(new T.CircleGeometry(0.26, 48),
        new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
      var pulse = new T.Mesh(new T.RingGeometry(0.3, 0.33, 48),
        new T.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      [ring, disc, pulse].forEach(function (m) { m.rotation.x = -Math.PI / 2; m.renderOrder = 6; g.add(m); });
      g.position.y = 0.02; g.visible = false;
      W.root.add(g);
      W.reticle = { group: g, ring: ring, disc: disc, pulse: pulse, pingT: -1, pingPos: new T.Vector3() };
      W.ticks.push(function (t, dt) {
        var r = W.reticle;
        if (r.group.visible) { var s = 1 + Math.sin(t * 4) * 0.04; r.ring.scale.set(s, s, s); }
        if (r.pingT >= 0) {
          r.pingT += dt;
          var p = r.pingT / 0.6;
          if (p >= 1) { r.pingT = -1; r.pulse.material.opacity = 0; }
          else {
            r.pulse.position.set(r.pingPos.x - r.group.position.x, 0, r.pingPos.z - r.group.position.z);
            var sc = 1 + p * 2.2; r.pulse.scale.set(sc, sc, sc); r.pulse.material.opacity = (1 - p) * 0.9;
          }
        }
      });
    }

    function buildFloorHit(root) {
      var e = el('a-plane', {
        position: '0 0 ' + ((MALL.minZ + MALL.maxZ) / 2), rotation: '-90 0 0',
        width: MALL.maxX - MALL.minX, height: MALL.maxZ - MALL.minZ,
        material: 'visible: false', 'class': 'floor-hit'
      }, root);
      return e;
    }

    /* ============================ loop & API ============================== */
    var camPos = new T.Vector3();
    function animatePins(t) {
      var cam = sceneEl.camera;
      if (cam) cam.getWorldPosition(camPos);
      W.pins.forEach(function (p) {
        var sp = p.sprite;
        if (!sp.visible && p.unit && ctx.statusOf(p.unit) === 'rented') return;
        var wp = sp.getWorldPosition(new T.Vector3());
        var d = camPos.distanceTo(wp);
        var hov = (p.product && W.hover.product === p.product) || (p.unit && W.hover.unit === p.unit);
        var target = hov ? 0.62 : 0.46;
        var s = lerp(sp.scale.x, target, 0.2);
        sp.scale.set(s, s, 1);
        sp.position.y = p.base + Math.sin(t * 2 + p.phase) * 0.05;
        sp.material.opacity = clamp01(1 - (d - 14) / 12);
      });
    }

    function setHover(target) {
      var prevUnit = W.hover.unit;
      W.hover.unit = target && target.unit || null;
      W.hover.product = target && target.product || null;
      if (prevUnit && prevUnit !== W.hover.unit) {
        var r0 = W.units[prevUnit.id]; if (r0 && r0.baseStripColor) r0.strip.color.copy(r0.baseStripColor);
      }
      if (W.hover.unit) {
        var r1 = W.units[W.hover.unit.id];
        if (r1 && r1.baseStripColor) r1.strip.color.copy(r1.baseStripColor).multiplyScalar(2.4);
      }
    }

    /* ------------------- refleksi planar lantai marmer (high) ------------------- */
    // Lantai koridor dirender ulang dari kamera cermin (setengah resolusi) lalu disisipkan
    // ke radiance lapisan clearcoat marmer. Fresnel clearcoat membuat pantulan kuat di
    // sudut miring dan tipis saat melihat ke bawah; roughness noda poles mengaburkan
    // pantulan lewat mipmap.
    function buildFloorReflection() {
      var M = W.mat.marble;
      if (!Q.reflect || !M.isMeshPhysicalMaterial) return;
      var floorMeshes = [];
      W.root.traverse(function (o) { if (o.isMesh && o.material === M) floorMeshes.push(o); });
      if (!floorMeshes.length) return;
      var rt = new T.WebGLRenderTarget(4, 4, {
        type: T.HalfFloatType, generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter
      });
      var uniforms = { tReflect: { value: rt.texture }, uReflectMatrix: { value: new T.Matrix4() }, uReflect: { value: 1 } };
      var mirror = new T.PerspectiveCamera(), normal = new T.Vector3(0, 1, 0);
      var camPos = new T.Vector3(), rot = new T.Matrix4(), lookAt = new T.Vector3(), planePt = new T.Vector3();
      var view = new T.Vector3(), target = new T.Vector3(), plane = new T.Plane(), clip = new T.Vector4(), q = new T.Vector4();
      var size = new T.Vector2(), dirty = true;

      M.onBeforeCompile = function (sh) {
        Object.assign(sh.uniforms, uniforms);
        sh.vertexShader = 'uniform mat4 uReflectMatrix;\nvarying vec4 vReflUv;\n' + sh.vertexShader.replace('#include <project_vertex>',
          '#include <project_vertex>\nvReflUv = uReflectMatrix * (modelMatrix * vec4(transformed, 1.0));');
        sh.fragmentShader = 'uniform sampler2D tReflect;\nuniform float uReflect;\nvarying vec4 vReflUv;\n' + sh.fragmentShader.replace('#include <lights_fragment_maps>', [
          '#include <lights_fragment_maps>',
          '{',
          '  vec2 ruv = vReflUv.xy / vReflUv.w + normal.xy * 0.012;',
          '  vec2 edge = smoothstep(0.0, 0.06, ruv) * smoothstep(0.0, 0.06, 1.0 - ruv);',
          '  float lod = clamp(material.clearcoatRoughness * 14.0, 0.0, 5.0);',
          '  vec3 refl = textureLod(tReflect, ruv, lod).rgb;',
          '  clearcoatRadiance = mix(clearcoatRadiance, refl, uReflect * edge.x * edge.y);',
          '}'
        ].join('\n'));
      };
      M.customProgramCacheKey = function () { return 'marble-planar'; };
      M.needsUpdate = true;

      function render(renderer, _scene, camera) {
        // di VR (WebXR) refleksi planar dimatikan; lantai kembali memakai IBL clearcoat
        var xr = renderer.xr.isPresenting || W.capturing;
        uniforms.uReflect.value = xr ? 0 : 1;
        if (!dirty || xr || !camera.isPerspectiveCamera) return;
        dirty = false;
        renderer.getDrawingBufferSize(size);
        var w = Math.max(4, Math.round(size.x * Q.reflect)), h = Math.max(4, Math.round(size.y * Q.reflect));
        if (rt.width !== w || rt.height !== h) rt.setSize(w, h);

        // kamera cermin terhadap bidang y = 0 (sama seperti Reflector three.js)
        camPos.setFromMatrixPosition(camera.matrixWorld);
        if (camPos.y < 0.05) return;
        planePt.set(camPos.x, 0, camPos.z);
        rot.extractRotation(camera.matrixWorld);
        lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
        view.subVectors(planePt, camPos).reflect(normal).negate().add(planePt);
        target.subVectors(planePt, lookAt).reflect(normal).negate().add(planePt);
        mirror.position.copy(view);
        mirror.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
        mirror.lookAt(target);
        mirror.near = camera.near; mirror.far = camera.far;
        mirror.updateMatrixWorld();
        mirror.projectionMatrix.copy(camera.projectionMatrix);
        mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
        uniforms.uReflectMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
          .multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

        // near plane miring: potong semua yang ada di bawah lantai
        plane.setFromNormalAndCoplanarPoint(normal, planePt).applyMatrix4(mirror.matrixWorldInverse);
        clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
        var pm = mirror.projectionMatrix.elements;
        q.x = (Math.sign(clip.x) + pm[8]) / pm[0];
        q.y = (Math.sign(clip.y) + pm[9]) / pm[5];
        q.z = -1; q.w = (1 + pm[10]) / pm[14];
        clip.multiplyScalar(2 / clip.dot(q));
        pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1 - 0.003; pm[14] = clip.w;

        var prevTarget = renderer.getRenderTarget(), prevXr = renderer.xr.enabled, prevShadow = renderer.shadowMap.autoUpdate;
        floorMeshes.forEach(function (m) { m.visible = false; });
        var ret = W.reticle && W.reticle.group, retVisible = ret && ret.visible;
        if (ret) ret.visible = false;
        renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
        renderer.setRenderTarget(rt);
        renderer.state.buffers.depth.setMask(true);
        if (renderer.autoClear === false) renderer.clear();
        renderer.render(scene, mirror);
        renderer.xr.enabled = prevXr; renderer.shadowMap.autoUpdate = prevShadow;
        renderer.setRenderTarget(prevTarget);
        floorMeshes.forEach(function (m) { m.visible = true; });
        if (ret) ret.visible = retVisible;
      }
      floorMeshes[0].onBeforeRender = render;
      W.ticks.push(function () { dirty = true; });
      W.reflection = { target: rt, uniforms: uniforms };
    }

    // Saat post-processing aktif, tone mapping ACES pindah ke OutputPass dan ikut mengenai
    // material "menyala" (toneMapped: false) → neon jadi pucat. Warna targetnya dibalik
    // lewat invers ACES di shader: setelah OutputPass hasilnya kembali persis warna aslinya,
    // sementara nilainya di buffer HDR cukup tinggi untuk memicu bloom.
    function acesInverseUniforms() {
      function colsToMat(a, b, c) { return new T.Matrix3().set(a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]); }
      return {
        uHdrOn: { value: 1 },
        uHdrExposure: { value: renderer.toneMappingExposure },
        uAcesInInv: { value: colsToMat([0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]).invert() },
        uAcesOutInv: { value: colsToMat([1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]).invert() }
      };
    }
    var INV_ACES_GLSL = [
      'uniform float uHdrOn; uniform float uHdrExposure; uniform mat3 uAcesInInv; uniform mat3 uAcesOutInv;',
      'vec3 invAces(vec3 y, float peak) {',
      '  y = uAcesOutInv * clamp(y, 0.0, peak);',
      '  vec3 A = 1.0 - 0.983729 * y, B = 0.0245786 - 0.432951 * y, C = -0.000090537 - 0.238081 * y;',
      '  vec3 v = (-B + sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);',
      '  return max(uAcesInInv * v, 0.0) * 0.6 / uHdrExposure;',
      '}'
    ].join('\n');
    function hdrEmissive(peakPlain, peakMapped, peakGlow) {
      W.hdrU = acesInverseUniforms();
      var seen = [];
      scene.traverse(function (o) {
        var m = o.material;
        if (!m || Array.isArray(m) || m.toneMapped !== false || seen.indexOf(m) >= 0) return;
        if (!(m.isMeshBasicMaterial || m.isSpriteMaterial)) return;
        seen.push(m);
        // LED polos boleh mendekati putih penuh (bloom kuat); signage bergambar dibatasi supaya teks tidak "meleleh"
        var peak = (m.userData.hdrPeak || (m.blending === T.AdditiveBlending ? peakGlow : m.map ? peakMapped : peakPlain)).toFixed(3);
        var prev = m.onBeforeCompile;
        m.onBeforeCompile = function (sh, r) {
          if (prev) prev.call(this, sh, r);
          Object.assign(sh.uniforms, W.hdrU);
          sh.fragmentShader = INV_ACES_GLSL + '\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
            'if (uHdrOn > 0.5) outgoingLight = invAces(outgoingLight, ' + peak + ');\n#include <opaque_fragment>');
        };
        m.customProgramCacheKey = function () { return 'invaces' + peak; };
        m.needsUpdate = true;
      });
      return seen.length;
    }

    function refreshDynamic() {
      if (W.banner) W.banner.redraw();
      if (W.directory) W.directory.redraw();
    }

    var api = {
      quality: Q.name,
      // mode: 'day' | 'night'; instant=true tanpa animasi (dipakai saat memuat)
      setTimeOfDay: function (mode, instant) {
        W.tod.target = mode === 'night' ? 1 : 0;
        if (instant) applyTOD(W.tod.target);
      },
      timeOfDay: function () { return W.tod.target === 1 ? 'night' : 'day'; },
      // dipanggil mall.html setelah MallPost.attach(); post boleh null (tier low / gagal)
      attachPost: function (post) {
        W.post = post || null;
        if (!post) return;
        // puncak rendah = glow halus; signage di bawah ambang bloom supaya teks tetap tajam
        W.mat.panel.userData.hdrPeak = 0.9;
        hdrEmissive(0.965, 0.86, 0.74);
        var k = W.tod.k;
        post.setNight(k * k * (3 - 2 * k));
      },
      features: W.features,
      updateUnit: function (u) { updateUnit(u); refreshDynamic(); },
      refreshTexts: function () { W.i18n.forEach(function (s) { s.redraw(); }); refreshDynamic(); },
      setHover: setHover,
      reticle: {
        show: function (x, z, valid) {
          var r = W.reticle; if (!r) return;
          r.group.visible = true; r.group.position.x = x; r.group.position.z = z;
          var col = valid ? 0xffffff : 0x9aa3b5;
          r.ring.material.color.setHex(col); r.ring.material.opacity = valid ? 0.9 : 0.35;
          r.disc.material.opacity = valid ? 0.18 : 0.06;
        },
        hide: function () { if (W.reticle) W.reticle.group.visible = false; },
        ping: function (x, z) { var r = W.reticle; if (!r) return; r.pingPos.set(x, 0, z); r.pingT = 0; }
      },
      reflection: function () { return W.reflection || null; },
      stats: function () {
        var calls = renderer.info.render.calls, tris = renderer.info.render.triangles;
        return { calls: calls, triangles: tris, quality: Q.name, pixelRatio: renderer.getPixelRatio() };
      }
    };

    function startLoop() {
      sceneEl.addBehavior({
        el: sceneEl,
        tick: function (time, delta) {
          var t = time / 1000, dt = Math.min((delta || 16) / 1000, 0.1);
          W.time = t;
          if (W.tod && W.tod.k !== W.tod.target) {          // transisi siang↔malam ±1,6 detik
            var k = W.tod.k + Math.sign(W.tod.target - W.tod.k) * dt / 1.6;
            applyTOD(W.tod.target > W.tod.k ? Math.min(k, W.tod.target) : Math.max(k, W.tod.target));
          }
          // tanpa composer (VR / post dimatikan) warna emisif tidak perlu dibalik dari ACES
          if (W.hdrU) W.hdrU.uHdrOn.value = W.post && W.post.isActive() ? 1 : 0;
          for (var i = 0; i < W.ticks.length; i++) W.ticks[i](t, dt);
          animatePins(t);
        }
      });
    }

    var root = ctx.unitsRoot;
    sceneEl.mallWorld = api;      // pegangan untuk debugging dari konsole
    return Promise.resolve()
      .then(step('lighting', 0.08, function () { setupRenderer(); setupLighting(); }))
      .then(step('materials', 0.2, setupMaterials))
      .then(step('architecture', 0.45, buildArchitecture))
      .then(step('stores', 0.6, function () {
        ctx.UNITS.forEach(function (u) { if (u.kind === 'shop') buildShop(u, root); else buildKiosk(u, root); });
        ctx.UNITS.forEach(updateUnit);
      }))
      .then(step('details', 0.8, function () {
        buildFountain(); buildEscalators(); buildIslands(); buildSignage(); buildShafts(); buildLamps(); buildReticle();
        api.floorEl = buildFloorHit(root);
        W.features.push({ type: 'circle', x: 0, z: 0, r: 2.75, label: '' });
      }))
      .then(step('finish', 0.95, function () {
        W.B.flush(W.root, Q.shadows);
        buildFloorReflection();
        fitShadow();
        installPCSS();
        if (W.pano) {
          // semua material PBR: simpan envMapIntensity asli → diskalakan applyTOD
          var seenM = [];
          W.envMats = [];
          scene.traverse(function (o) {
            var m = o.material;
            if (!m || Array.isArray(m) || !m.isMeshStandardMaterial || seenM.indexOf(m) >= 0) return;
            seenM.push(m); W.envMats.push({ m: m, base: m.envMapIntensity });
          });
          // model produk (GLB) dimuat belakangan → ikut didaftarkan
          sceneEl.addEventListener('model-loaded', function (ev) {
            var root = ev.detail && ev.detail.model, k = W.tod.k, e = k * k * (3 - 2 * k);
            var gain = lerp(TOD.day.envGain, TOD.night.envGain, e);
            if (root) root.traverse(function (o) {
              var m = o.material;
              if (!m || Array.isArray(m) || !m.isMeshStandardMaterial || seenM.indexOf(m) >= 0) return;
              seenM.push(m); W.envMats.push({ m: m, base: m.envMapIntensity });
              m.envMapIntensity *= gain;
            });
          });
          W.envDay = captureProbe(0);
          W.envNight = captureProbe(1);
        }
        applyTOD(ctx.timeOfDay === 'night' ? 1 : 0);
        W.tod.target = W.tod.k;
        refreshDynamic();
        startLoop();
      }))
      .then(function () { if (ctx.progress) ctx.progress(1, 'ready'); return api; });
  }

  window.MallWorld = { create: create, presets: PRESETS, detectQuality: detectQuality };
})();
