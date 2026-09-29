/* =====================================================================
   WOLFPUP VIRTUAL MALL — post-processing sinematik
   ---------------------------------------------------------------------
   Pipeline (HDR, linear):
     RenderPass (MSAA) → GTAO (ambient occlusion + denoise) → Bloom
     → OutputPass (tone mapping ACES + sRGB) → FXAA (tanpa MSAA)
     → Grade (kurva filmic, split toning, vignette, aberasi kromatik, grain)

   Modul ini menyisip ke render loop A-Frame dengan membungkus
   renderer.render: panggilan untuk scene utama diarahkan ke composer,
   panggilan lain (PMREM, shadow, pass internal) diteruskan apa adanya.
   Di mode VR (WebXR) pipeline otomatis dilewati.
   ===================================================================== */
import { EffectComposer } from './vendor/three/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/three/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './vendor/three/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/postprocessing/OutputPass.js';
import { GTAOPass } from './vendor/three/postprocessing/GTAOPass.js';
import { FXAAShader } from './vendor/three/shaders/FXAAShader.js';

const T = window.AFRAME.THREE;

// profil per tier kualitas (tier "low" tidak memakai post-processing)
const PROFILES = {
  high:   { msaa: 4, fxaa: false, ao: true, aoScale: 0.75, aoSamples: 16, pdSamples: 16, bloom: true, grain: 0.022, ca: 0.0012 },
  medium: { msaa: 0, fxaa: true,  ao: true, aoScale: 0.5,  aoSamples: 8,  pdSamples: 8,  bloom: true, grain: 0.018, ca: 0.0008 }
};

// grading sinematik — dijalankan di ruang tampilan (setelah tone mapping)
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new T.Vector2(1, 1) },
    uTime: { value: 0 },
    uContrast: { value: 0.35 },
    uSat: { value: 1.08 },
    uShadowTint: { value: new T.Vector3(-0.004, 0.01, 0.03) },
    uHighTint: { value: new T.Vector3(0.03, 0.014, -0.012) },
    uVignette: { value: 0.28 },
    uGrain: { value: 0.03 },
    uCA: { value: 0.0025 }
  },
  vertexShader: [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
  ].join('\n'),
  fragmentShader: [
    'uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime;',
    'uniform float uContrast; uniform float uSat; uniform vec3 uShadowTint; uniform vec3 uHighTint;',
    'uniform float uVignette; uniform float uGrain; uniform float uCA;',
    'varying vec2 vUv;',
    'const vec3 W = vec3(0.2126, 0.7152, 0.0722);',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'void main(){',
    '  vec2 c = vUv - 0.5;',
    '  float r2 = dot(c, c);',
    // aberasi kromatik radial: nol di tengah, tipis di tepi layar
    '  vec2 off = c * uCA * r2 * 4.0;',
    '  vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);',
    // kurva S filmic
    '  col = clamp(col, 0.0, 1.0);',
    '  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);',
    // split toning: bayangan sedikit teal, highlight sedikit hangat
    '  float l = dot(col, W);',
    '  col += uShadowTint * (1.0 - smoothstep(0.0, 0.55, l)) + uHighTint * smoothstep(0.45, 1.0, l);',
    '  l = dot(col, W);',
    '  col = mix(vec3(l), col, uSat);',
    // vignette mengikuti rasio layar
    '  float v = smoothstep(0.38, 1.05, length(c * vec2(uRes.x / uRes.y, 1.0)) * 1.25);',
    '  col *= 1.0 - v * uVignette;',
    // film grain halus, lebih kuat di midtone
    '  float g = hash(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5;',
    '  col += g * uGrain * (1.0 - abs(l - 0.5));',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n')
};

// nilai grading & bloom untuk siang (0) dan malam (1)
const LOOK = {
  day:   { contrast: 0.32, sat: 1.08, vignette: 0.26, shadow: [-0.004, 0.01, 0.028], high: [0.03, 0.014, -0.012], bloom: 0.22, threshold: 2.4, radius: 0.45 },
  night: { contrast: 0.4,  sat: 1.06, vignette: 0.38, shadow: [0.0, 0.008, 0.045], high: [0.035, 0.018, 0.0], bloom: 0.5, threshold: 1.1, radius: 0.6 }
};

function lerp(a, b, t) { return a + (b - a) * t; }

