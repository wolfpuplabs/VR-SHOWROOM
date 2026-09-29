# three.js post-processing (vendored)

Salinan modul `examples/jsm` dari [three.js](https://github.com/mrdoob/three.js) (MIT, lihat `LICENSE`)
untuk pipeline post-processing di `mall-post.js`:

| Berkas | Versi |
| --- | --- |
| `postprocessing/{EffectComposer,Pass,RenderPass,ShaderPass,MaskPass,UnrealBloomPass,OutputPass}.js` | r158 (sama dengan A-Frame 1.5) |
| `shaders/{CopyShader,LuminosityHighPassShader,OutputShader,FXAAShader}.js` | r158 |
| `postprocessing/GTAOPass.js`, `shaders/{GTAOShader,PoissonDenoiseShader}.js`, `math/SimplexNoise.js` | r162 (GTAO belum ada di r158; hanya memakai API yang sudah ada di r158) |

Semua `import ... from 'three'` diarahkan oleh import map ke `three-shim.js`, yang mengekspor ulang
`AFRAME.THREE` — jadi tidak ada salinan three.js kedua yang dimuat.

Catatan: three versi A-Frame (super-three) menganggap `DepthTexture` tanpa `image.depth` sebagai
texture array; `mall-post.js` menyetel `image.depth = 1` pada depth texture GTAO setelah membuatnya.
