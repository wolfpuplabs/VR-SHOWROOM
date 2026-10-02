/* =====================================================================
   WOLFPUP VIRTUAL MALL — suara (WebAudio, disintesis tanpa berkas audio)
   ---------------------------------------------------------------------
   - Air mancur: loop 6 detik yang dibangkitkan saat mulai (desir air
     berfilter + ratusan "plip" tetesan bergaya resonansi gelembung),
     diposisikan 3D (HRTF) di tengah atrium.
   - Langkah kaki: hentakan tumit + gesekan sol, karakter menyesuaikan
     permukaan (marmer, kayu, beton, karpet, paving), variasi acak per
     langkah supaya tidak terdengar berulang.
   - Room tone halus supaya mall tidak terasa "mati".
   Browser hanya mengizinkan audio setelah interaksi pengguna → start()
   dipanggil dari klik tombol masuk / sentuhan pertama.
   ===================================================================== */
(function () {
  'use strict';

  var ctx = null, master = null, fountain = null, room = null, listenerReady = false;
  var muted = false, started = false, lastStepSide = 1;
  var LS_MUTE = 'wolfpup-mall-mute-v1';
  try { muted = localStorage.getItem(LS_MUTE) === '1'; } catch (e) {}

  function rand(a, b) { return a + Math.random() * (b - a); }

  // loop air mancur: dibuat sekali, ujung-ujungnya di-crossfade supaya mulus
  function fountainBuffer(c) {
    var sr = c.sampleRate, len = Math.floor(sr * 6), fade = Math.floor(sr * 0.25);
    var buf = c.createBuffer(2, len + fade, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      // desir: noise pink (Paul Kellet) dengan modulasi pelan
      var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (var i = 0; i < d.length; i++) {
        var w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        var pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.06; b6 = w * 0.115926;
        var mod = 0.75 + 0.25 * Math.sin(i / sr * 1.7 + ch) * Math.sin(i / sr * 0.43);
        d[i] = pink * mod;
      }
      // tetesan: sinus pendek dengan pitch naik (gelembung) dan peluruhan cepat
      var drops = 900;
      for (var k = 0; k < drops; k++) {
        var t0 = Math.floor(Math.random() * (len - sr * 0.05));
        var f = rand(500, 2600), dur = rand(0.008, 0.035), amp = rand(0.02, 0.11) * (Math.random() < 0.1 ? 2.2 : 1);
        var n = Math.floor(dur * sr), ph = 0;
        for (var j = 0; j < n; j++) {
          var tt = j / sr, env = Math.exp(-tt / (dur * 0.3)) * Math.min(1, j / 20);
          ph += 2 * Math.PI * f * (1 + tt * 18) / sr;
          d[t0 + j] += Math.sin(ph) * env * amp;
        }
      }
      // crossfade ekor ke awal → loop tanpa klik
      for (var x = 0; x < fade; x++) {
        var a = x / fade;
        d[x] = d[x] * a + d[len + x] * (1 - a);
      }
    }
    // potong ke panjang loop
    var out = c.createBuffer(2, len, sr);
    for (var ch2 = 0; ch2 < 2; ch2++) out.getChannelData(ch2).set(buf.getChannelData(ch2).subarray(0, len));
    return out;
  }

  function noiseBuffer(c, seconds) {
    var b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  var NOISE = null;

  function start() {
    if (started) { resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    started = true;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    // kompresor ringan supaya puncak tetesan tidak pecah di speaker tablet
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    NOISE = noiseBuffer(ctx, 1.0);

    // --- air mancur, posisi 3D ---
    var src = ctx.createBufferSource();
    src.buffer = fountainBuffer(ctx); src.loop = true;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    var hs = ctx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 3000; hs.gain.value = 3;
    var g = ctx.createGain(); g.gain.value = 1.4;
    var pan = ctx.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
    pan.refDistance = 3.5; pan.maxDistance = 80; pan.rolloffFactor = 1.15;
    setPos(pan, 0, 1.0, 0);
    src.connect(lp); lp.connect(hs); hs.connect(g); g.connect(pan); pan.connect(master);
    src.start();
    fountain = { src: src, gain: g, panner: pan };

    // --- room tone: dengung udara mall yang sangat halus ---
    var rt = ctx.createBufferSource(); rt.buffer = noiseBuffer(ctx, 3); rt.loop = true;
    var rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 420;
    var rg = ctx.createGain(); rg.gain.value = 0.035;
    rt.connect(rlp); rlp.connect(rg); rg.connect(master); rt.start();
    room = rg;
    resume();
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function setPos(node, x, y, z) {
    if (node.positionX) { node.positionX.value = x; node.positionY.value = y; node.positionZ.value = z; }
    else node.setPosition(x, y, z);
  }

  // dipanggil tiap frame dengan posisi & arah kamera (dunia)
  function updateListener(pos, forward, up) {
    if (!ctx) return;
    var L = ctx.listener;
    if (L.positionX) {
      var t = ctx.currentTime;
      L.positionX.setTargetAtTime(pos.x, t, 0.03); L.positionY.setTargetAtTime(pos.y, t, 0.03); L.positionZ.setTargetAtTime(pos.z, t, 0.03);
      L.forwardX.setTargetAtTime(forward.x, t, 0.03); L.forwardY.setTargetAtTime(forward.y, t, 0.03); L.forwardZ.setTargetAtTime(forward.z, t, 0.03);
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
    listenerReady = true;
  }

  // karakter permukaan: [frek. ketuk, Q, frek. gesek, peluruhan, gain, dentum]
  var SURF = {
    marble:   { tap: 2900, q: 2.2, scuff: 5200, decay: 0.045, gain: 0.55, thump: 0.35 },
    wood:     { tap: 900,  q: 1.6, scuff: 2600, decay: 0.07,  gain: 0.6,  thump: 0.7 },
    concrete: { tap: 1900, q: 1.4, scuff: 4200, decay: 0.05,  gain: 0.5,  thump: 0.45 },
    carpet:   { tap: 500,  q: 0.8, scuff: 1400, decay: 0.05,  gain: 0.28, thump: 0.6 },
    paving:   { tap: 1500, q: 1.2, scuff: 3600, decay: 0.06,  gain: 0.5,  thump: 0.5 }
  };

  function step(surface, speed) {
    if (!ctx || muted || !NOISE) return;
    var s = SURF[surface] || SURF.marble, t = ctx.currentTime + 0.005;
    var vol = s.gain * rand(0.75, 1.0) * Math.min(1, 0.6 + (speed || 1) * 0.15);
    lastStepSide = -lastStepSide;
    var out = ctx.createGain(); out.gain.value = vol;
    var sp = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (sp) { sp.pan.value = lastStepSide * 0.12; out.connect(sp); sp.connect(master); } else out.connect(master);

    // ketukan tumit: noise berfilter bandpass, peluruhan cepat
    var n1 = ctx.createBufferSource(); n1.buffer = NOISE; n1.playbackRate.value = rand(0.9, 1.1);
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = s.tap * rand(0.85, 1.15); bp.Q.value = s.q;
    var e1 = ctx.createGain(); e1.gain.setValueAtTime(0, t);
    e1.gain.linearRampToValueAtTime(1, t + 0.002); e1.gain.exponentialRampToValueAtTime(0.001, t + s.decay);
    n1.connect(bp); bp.connect(e1); e1.connect(out);
    n1.start(t, Math.random() * 0.8); n1.stop(t + s.decay + 0.05);

    // dentum rendah tumit
    var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(rand(95, 130), t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.06);
    var e2 = ctx.createGain(); e2.gain.setValueAtTime(0, t);
    e2.gain.linearRampToValueAtTime(s.thump * 0.5, t + 0.004); e2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(e2); e2.connect(out); o.start(t); o.stop(t + 0.1);

    // gesekan ujung sol sedikit setelahnya
    var t2 = t + rand(0.05, 0.08);
    var n2 = ctx.createBufferSource(); n2.buffer = NOISE;
    var hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = s.scuff * rand(0.8, 1.2); hp.Q.value = 0.7;
    var e3 = ctx.createGain(); e3.gain.setValueAtTime(0, t2);
    e3.gain.linearRampToValueAtTime(0.35, t2 + 0.012); e3.gain.exponentialRampToValueAtTime(0.001, t2 + 0.07);
    n2.connect(hp); hp.connect(e3); e3.connect(out);
    n2.start(t2, Math.random() * 0.8); n2.stop(t2 + 0.1);
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(LS_MUTE, muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
  }

  // malam: air mancur sedikit lebih pelan, room tone lebih sepi
  function setNight(k) {
    if (!ctx) return;
    if (fountain) fountain.gain.gain.setTargetAtTime(1.4 - 0.35 * k, ctx.currentTime, 0.4);
    if (room) room.gain.setTargetAtTime(0.035 - 0.015 * k, ctx.currentTime, 0.4);
  }

  // saat tab disembunyikan audio dijeda (hemat baterai)
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  window.MallAudio = {
    start: start, step: step, updateListener: updateListener, setMuted: setMuted, setNight: setNight,
    isMuted: function () { return muted; }, isStarted: function () { return started; },
    context: function () { return ctx; }
  };
})();