function attach(sceneEl, opts) {
  opts = opts || {};
  const profile = PROFILES[opts.quality];
  if (!profile) return null;

  const renderer = sceneEl.renderer, scene = sceneEl.object3D;
  const size = renderer.getSize(new T.Vector2());
  const pr = renderer.getPixelRatio();

  const target = new T.WebGLRenderTarget(size.x * pr, size.y * pr, { type: T.HalfFloatType, samples: profile.msaa });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(pr);

  const renderPass = new RenderPass(scene, sceneEl.camera);
  composer.addPass(renderPass);

  let gtao = null;
  if (profile.ao) {
    gtao = new GTAOPass(scene, sceneEl.camera, size.x, size.y);
    // three versi A-Frame (super-three) memperlakukan DepthTexture tanpa image.depth
    // sebagai texture array → depth buffer AO rusak. Tandai eksplisit sebagai 2D.
    if (gtao.depthTexture && gtao.depthTexture.image) gtao.depthTexture.image.depth = 1;
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = opts.quality === 'high' ? 1.0 : 0.9;
    gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.3, thickness: 1.2, scale: 1.15, samples: profile.aoSamples, distanceFallOff: 1.0 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1.5, rings: 2, samples: profile.pdSamples });
    // kaca, air, daun ber-alpha, sprite, dan langit tidak ikut pass kedalaman AO —
    // kalau ikut, kaca etalase dianggap dinding padat dan muncul bercak gelap
    const baseOverride = gtao.overrideVisibility.bind(gtao);
    gtao.overrideVisibility = function () {
      baseOverride();
      scene.traverse(function (o) {
        if (!o.visible) return;
        const m = o.material;
        if (o.isSprite || o.userData.noAO ||
            (m && (m.transparent || m.alphaTest > 0 || m.isShaderMaterial || (m.isMeshBasicMaterial && !m.map && m.toneMapped === false)))) {
          o.visible = false;
        }
      });
    };
    composer.addPass(gtao);
  }

  let bloom = null;
  if (profile.bloom) {
    bloom = new UnrealBloomPass(new T.Vector2(size.x, size.y), LOOK.day.bloom, LOOK.day.radius, LOOK.day.threshold);
    composer.addPass(bloom);
  }

  composer.addPass(new OutputPass());

  let fxaa = null;
  if (profile.fxaa) {
    fxaa = new ShaderPass(FXAAShader);
    composer.addPass(fxaa);
  }

  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uGrain.value = profile.grain;
  grade.uniforms.uCA.value = profile.ca;
  composer.addPass(grade);

  function resize() {
    const s = renderer.getSize(new T.Vector2()), p = renderer.getPixelRatio();
    composer.setPixelRatio(p);
    composer.setSize(s.x, s.y);
    if (gtao) gtao.setSize(Math.round(s.x * p * profile.aoScale), Math.round(s.y * p * profile.aoScale));
    if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (s.x * p), 1 / (s.y * p));
    grade.uniforms.uRes.value.set(s.x * p, s.y * p);
  }
  resize();
  sceneEl.addEventListener('rendererresize', resize);
  window.addEventListener('resize', function () { setTimeout(resize, 50); });

  // arahkan render scene utama ke composer
  const originalRender = renderer.render.bind(renderer);
  renderer.info.autoReset = false;
  const clock = new T.Clock();
  let inside = false, enabled = true;
  renderer.render = function (s, c) {
    if (enabled && !inside && s === scene && !renderer.xr.isPresenting) {
      inside = true;
      // statistik draw call dihitung untuk seluruh frame (semua pass), bukan pass terakhir saja
      renderer.info.reset();
      try {
        renderPass.camera = c;
        if (gtao) gtao.camera = c;
        grade.uniforms.uTime.value += clock.getDelta();
        composer.render();
      } finally {
        inside = false;
      }
      return;
    }
    if (!inside && s === scene) renderer.info.reset();
    return originalRender(s, c);
  };

  // k: 0 siang → 1 malam
  function setNight(k) {
    const D = LOOK.day, N = LOOK.night, u = grade.uniforms;
    u.uContrast.value = lerp(D.contrast, N.contrast, k);
    u.uSat.value = lerp(D.sat, N.sat, k);
    u.uVignette.value = lerp(D.vignette, N.vignette, k);
    u.uShadowTint.value.set(lerp(D.shadow[0], N.shadow[0], k), lerp(D.shadow[1], N.shadow[1], k), lerp(D.shadow[2], N.shadow[2], k));
    u.uHighTint.value.set(lerp(D.high[0], N.high[0], k), lerp(D.high[1], N.high[1], k), lerp(D.high[2], N.high[2], k));
    if (bloom) {
      bloom.strength = lerp(D.bloom, N.bloom, k);
      bloom.threshold = lerp(D.threshold, N.threshold, k);
      bloom.radius = lerp(D.radius, N.radius, k);
    }
  }
  setNight(opts.night || 0);

  const handle = sceneEl.mallPost = {
    profile: opts.quality,
    setNight: setNight,
    setEnabled: function (on) { enabled = !!on; },
    isActive: function () { return enabled && !renderer.xr.isPresenting; },
    passes: { gtao: gtao, bloom: bloom, grade: grade, fxaa: fxaa }
  };
  return handle;
}

window.MallPost = { attach: attach, profiles: PROFILES };
window.dispatchEvent(new Event('mallpost-ready'));
