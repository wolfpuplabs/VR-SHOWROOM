/* =====================================================================
   WOLFPUP VIRTUAL MALL — panorama 360° yang dibuat otomatis
   ---------------------------------------------------------------------
   Lingkungan luar mall (langit, awan, matahari/bulan, siluet kota, deretan
   pohon) dirender oleh satu shader ke tekstur equirectangular HDR. Tidak
   ada foto yang diunduh: panorama dibuat di GPU saat memuat, sesuai arah
   matahari & bulan milik pencahayaan mall.

   Tekstur yang sama dipakai untuk:
     - latar langit yang terlihat dari skylight dan pintu masuk,
     - HDRI pencahayaan (PMREM) dan sumber cahaya untuk light probe interior.

   MallSky.create(renderer, opts) → { texture, render(k), setSeed(n), size }
     k: 0 = siang, 1 = malam (nilai di antaranya dipakai saat transisi)
   ===================================================================== */
(function () {
  'use strict';
  var T = AFRAME.THREE;

  var VERT = [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform vec3 uSun; uniform vec3 uMoon; uniform float uNight; uniform float uSeed;',
    'uniform float uSkyGain; uniform float uCloudCover; uniform vec2 uRes;',
    '#define PI 3.141592653589793',
    '',
    /* ---------- noise ---------- */
    'float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }',
    'float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    'float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }',
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }',
    'float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 r = mat2(0.8, -0.6, 0.6, 0.8);',
    '  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = r * p * 2.03 + 17.1; a *= 0.5; } return s; }',
    '',
    /* ---------- langit fisik (Preetham, diadaptasi dari three.js Sky) ---------- */
    'const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);',
    'const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);',
    'float sunIntensity(float zc){ return 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(clamp(zc, -1.0, 1.0))) / 1.5))); }',
    'vec3 preetham(vec3 dir, vec3 sunDir, float turbidity){',
    '  vec3 up = vec3(0.0, 1.0, 0.0);',
    '  float sunE = sunIntensity(dot(sunDir, up));',
    '  float sunfade = 1.0 - clamp(1.0 - exp(sunDir.y * 450000.0 / 450000.0), 0.0, 1.0);',
    '  vec3 betaR = totalRayleigh * (2.2 - (1.0 - sunfade));',
    '  vec3 betaM = 0.434 * (0.2 * turbidity) * 10E-18 * MieConst * 0.004;',
    '  float zen = acos(max(0.0, dot(up, dir)));',
    '  float inv = 1.0 / (cos(zen) + 0.15 * pow(93.885 - zen * 180.0 / PI, -1.253));',
    '  vec3 Fex = exp(-(betaR * 8.4E3 * inv + betaM * 1.25E3 * inv));',
    '  float ct = dot(dir, sunDir);',
    '  float rPhase = 0.05968310365946075 * (1.0 + pow(ct * 0.5 + 0.5, 2.0));',
    '  float g = 0.8, g2 = g * g;',
    '  float mPhase = 0.07957747154594767 * (1.0 - g2) / pow(1.0 - 2.0 * g * ct + g2, 1.5);',
    '  vec3 bt = betaR * rPhase + betaM * mPhase;',
    '  vec3 Lin = pow(sunE * (bt / (betaR + betaM)) * (1.0 - Fex), vec3(1.5));',
    '  Lin *= mix(vec3(1.0), pow(sunE * (bt / (betaR + betaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));',
    '  vec3 L0 = vec3(0.1) * Fex;',
    '  float disk = smoothstep(0.99995, 0.99998, ct);',
    '  L0 += sunE * 19000.0 * Fex * disk * 0.0006;',               // dibatasi: cukup terang untuk bloom, tanpa firefly di PMREM
    '  return (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);',
    '}',
    '',
    /* ---------- siluet kota: dua lapis gedung + deret pohon ---------- */
    // a: azimut (radian), e: elevasi (radian). Mengembalikan rgb, alpha = tertutup gedung
    'vec4 building(float a, float e, float cells, float hMin, float hMax, float layer, float night, vec3 haze, float hazeK, vec3 sunDir){',
    '  float x = a / (2.0 * PI) * cells;',
    '  float id = floor(x), fx = fract(x);',
    '  float r1 = hash11(id * 1.37 + layer * 91.7 + uSeed), r2 = hash11(id * 3.11 + layer * 13.3 + uSeed);',
    '  float r3 = hash11(id * 7.77 + layer * 5.1 + uSeed);',
    // pusat kota di satu arah → gedung lebih tinggi
    '  float downtown = pow(max(0.0, cos(a - 1.1 - uSeed * 0.37)), 6.0);',
    '  float h = mix(hMin, hMax, pow(r1, 1.6)) * (0.55 + 0.9 * downtown);',
    '  float m0 = 0.04 + r2 * 0.18, m1 = 0.96 - r3 * 0.18;',     // celah antar gedung
    '  if (fx < m0 || fx > m1) return vec4(0.0);',
    '  float u = (fx - m0) / (m1 - m0);',
    '  float hh = h;',
    '  if (r2 > 0.55 && abs(u - 0.5) > 0.28) hh *= 0.82;',        // setback di atap
    '  float ant = (r3 > 0.8 && abs(u - 0.5) < 0.012) ? h * 0.18 : 0.0;',
    '  float base = -0.012;',
    '  if (e > hh + ant || e < base) return vec4(0.0);',
    '  vec3 wall = mix(vec3(0.20, 0.22, 0.25), vec3(0.42, 0.40, 0.37), r2) * (0.75 + 0.35 * r3);',
    // sisi yang menghadap matahari lebih terang (normal kira-kira menghadap kamera)
    '  vec3 n = normalize(vec3(-cos(a) + (u - 0.5) * 0.6, 0.0, -sin(a)));',
    '  float sunL = max(dot(n, sunDir), 0.0) * smoothstep(-0.05, 0.1, sunDir.y);',
    '  vec3 dayCol = wall * (0.45 + 2.4 * sunL) * 0.75;',
    // grid jendela
    '  float wx = u * (10.0 + floor(r1 * 14.0)), wy = (e - base) / (0.0042 + r3 * 0.002);',
    '  vec2 wi = floor(vec2(wx, wy)), wf = fract(vec2(wx, wy));',
    '  float isWin = step(0.18, wf.x) * step(wf.x, 0.82) * step(0.22, wf.y) * step(wf.y, 0.78) * step(e, hh - 0.003);',
    '  float wh = hash12(wi + id * 17.0 + layer * 3.0);',
    '  vec3 glass = mix(vec3(0.10, 0.14, 0.20), vec3(0.38, 0.45, 0.55), wh) * (0.6 + 0.9 * sunL);',
    '  dayCol = mix(dayCol, glass, isWin * 0.85);',
    '  vec3 nightCol = wall * 0.012;',
    '  float lit = step(0.62, wh) * isWin;',
    '  vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.85, 1.0), step(0.86, wh));',
    '  nightCol += lit * warm * (1.2 + 2.6 * hash12(wi * 1.7 + id));',
    // lampu merah penerbangan di puncak gedung tinggi
    '  float beacon = (h > hMax * 0.7 && abs(u - 0.5) < 0.03 && e > hh + ant - 0.0016) ? 1.0 : 0.0;',
    '  nightCol += beacon * vec3(6.0, 0.25, 0.1);',
    '  vec3 col = mix(dayCol, nightCol, night);',
    '  col = mix(col, haze, hazeK);',
    '  return vec4(col, 1.0);',
    '}',
    '',
    'void main(){',
    '  float phi = (vUv.x - 0.5) * 2.0 * PI;',
    '  float el = (vUv.y - 0.5) * PI;',
    '  vec3 d = vec3(cos(el) * cos(phi), sin(el), cos(el) * sin(phi));',
    '  vec3 sunDir = normalize(uSun), moonDir = normalize(uMoon);',
    '  float night = uNight;',
    '',
    /* langit siang */
    '  vec3 dsky = vec3(d.x, max(d.y, 0.0) + 0.002, d.z);',
    '  vec3 day = preetham(normalize(dsky), sunDir, 2.6) * uSkyGain;',
    /* langit malam: gradasi, bulan, bintang, pendar kota di cakrawala */
    '  float hy = max(d.y, 0.0);',
    '  vec3 nsky = mix(vec3(0.030, 0.040, 0.075), vec3(0.004, 0.007, 0.018), pow(hy, 0.45));',
    '  nsky += vec3(0.20, 0.10, 0.05) * exp(-hy * 14.0) * 0.55;',          // light pollution
    '  float mc = dot(d, moonDir);',
    '  nsky += vec3(0.85, 0.9, 1.0) * smoothstep(0.99955, 0.99972, mc) * 9.0;',
    '  nsky += vec3(0.25, 0.32, 0.5) * pow(max(mc, 0.0), 80.0) * 0.6;',
    '  vec3 sg = floor(d * 420.0);',
    '  float st = step(0.9965, hash13(sg + uSeed)) * smoothstep(0.03, 0.35, hy);',
    '  nsky += st * vec3(0.9, 0.94, 1.0) * (0.6 + 2.4 * hash13(sg + 9.1)) * (1.0 - smoothstep(0.0, 0.25, hy) * 0.0);',
    '  vec3 col = mix(day, nsky, night);',
    '',
    /* awan: proyeksi ke bidang di ketinggian, cahaya dari matahari/bulan */
    '  if (d.y > 0.0) {',
    '    vec2 cp = d.xz / (d.y + 0.06) * 1.6 + uSeed * 3.1;',
    '    float n = fbm(cp * 0.9);',
    '    float cover = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.32, n);',
    '    cover *= smoothstep(0.0, 0.12, d.y);',
    '    vec2 toSun = normalize(sunDir.xz + 1e-4) * 0.18;',
    '    float shade = clamp((n - fbm(cp * 0.9 + toSun)) * 4.0 + 0.55, 0.0, 1.0);',
    '    float silver = pow(max(dot(d, sunDir), 0.0), 8.0);',
    '    vec3 horiz = preetham(normalize(vec3(d.x, 0.02, d.z)), sunDir, 2.6) * uSkyGain;',
    '    vec3 cDay = mix(horiz * 0.85, vec3(1.0, 0.97, 0.92) * uSkyGain * 0.95, shade) + silver * vec3(1.0, 0.9, 0.7) * 2.0;',
    '    vec3 cNight = mix(vec3(0.05, 0.035, 0.03), vec3(0.11, 0.08, 0.06), shade) + pow(max(mc, 0.0), 12.0) * vec3(0.06, 0.07, 0.1);',
    '    col = mix(col, mix(cDay, cNight, night), cover * 0.92);',
    '  }',
    '',
    /* tanah jauh di bawah cakrawala */
    '  vec3 hazeDay = preetham(normalize(vec3(d.x, 0.015, d.z)), sunDir, 2.6) * uSkyGain;',
    '  vec3 hazeNight = vec3(0.045, 0.035, 0.035);',
    '  vec3 haze = mix(hazeDay, hazeNight, night);',
    '  if (d.y < 0.0) {',
    '    vec3 gDay = vec3(0.16, 0.17, 0.15) * (0.4 + 1.2 * max(sunDir.y, 0.0)) * (0.8 + 0.4 * fbm(vec2(phi * 40.0, el * 80.0)));',
    // lampu kota jauh: hanya tipis di dekat cakrawala
    '    float sl = step(0.9985, hash12(floor(vec2(phi * 700.0, el * 1400.0)))) * smoothstep(-0.06, -0.01, d.y);',
    '    vec3 gNight = vec3(0.01, 0.01, 0.012) + sl * vec3(1.6, 1.0, 0.55);',
    '    col = mix(mix(gDay, gNight, night), haze, exp(d.y * 40.0));',
    '  }',
    '',
    /* siluet kota & pohon (paling jauh → paling dekat) */
    '  vec4 far = building(phi, el, 200.0, 0.018, 0.075, 1.0, night, haze, 0.42, sunDir);',
    '  col = mix(col, far.rgb, far.a);',
    '  vec4 near = building(phi + 0.37, el, 90.0, 0.026, 0.2, 2.0, night, haze, 0.1, sunDir);',
    '  col = mix(col, near.rgb, near.a);',
    '  float tree = 0.006 + fbm(vec2(phi * 26.0, uSeed)) * 0.02 + vnoise(vec2(phi * 220.0, 3.0)) * 0.004;',
    '  if (el < tree && el > -0.02) {',
    '    vec3 tc = mix(vec3(0.08, 0.13, 0.07) * (0.5 + 1.4 * max(sunDir.y, 0.0)), vec3(0.006, 0.008, 0.007), night);',
    '    col = mix(col, mix(tc, haze, 0.18), 1.0);',
    '  }',
    '',
    '  gl_FragColor = vec4(max(col, 0.0), 1.0);',
    '}'
  ].join('\n');

  function create(renderer, opts) {
    opts = opts || {};
    var w = opts.width || 2048, h = w / 2;
    var rt = new T.WebGLRenderTarget(w, h, {
      type: T.HalfFloatType, generateMipmaps: true, depthBuffer: false,
      minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter, wrapS: T.RepeatWrapping
    });
    rt.texture.mapping = T.EquirectangularReflectionMapping;
    rt.texture.colorSpace = T.LinearSRGBColorSpace;
    rt.texture.name = 'mall-sky-360';

    var mat = new T.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        uSun: { value: (opts.sunDir || new T.Vector3(0.3, 1, 0.3)).clone().normalize() },
        uMoon: { value: (opts.moonDir || new T.Vector3(-0.3, 0.9, -0.3)).clone().normalize() },
        uNight: { value: 0 }, uSeed: { value: opts.seed || 3.7 },
        uSkyGain: { value: opts.skyGain || 0.32 }, uCloudCover: { value: opts.cloudCover || 0.5 },
        uRes: { value: new T.Vector2(w, h) }
      }
    });
    var quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    var scene = new T.Scene(); scene.add(quad);
    var cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    function render(k) {
      mat.uniforms.uNight.value = k || 0;
      var prevTarget = renderer.getRenderTarget(), prevXr = renderer.xr.enabled, prevTone = renderer.toneMapping;
      renderer.xr.enabled = false;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.setRenderTarget(prevTarget);
      renderer.xr.enabled = prevXr; renderer.toneMapping = prevTone;
    }

    return {
      texture: rt.texture, target: rt, size: w, uniforms: mat.uniforms, render: render,
      setSeed: function (s) { mat.uniforms.uSeed.value = s; },
      dispose: function () { rt.dispose(); mat.dispose(); quad.geometry.dispose(); }
    };
  }

  // kubah langit yang menampilkan panorama (HDR; tone mapping tetap berlaku)
  function dome(texture) {
    var mat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { tPano: { value: texture }, uTexH: { value: texture.image ? texture.image.height : 1024 } },
      vertexShader: [
        'varying vec3 vDir;',
        'void main(){',
        '  vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;',
        '  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '  gl_Position = p.xyww;',
        '}'].join('\n'),
      fragmentShader: [
        'uniform sampler2D tPano; uniform float uTexH;',
        'varying vec3 vDir;',
        'void main(){',
        '  vec3 d = normalize(vDir);',
        '  vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);',
        // LOD dari turunan arah (bukan uv) → tidak ada garis di sambungan 0/360°
        '  float px = length(fwidth(d)) * uTexH * 0.31830989;',
        '  vec3 col = textureLod(tPano, uv, max(log2(max(px, 1e-4)), 0.0)).rgb;',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '}'].join('\n')
    });
    var mesh = new T.Mesh(new T.SphereGeometry(900, 48, 24), mat);
    mesh.frustumCulled = false; mesh.renderOrder = -10; mesh.userData.noAO = true;
    return mesh;
  }

  window.MallSky = { create: create, dome: dome };
})();
