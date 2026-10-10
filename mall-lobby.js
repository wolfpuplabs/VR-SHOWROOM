/* =====================================================================
   WOLFPUP VIRTUAL MALL — ruang jalan bareng (peer-to-peer, tanpa host)
   ---------------------------------------------------------------------
   Link undangan berisi id ruang (?room=…). Siapa pun yang membuka link
   lebih dulu otomatis menjadi "hub" koneksi ruang itu — tidak perlu
   pembuat link online. Pengunjung berikutnya tersambung ke hub lewat
   WebRTC (PeerJS). Saat hub keluar, anggota yang tersisa otomatis
   mengklaim ulang ruang: satu menjadi hub baru, sisanya menyambung ulang.

   Hub:
     - menerima/menolak anggota (maks. MAX_PLAYERS orang per ruang),
     - memvalidasi data dari anggota (nama, peran, posisi, chat, batas laju),
     - menyebarkan snapshot posisi semua orang 10× per detik dan pesan chat.
   Server sinyal publik PeerJS hanya dipakai untuk "berkenalan"; posisi dan
   chat mengalir langsung antar browser.

   Setiap orang lain tampil sebagai karakter 3D berwarna dengan papan nama,
   gelembung chat, dan titik di denah.
   ===================================================================== */
(function () {
  'use strict';

  var MAX_PLAYERS = 10;                 // per ruang undangan
  var SEND_MS = 100;                    // 10 Hz
  var CHAT_GAP_MS = 600;                // batas kirim chat per pemain
  var CHAT_MAX = 200, NAME_MAX = 20;
  var HELLO_TIMEOUT_MS = 8000, JOIN_TIMEOUT_MS = 10000, CLAIM_TIMEOUT_MS = 10000;
  var HUB_SILENT_MS = 4000;             // anggota: hub dianggap hilang (tab tertutup/koneksi putus)
  var GUEST_SILENT_MS = 6000;           // hub: anggota dianggap hilang
  var FIRST_TRIES = 4;                  // percobaan awal sebelum menyerah (setelah itu terus mencoba ulang)
  var MODES = ['visitor', 'tenant', 'owner'];
  var PALETTE = ['#ffb020', '#36d399', '#5aa9ff', '#ff5d7a', '#b38cff',
                 '#ff8a3d', '#2dd4bf', '#f472b6', '#a3e635', '#e2e8f0'];

  var S = {
    role: null,           // null | 'connecting' | 'hub' | 'guest' | 'reconnecting'
    room: null, profile: null, peer: null, me: null,
    conns: {},            // hub: guestId → { conn, id, lastPos, lastChat }
    hubConn: null,        // guest: koneksi ke hub
    players: {},          // id → { id, name, color, mode, x, z, yaw, m, avatar }
    nextId: 1, timers: [], leaving: false, opts: null,
    gen: 0, attempt: 0, retryTimer: null, pending: null, joined: false
  };

  /* ------------------------------ utilitas ------------------------------ */
  function clean(s, max) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  function num(v, lo, hi) { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function randId(n) {
    var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = '', buf = new Uint32Array(n);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < n; i++) s += a[buf[i] % a.length];
    return s;
  }
  function emit(type, data) { if (S.opts && S.opts.on) try { S.opts.on(type, data); } catch (e) { console.error(e); } }
  function peerOptions() {
    // tes lokal bisa mengarahkan ke server PeerJS sendiri lewat window.MALL_LOBBY_PEER_OPTS
    var o = Object.assign({ debug: 1 }, window.MALL_LOBBY_PEER_OPTS || {});
    return o;
  }
  function publicList() {
    return Object.keys(S.players).map(function (id) {
      var p = S.players[id];
      return { id: p.id, name: p.name, color: p.color, mode: p.mode };
    });
  }
  function every(ms, fn) { var h = setInterval(fn, ms); S.timers.push(h); return h; }

  /* ------------------------------ avatar 3D ------------------------------ */
  var T = null, root = null, clock = 0;
  function three() { return T || (T = window.AFRAME && AFRAME.THREE); }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  var UI_FONT = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

  function labelSprite(name, color) {
    var T3 = three(), cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    var c = cv.getContext('2d');
    c.font = '700 52px ' + UI_FONT;
    var text = name, tw = Math.min(400, c.measureText(text).width), w = tw + 120, x0 = (512 - w) / 2;
    roundRect(c, x0, 18, w, 92, 46); c.fillStyle = 'rgba(12,14,20,.82)'; c.fill();
    c.lineWidth = 4; c.strokeStyle = color; c.stroke();
    c.beginPath(); c.arc(x0 + 50, 64, 18, 0, Math.PI * 2); c.fillStyle = color; c.fill();
    c.fillStyle = '#ffffff'; c.textBaseline = 'middle'; c.textAlign = 'left';
    c.fillText(text, x0 + 82, 66, 400);
    var tex = new T3.CanvasTexture(cv); tex.colorSpace = T3.SRGBColorSpace;
    var sp = new T3.Sprite(new T3.SpriteMaterial({ map: tex, depthWrite: false, toneMapped: false, transparent: true }));
    sp.scale.set(1.15, 0.29, 1); sp.renderOrder = 20;
    return sp;
  }

  function bubbleSprite(text) {
    var T3 = three(), cv = document.createElement('canvas'); cv.width = 640; cv.height = 256;
    var c = cv.getContext('2d');
    c.font = '600 40px ' + UI_FONT;
    // bungkus teks maks. 3 baris
    var words = text.split(' '), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (c.measureText(test).width > 540 && line) { lines.push(line); line = words[i]; } else line = test;
      if (lines.length === 3) break;
    }
    if (lines.length < 3 && line) lines.push(line);
    if (lines.length === 3 && words.length && (lines.join(' ').length < text.length)) lines[2] = lines[2].replace(/.{0,3}$/, '…');
    var lw = 0; lines.forEach(function (l) { lw = Math.max(lw, c.measureText(l).width); });
    var w = Math.min(600, lw + 60), h = lines.length * 50 + 40, x0 = (640 - w) / 2, y0 = 220 - h;
    roundRect(c, x0, y0, w, h, 26); c.fillStyle = 'rgba(255,255,255,.94)'; c.fill();
    c.beginPath(); c.moveTo(300, 220); c.lineTo(320, 246); c.lineTo(340, 220); c.closePath(); c.fill();
    c.fillStyle = '#12151c'; c.textAlign = 'center'; c.textBaseline = 'middle';
    lines.forEach(function (l, k) { c.fillText(l, 320, y0 + 45 + k * 50, 560); });
    var tex = new T3.CanvasTexture(cv); tex.colorSpace = T3.SRGBColorSpace;
    var sp = new T3.Sprite(new T3.SpriteMaterial({ map: tex, depthWrite: false, toneMapped: false, transparent: true }));
    sp.scale.set(1.5, 0.6, 1); sp.renderOrder = 21;
    return sp;
  }

  var shadowTex = null;
  function blobTex() {
    if (shadowTex) return shadowTex;
    var cv = document.createElement('canvas'); cv.width = cv.height = 64;
    var c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    shadowTex = new (three().CanvasTexture)(cv);
    return shadowTex;
  }

  function makeAvatar(p) {
    var T3 = three(); if (!T3 || !root) return null;
    var col = new T3.Color(p.color), light = col.clone().lerp(new T3.Color(0xffffff), 0.25);
    var g = new T3.Group(); g.name = 'avatar-' + p.id;
    var body = new T3.Mesh(new T3.CapsuleGeometry(0.25, 0.6, 6, 16), new T3.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.05 }));
    body.position.y = 0.66;
    var head = new T3.Mesh(new T3.SphereGeometry(0.21, 20, 14), new T3.MeshStandardMaterial({ color: light, roughness: 0.4 }));
    head.position.y = 1.36;
    // visor gelap mengilap di depan kepala (arah -z = arah pandang)
    // visor: potongan bola (hanya bagian depan) sedikit di luar kepala → tepi bersih tanpa z-fighting
    var visor = new T3.Mesh(new T3.SphereGeometry(0.218, 28, 12, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.2),
      new T3.MeshStandardMaterial({ color: 0x10141c, roughness: 0.08, metalness: 0.35, side: T3.DoubleSide }));
    visor.rotation.y = Math.PI; visor.position.y = 1.36;
    var pack = new T3.Mesh(new T3.BoxGeometry(0.3, 0.34, 0.12), new T3.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.7), roughness: 0.6 }));
    pack.position.set(0, 0.86, 0.26);
    var avatar = new T3.Group(); avatar.add(body, head, visor, pack);
    var shadow = new T3.Mesh(new T3.CircleGeometry(0.42, 24), new T3.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02;
    var label = labelSprite(p.name, p.color); label.position.y = 1.95;
    g.add(avatar, shadow, label);
    g.position.set(p.x, 0, p.z); g.scale.setScalar(0.01);
    root.add(g);
    return { group: g, body: avatar, label: label, bubble: null, bubbleUntil: 0, born: clock };
  }

  function disposeAvatar(a) {
    if (!a) return;
    a.group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map && o.material.map !== shadowTex) o.material.map.dispose(); o.material.dispose(); }
    });
    if (a.group.parent) a.group.parent.remove(a.group);
  }

  function showBubble(p, text) {
    if (!p || !p.avatar) return;
    var a = p.avatar;
    if (a.bubble) { disposeAvatar({ group: a.bubble }); a.bubble = null; }
    a.bubble = bubbleSprite(text); a.bubble.position.y = 2.45;
    a.group.add(a.bubble); a.bubbleUntil = clock + 7;
  }

  function animate(dt) {
    clock += dt;
    var k = 1 - Math.exp(-dt * 10);
    Object.keys(S.players).forEach(function (id) {
      var p = S.players[id];
      if (!p.avatar || (S.me && id === S.me.id)) return;
      var g = p.avatar.group;
      var dx = p.x - g.position.x, dz = p.z - g.position.z;
      if (dx * dx + dz * dz > 64) { g.position.x = p.x; g.position.z = p.z; }     // teleport/glide jauh
      else { g.position.x += dx * k; g.position.z += dz * k; }
      var dy = Math.atan2(Math.sin(p.yaw - g.rotation.y), Math.cos(p.yaw - g.rotation.y));
      g.rotation.y += dy * k;
      var moving = p.m || (dx * dx + dz * dz) > 0.0004;
      var b = p.avatar.body;
      b.position.y = moving ? Math.abs(Math.sin(clock * 9 + p.phase)) * 0.06 : b.position.y * 0.85;
      b.rotation.z = moving ? Math.sin(clock * 9 + p.phase) * 0.06 : b.rotation.z * 0.85;
      var age = clock - p.avatar.born, s = Math.min(1, age * 3);
      g.scale.setScalar(s < 1 ? 1 - Math.pow(1 - s, 3) : 1);
      if (p.avatar.bubble) {
        var left = p.avatar.bubbleUntil - clock;
        p.avatar.bubble.material.opacity = Math.max(0, Math.min(1, left));
        if (left <= 0) { disposeAvatar({ group: p.avatar.bubble }); p.avatar.bubble = null; }
      }
    });
  }

  /* ------------------------------ pemain ------------------------------ */
  function addPlayer(info, isSelf) {
    var p = S.players[info.id] || {};
    p.id = info.id; p.name = info.name; p.color = info.color; p.mode = MODES.indexOf(info.mode) >= 0 ? info.mode : 'visitor';
    if (p.x === undefined) { p.x = num(info.x, -40, 40) || 0; p.z = num(info.z, -60, 80) || 30.6; p.yaw = num(info.yaw, -10, 10); p.m = 0; }
    p.phase = p.phase || Math.random() * 6;
    S.players[p.id] = p;
    if (!isSelf && !p.avatar) p.avatar = makeAvatar(p);
    return p;
  }
  function removePlayer(id) {
    var p = S.players[id]; if (!p) return;
    disposeAvatar(p.avatar);
    delete S.players[id];
  }
  function clearPlayers() { Object.keys(S.players).forEach(removePlayer); }
  function selfState() {
    var s = S.opts && S.opts.getSelf ? S.opts.getSelf() : null;
    return s || { x: 0, z: 30.6, yaw: 0, moving: false };
  }

  /* ------------------------------ ruang ------------------------------ */
  function hubPeerId(room) { return 'wpmall-r-' + room; }
  function cleanRoom(r) { return clean(r, 40).replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 32); }
  function newRoomId() { return randId(10); }
  function cleanInfo(info) {
    return { id: clean(info.id, 8), name: clean(info.name, NAME_MAX) || 'Guest',
      color: PALETTE.indexOf(info.color) >= 0 ? info.color : PALETTE[0],
      mode: MODES.indexOf(info.mode) >= 0 ? info.mode : 'visitor', x: info.x, z: info.z, yaw: info.yaw };
  }
  function publicOf(p) { return { id: p.id, name: p.name, color: p.color, mode: p.mode }; }
  function withPos(info) { var p = S.players[info.id]; info.x = r2(p.x); info.z = r2(p.z); info.yaw = r2(p.yaw); return info; }

  function setRole(r) { S.role = r; emit('state', status()); }

  // masuk ke ruang: klaim id hub; kalau sudah dipakai, sambung ke hub yang ada
  function enter(room, profile) {
    leave(true);
    S.room = cleanRoom(room);
    S.profile = {
      name: clean(profile.name, NAME_MAX) || 'Guest',
      color: (profile.color | 0) % PALETTE.length,
      mode: MODES.indexOf(profile.mode) >= 0 ? profile.mode : 'visitor'
    };
    S.leaving = false; S.attempt = 0; S.joined = false;
    return new Promise(function (resolve, reject) {
      S.pending = { resolve: resolve, reject: reject };
      connectRoom();
    });
  }

  function dropPeer() {
    S.timers.forEach(clearInterval); S.timers = [];
    if (S.peer && !S.peer.destroyed) try { S.peer.destroy(); } catch (e) {}
    S.peer = null; S.hubConn = null; S.conns = {};
  }

  function connectRoom() {
    if (S.leaving || !S.room) return;
    var gen = ++S.gen;
    dropPeer();
    setRole(S.joined ? 'reconnecting' : 'connecting');
    var settled = false;
    var peer = new Peer(hubPeerId(S.room), peerOptions());
    S.peer = peer;
    var timer = setTimeout(function () { if (!settled) { settled = true; retry('timeout'); } }, CLAIM_TIMEOUT_MS);
    peer.on('open', function () {
      if (gen !== S.gen || settled) return;
      settled = true; clearTimeout(timer);
      becomeHub(peer, gen);
    });
    peer.on('connection', function (conn) { if (gen === S.gen) onHubConnection(conn); });
    peer.on('disconnected', function () { if (gen === S.gen && !S.leaving && !peer.destroyed) peer.reconnect(); });
    peer.on('error', function (err) {
      if (gen !== S.gen) return;
      if (!settled) {
        settled = true; clearTimeout(timer);
        if (err.type === 'unavailable-id') joinHub(gen);      // ruang sudah punya hub
        else retry(err.type || 'network');
        return;
      }
      emit('warn', err.type || String(err));
    });
  }

  function becomeHub(peer, gen) {
    var self = selfState();
    clearPlayers();
    S.nextId = 1;
    S.me = addPlayer({ id: 'h', name: S.profile.name, color: PALETTE[S.profile.color], mode: S.profile.mode, x: self.x, z: self.z, yaw: self.yaw }, true);
    S.attempt = 0;
    startHubLoops();
    setRole('hub');
    emit('players', publicList());
    settle();
  }

  function joinHub(gen) {
    dropPeer();
    var peer = new Peer(peerOptions());
    S.peer = peer;
    var welcomed = false, lost = false;
    var timer = setTimeout(function () { if (gen === S.gen && !welcomed) retry('timeout'); }, JOIN_TIMEOUT_MS);
    // hub pergi (sengaja, tab ditutup, atau koneksi putus): tunggu sebentar — anggota lama lebih
    // dulu — lalu klaim ruang atau sambung ke hub baru
    function hubLost() {
      if (lost || gen !== S.gen || S.leaving) return;
      lost = true;
      emit('system', { key: 'lobby.handover' });
      var n = parseInt(String(S.me && S.me.id || 'g9').slice(1), 10) || 9;
      dropPeer(); clearPlayers(); S.me = null;
      setRole('reconnecting');
      scheduleConnect(150 + Math.min(n, 12) * 300 + Math.random() * 200);
    }
    S.hubLost = hubLost;
    peer.on('disconnected', function () { if (gen === S.gen && !S.leaving && !peer.destroyed) peer.reconnect(); });
    peer.on('error', function (err) {
      if (gen !== S.gen) return;
      if (!welcomed) {
        clearTimeout(timer);
        // hub baru saja pergi → coba klaim ruang sendiri
        retry(err.type === 'peer-unavailable' ? 'hub-gone' : (err.type || 'network'));
        return;
      }
      emit('warn', err.type || String(err));
    });
    peer.on('open', function () {
      if (gen !== S.gen) return;
      var conn = peer.connect(hubPeerId(S.room), { reliable: true, serialization: 'json', metadata: { app: 'wolfpup-mall', v: 2 } });
      S.hubConn = conn;
      conn.on('open', function () {
        conn.send({ t: 'hello', name: S.profile.name, color: S.profile.color, mode: S.profile.mode, v: 2 });
      });
      conn.on('data', function (msg) {
        if (gen !== S.gen || !msg || typeof msg !== 'object') return;
        S.lastHubMsg = performance.now();
        if (msg.t === 'full') { clearTimeout(timer); fail('full'); return; }
        if (msg.t === 'welcome') {
          clearTimeout(timer);
          welcomed = true;
          clearPlayers();
          (msg.players || []).forEach(function (info) {
            var ci = cleanInfo(info);
            addPlayer(ci, ci.id === msg.you);
          });
          S.me = S.players[clean(msg.you, 8)];
          S.attempt = 0; S.lastHubMsg = performance.now();
          startGuestLoops();
          setRole('guest');
          emit('players', publicList());
          settle();
          return;
        }
        if (welcomed) onGuestData(msg);
      });
      conn.on('close', function () {
        if (gen !== S.gen || S.leaving) return;
        if (!welcomed) { clearTimeout(timer); retry('closed'); return; }
        hubLost();
      });
    });
  }

  function scheduleConnect(ms) {
    clearTimeout(S.retryTimer);
    S.retryTimer = setTimeout(connectRoom, ms);
  }

  function retry(reason) {
    if (S.leaving || !S.room) return;
    dropPeer();
    S.attempt++;
    if (!S.joined && S.attempt >= FIRST_TRIES) { fail(reason === 'hub-gone' || reason === 'closed' ? 'network' : reason); return; }
    setRole(S.joined ? 'reconnecting' : 'connecting');
    var delay = reason === 'hub-gone' ? 150 + Math.random() * 600 : Math.min(15000, 700 * Math.pow(2, S.attempt - 1)) + Math.random() * 400;
    scheduleConnect(delay);
  }

  function settle() {
    S.joined = true;
    if (S.pending) { var p = S.pending; S.pending = null; p.resolve(status()); }
  }
  function fail(code) {
    var p = S.pending; S.pending = null;
    var wasIn = S.joined;
    cleanup();
    if (p) p.reject({ type: code });
    else if (wasIn) emit('dropped', { type: code });
  }

  /* ------------------------------ HUB ------------------------------ */
  function onHubConnection(conn) {
    var rec = { conn: conn, id: null, lastPos: 0, lastChat: 0, lastSeen: performance.now() };
    var helloTimer = setTimeout(function () { if (!rec.id) conn.close(); }, HELLO_TIMEOUT_MS);
    conn.on('data', function (msg) {
      if (!msg || typeof msg !== 'object' || S.role !== 'hub') return;
      rec.lastSeen = performance.now();
      if (!rec.id) {
        if (msg.t !== 'hello') return;
        clearTimeout(helloTimer);
        if (Object.keys(S.players).length >= MAX_PLAYERS) {
          conn.send({ t: 'full', max: MAX_PLAYERS });
          setTimeout(function () { conn.close(); }, 400);
          return;
        }
        var used = Object.keys(S.players).map(function (k) { return S.players[k].color; });
        var want = PALETTE[num(msg.color, 0, PALETTE.length - 1) | 0];
        var color = used.indexOf(want) < 0 ? want : PALETTE.filter(function (c) { return used.indexOf(c) < 0; })[0] || want;
        rec.id = 'g' + (S.nextId++);
        var p = addPlayer({ id: rec.id, name: clean(msg.name, NAME_MAX) || 'Guest', color: color,
          mode: MODES.indexOf(msg.mode) >= 0 ? msg.mode : 'visitor', x: 0, z: 30.6, yaw: 0 }, false);
        S.conns[rec.id] = rec;
        conn.send({ t: 'welcome', you: rec.id, max: MAX_PLAYERS, players: publicList().map(withPos) });
        broadcast({ t: 'join', p: withPos(publicOf(p)) }, rec.id);
        emit('players', publicList());
        emit('system', { key: 'lobby.joined', name: p.name, color: p.color });
        return;
      }
      var p2 = S.players[rec.id]; if (!p2) return;
      var now = performance.now();
      if (msg.t === 'pos') {
        if (now - rec.lastPos < 40) return;                     // maks ±25 pembaruan/detik
        rec.lastPos = now;
        p2.x = num(msg.x, -40, 40); p2.z = num(msg.z, -60, 80); p2.yaw = num(msg.yaw, -10, 10); p2.m = msg.m ? 1 : 0;
      } else if (msg.t === 'chat') {
        if (now - rec.lastChat < CHAT_GAP_MS) return;
        var text = clean(msg.text, CHAT_MAX); if (!text) return;
        rec.lastChat = now;
        deliverChat(p2, text);
      } else if (msg.t === 'leave') {
        conn.close();
      }
    });
    conn.on('close', function () { clearTimeout(helloTimer); if (rec.id) dropGuest(rec.id); });
    conn.on('error', function () { if (rec.id) dropGuest(rec.id); });
  }

  function dropGuest(id) {
    var rec = S.conns[id], p = S.players[id];
    if (!rec) return;
    delete S.conns[id];
    if (p) emit('system', { key: 'lobby.left', name: p.name, color: p.color });
    removePlayer(id);
    broadcast({ t: 'leave', id: id });
    emit('players', publicList());
  }

  function broadcast(msg, exceptId) {
    Object.keys(S.conns).forEach(function (id) {
      if (id === exceptId) return;
      var c = S.conns[id].conn;
      if (c.open) try { c.send(msg); } catch (e) {}
    });
  }

  function deliverChat(p, text) {
    var msg = { t: 'chat', id: p.id, name: p.name, color: p.color, text: text, ts: Date.now() };
    broadcast(msg);
    onChat(msg);
  }

  function startHubLoops() {
    every(SEND_MS, function () {
      var me = S.me; if (!me) return;
      var now = performance.now();
      Object.keys(S.conns).forEach(function (id) {
        var rec = S.conns[id];
        if (now - rec.lastSeen > GUEST_SILENT_MS) { try { rec.conn.close(); } catch (e) {} dropGuest(id); }
      });
      var s = selfState();
      me.x = s.x; me.z = s.z; me.yaw = s.yaw; me.m = s.moving ? 1 : 0;
      if (!Object.keys(S.conns).length) return;
      var snap = Object.keys(S.players).map(function (id) {
        var p = S.players[id]; return [id, r2(p.x), r2(p.z), r2(p.yaw), p.m ? 1 : 0];
      });
      broadcast({ t: 'snap', p: snap });
    });
  }

  /* ------------------------------ ANGGOTA ------------------------------ */
  function onGuestData(msg) {
    if (msg.t === 'snap' && Array.isArray(msg.p)) {
      msg.p.forEach(function (row) {
        var id = row[0], p = S.players[id];
        if (!p || (S.me && id === S.me.id)) return;
        p.x = num(row[1], -40, 40); p.z = num(row[2], -60, 80); p.yaw = num(row[3], -10, 10); p.m = row[4] ? 1 : 0;
      });
    } else if (msg.t === 'join' && msg.p) {
      var p = addPlayer(cleanInfo(msg.p), false);
      emit('players', publicList());
      emit('system', { key: 'lobby.joined', name: p.name, color: p.color });
    } else if (msg.t === 'leave') {
      var gone = S.players[msg.id];
      if (gone) emit('system', { key: 'lobby.left', name: gone.name, color: gone.color });
      removePlayer(msg.id);
      emit('players', publicList());
    } else if (msg.t === 'chat') {
      onChat({ id: clean(msg.id, 8), name: clean(msg.name, NAME_MAX), color: PALETTE.indexOf(msg.color) >= 0 ? msg.color : '#ffffff',
        text: clean(msg.text, CHAT_MAX), ts: +msg.ts || Date.now() });
    }
  }

  function startGuestLoops() {
    var last = { x: 1e9, z: 1e9, yaw: 1e9, at: 0 };
    every(SEND_MS, function () {
      var c = S.hubConn; if (!c || !S.me) return;
      var now = performance.now();
      if (now - (S.lastHubMsg || now) > HUB_SILENT_MS) { if (S.hubLost) S.hubLost(); return; }
      if (!c.open) return;
      var s = selfState();
      var changed = Math.abs(s.x - last.x) > 0.01 || Math.abs(s.z - last.z) > 0.01 || Math.abs(s.yaw - last.yaw) > 0.01;
      if (!changed && now - last.at < 1000) return;              // heartbeat 1 detik saat diam
      last = { x: s.x, z: s.z, yaw: s.yaw, at: now };
      S.me.x = s.x; S.me.z = s.z; S.me.yaw = s.yaw;
      try { c.send({ t: 'pos', x: r2(s.x), z: r2(s.z), yaw: r2(s.yaw), m: s.moving ? 1 : 0 }); } catch (e) {}
    });
  }

  /* ------------------------------ chat ------------------------------ */
  var lastOwnChat = 0;
  function sendChat(text) {
    text = clean(text, CHAT_MAX);
    if (!text || !S.me) return false;
    var now = performance.now();
    if (now - lastOwnChat < CHAT_GAP_MS) return false;
    lastOwnChat = now;
    if (S.role === 'hub') deliverChat(S.me, text);
    else if (S.role === 'guest' && S.hubConn && S.hubConn.open) S.hubConn.send({ t: 'chat', text: text });
    else return false;
    return true;
  }
  function onChat(msg) {
    var p = S.players[msg.id];
    if (p && (!S.me || p.id !== S.me.id)) showBubble(p, msg.text);
    msg.isMe = !!(S.me && msg.id === S.me.id);
    emit('chat', msg);
  }

  /* ------------------------------ sesi ------------------------------ */
  function status() {
    var inRoom = S.role === 'hub' || S.role === 'guest';
    return { role: S.role, room: S.room, connected: inRoom, count: inRoom ? Object.keys(S.players).length : 0,
      max: MAX_PLAYERS, me: S.me ? publicOf(S.me) : null };
  }
  function cleanup() {
    clearTimeout(S.retryTimer);
    S.gen++;
    dropPeer();
    clearPlayers();
    S.me = null; S.role = null; S.room = null; S.nextId = 1; S.joined = false; S.attempt = 0;
    emit('state', status());
  }
  function leave(silent) {
    if (!S.role) return;
    S.leaving = true;
    if (S.role === 'guest' && S.hubConn && S.hubConn.open) try { S.hubConn.send({ t: 'leave' }); } catch (e) {}
    var p = S.pending; S.pending = null;
    cleanup();
    if (p) p.reject({ type: 'cancelled' });
    if (!silent) emit('left', {});
  }
  window.addEventListener('pagehide', function () { leave(true); });

  // ?room=<id> (link baru) atau ?lobby=<id> (link lama)
  function roomFromUrl() {
    var q = new URLSearchParams(location.search);
    return cleanRoom(q.get('room') || q.get('lobby') || '');
  }

  function setup(opts) {
    S.opts = opts;
    var T3 = three();
    root = new T3.Group(); root.name = 'lobby-avatars';
    opts.sceneEl.object3D.add(root);
    var last = performance.now();
    opts.sceneEl.addBehavior({
      el: opts.sceneEl,
      tick: function () { var now = performance.now(); animate(Math.min(0.1, (now - last) / 1000)); last = now; }
    });
  }

  window.MallLobby = {
    setup: setup, enter: enter, leave: leave, sendChat: sendChat,
    status: status, roomFromUrl: roomFromUrl, newRoomId: newRoomId, cleanRoom: cleanRoom,
    players: function () {
      return Object.keys(S.players).map(function (id) {
        var p = S.players[id];
        return { id: p.id, name: p.name, color: p.color, mode: p.mode, isMe: !!(S.me && S.me.id === id), x: p.x, z: p.z, yaw: p.yaw };
      });
    },
    palette: PALETTE, max: MAX_PLAYERS, available: function () { return typeof window.Peer === 'function'; }
  };
})();
