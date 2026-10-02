#!/usr/bin/env python3
"""Mengubah model produk .glb menjadi .usdz untuk AR Quick Look di iOS.

`<model-viewer>` memakai dua berkas: `.glb` untuk WebXR/Scene Viewer (Android)
dan `.usdz` untuk AR Quick Look (iPhone/iPad). Skrip ini membuat `.usdz` di
samping tiap `.glb` sehingga atribut `ios-src` di mall.html tinggal menunjuk
berkas dengan nama sama.

    pip install trimesh numpy usd-core
    python3 tools/glb-to-usdz.py

Catatan warna: model produk memakai vertex color glTF (linear). Nilai yang sama
dipakai langsung sebagai diffuseColor UsdPreviewSurface supaya tampilan di iOS
sama dengan di Android/web.

Model bertekstur (mobil Porsche) dikonversi lewat jalur terpisah yang membaca
GLB langsung: UV TEXCOORD_0 → primvar `st`, baseColorTexture → UsdUVTexture yang
ikut dipaket di dalam .usdz, plus clearcoat cat mobil. Tanpa jalur ini Quick Look
di iPhone/iPad hanya menampilkan warna rata-rata (abu-abu polos).
"""
import json
import os
import shutil
import struct
import sys
import tempfile

import numpy as np
import trimesh
from pxr import Usd, UsdGeom, UsdShade, UsdUtils, Sdf, Gf, Vt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORSCHE = os.path.join(ROOT, 'assets', 'Porsche 356B.glb')
PRODUCTS = os.path.join(ROOT, 'assets', 'products')
MINI_SCALE = 1.0 / 18.0            # miniatur die-cast 1:18 di unit A4


def mesh_color(geom):
    """Warna rata-rata satu bagian mesh, dalam 0..1."""
    vis = geom.visual
    try:
        cols = np.asarray(vis.vertex_colors, dtype=float)
        if len(cols):
            return (cols[:, :3].mean(axis=0) / 255.0).tolist()
    except Exception:
        pass
    try:
        base = getattr(vis.material, 'baseColorFactor', None)
        if base is not None:
            return (np.asarray(base, dtype=float)[:3] / 255.0).tolist()
    except Exception:
        pass
    return [0.8, 0.8, 0.8]


def mesh_pbr(geom):
    mat = getattr(getattr(geom, 'visual', None), 'material', None)
    metallic = float(getattr(mat, 'metallicFactor', 0.0) or 0.0)
    roughness = getattr(mat, 'roughnessFactor', None)
    return metallic, float(roughness if roughness is not None else 0.55)


def add_mesh(stage, parent, name, geom, matrix, scale):
    """Menulis satu bagian mesh sebagai UsdGeom.Mesh flat-shaded + materialnya."""
    verts = np.asarray(geom.vertices, dtype=np.float64)
    if matrix is not None and not np.allclose(matrix, np.eye(4)):
        verts = trimesh.transformations.transform_points(verts, matrix)
    verts = verts * scale

    faces = np.asarray(geom.faces, dtype=np.int64)
    # pecah vertex per segitiga supaya shading tetap flat seperti versi glTF-nya
    points = verts[faces].reshape(-1, 3)
    normals = np.repeat(np.asarray(geom.face_normals, dtype=np.float64), 3, axis=0)
    indices = np.arange(len(points), dtype=np.int64)

    mesh = UsdGeom.Mesh.Define(stage, parent.GetPath().AppendChild(name))
    mesh.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(points.astype(np.float32)))
    mesh.CreateNormalsAttr(Vt.Vec3fArray.FromNumpy(normals.astype(np.float32)))
    mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
    mesh.CreateFaceVertexIndicesAttr(indices.tolist())
    mesh.CreateFaceVertexCountsAttr([3] * len(faces))
    mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
    lo, hi = points.min(axis=0), points.max(axis=0)
    mesh.CreateExtentAttr([Gf.Vec3f(*lo.tolist()), Gf.Vec3f(*hi.tolist())])

    metallic, roughness = mesh_pbr(geom)
    color = mesh_color(geom)
    mat_path = Sdf.Path('/Root/Materials').AppendChild('mat_' + name)
    material = UsdShade.Material.Define(stage, mat_path)
    shader = UsdShade.Shader.Define(stage, mat_path.AppendChild('PreviewSurface'))
    shader.CreateIdAttr('UsdPreviewSurface')
    shader.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*[float(c) for c in color]))
    shader.CreateInput('metallic', Sdf.ValueTypeNames.Float).Set(metallic)
    shader.CreateInput('roughness', Sdf.ValueTypeNames.Float).Set(roughness)
    material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), 'surface')
    UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(material)
    return len(faces)


def convert(glb_path, usdz_path, scale=1.0):
    scene = trimesh.load(glb_path, force='scene')
    tmp = tempfile.mkdtemp()
    usdc = os.path.join(tmp, os.path.splitext(os.path.basename(usdz_path))[0] + '.usdc')

    stage = Usd.Stage.CreateNew(usdc)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)     # Quick Look: Y-up, satuan meter
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    root = UsdGeom.Xform.Define(stage, '/Root')
    stage.SetDefaultPrim(root.GetPrim())
    UsdGeom.Scope.Define(stage, '/Root/Materials')

    tris = 0
    for i, name in enumerate(scene.graph.nodes_geometry):
        matrix, geom_name = scene.graph[name]
        tris += add_mesh(stage, root, 'part_%d' % i, scene.geometry[geom_name], matrix, scale)

    stage.GetRootLayer().Save()
    if os.path.exists(usdz_path):
        os.remove(usdz_path)
    UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(usdc), usdz_path)
    size = os.path.getsize(usdz_path) / 1024
    print('%-34s %5d tri  %7.1f KB' % (os.path.basename(usdz_path), tris, size))


# ----------------------------------------------------------------------------
# GLB bertekstur
# ----------------------------------------------------------------------------
COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    data = open(path, 'rb').read()
    jlen = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack('<I', data[off:off + 4])[0]
    return gltf, data[off + 8:off + 8 + blen]


def write_glb(path, gltf, binary):
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    binary += b'\0' * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(binary), 0x004E4942) + binary)


def accessor(gltf, binary, idx):
    acc = gltf['accessors'][idx]
    view = gltf['bufferViews'][acc['bufferView']]
    dtype, n = COMP[acc['componentType']], NCOMP[acc['type']]
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = view.get('byteStride')
    item = np.dtype(dtype).itemsize * n
    if stride and stride != item:
        raw = np.frombuffer(binary, np.uint8, acc['count'] * stride, start).reshape(-1, stride)[:, :item]
        arr = np.frombuffer(raw.tobytes(), dtype)
    else:
        arr = np.frombuffer(binary, dtype, acc['count'] * n, start)
    return arr.reshape(-1, n) if n > 1 else arr


def node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
    t = trimesh.transformations
    m = t.translation_matrix(node.get('translation', [0, 0, 0]))
    q = node.get('rotation', [0, 0, 0, 1])
    m = m @ t.quaternion_matrix([q[3], q[0], q[1], q[2]])
    return m @ np.diag(list(node.get('scale', [1, 1, 1])) + [1])


def is_textured(glb_path):
    gltf, _ = read_glb(glb_path)
    return any(m.get('pbrMetallicRoughness', {}).get('baseColorTexture') for m in gltf.get('materials', []))


def convert_textured(glb_path, usdz_path, scale=1.0):
    gltf, binary = read_glb(glb_path)
    tmp = tempfile.mkdtemp()
    base = os.path.splitext(os.path.basename(usdz_path))[0]
    usdc = os.path.join(tmp, base + '.usdc')

    stage = Usd.Stage.CreateNew(usdc)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    root = UsdGeom.Xform.Define(stage, '/Root')
    stage.SetDefaultPrim(root.GetPrim())
    UsdGeom.Scope.Define(stage, '/Root/Materials')

    # tekstur ditulis di samping .usdc → ikut dipaket oleh CreateNewUsdzPackage
    tex_files = {}
    for i, img in enumerate(gltf.get('images', [])):
        ext = '.png' if img.get('mimeType') == 'image/png' else '.jpg'
        view = gltf['bufferViews'][img['bufferView']]
        fname = 'tex_%d%s' % (i, ext)
        with open(os.path.join(tmp, fname), 'wb') as f:
            f.write(binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']])
        tex_files[i] = fname

    materials = {}

    def material_for(mi):
        if mi in materials:
            return materials[mi]
        src = gltf['materials'][mi]
        pbr = src.get('pbrMetallicRoughness', {})
        path = Sdf.Path('/Root/Materials').AppendChild('mat_%d' % mi)
        mat = UsdShade.Material.Define(stage, path)
        surf = UsdShade.Shader.Define(stage, path.AppendChild('PreviewSurface'))
        surf.CreateIdAttr('UsdPreviewSurface')
        surf.CreateInput('metallic', Sdf.ValueTypeNames.Float).Set(float(pbr.get('metallicFactor', 1.0)))
        surf.CreateInput('roughness', Sdf.ValueTypeNames.Float).Set(float(pbr.get('roughnessFactor', 1.0)))
        cc = src.get('extensions', {}).get('KHR_materials_clearcoat')
        if cc:
            surf.CreateInput('clearcoat', Sdf.ValueTypeNames.Float).Set(float(cc.get('clearcoatFactor', 0.0)))
            surf.CreateInput('clearcoatRoughness', Sdf.ValueTypeNames.Float).Set(float(cc.get('clearcoatRoughnessFactor', 0.0)))
        tex = pbr.get('baseColorTexture')
        if tex is not None:
            reader = UsdShade.Shader.Define(stage, path.AppendChild('stReader'))
            reader.CreateIdAttr('UsdPrimvarReader_float2')
            reader.CreateInput('varname', Sdf.ValueTypeNames.Token).Set('st')
            uv = UsdShade.Shader.Define(stage, path.AppendChild('diffuseTexture'))
            uv.CreateIdAttr('UsdUVTexture')
            uv.CreateInput('file', Sdf.ValueTypeNames.Asset).Set(tex_files[gltf['textures'][tex['index']]['source']])
            uv.CreateInput('sourceColorSpace', Sdf.ValueTypeNames.Token).Set('sRGB')
            uv.CreateInput('wrapS', Sdf.ValueTypeNames.Token).Set('repeat')
            uv.CreateInput('wrapT', Sdf.ValueTypeNames.Token).Set('repeat')
            uv.CreateInput('st', Sdf.ValueTypeNames.Float2).ConnectToSource(reader.ConnectableAPI(), 'result')
            factor = pbr.get('baseColorFactor')
            if factor:
                uv.CreateInput('scale', Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(*[float(c) for c in factor]))
            uv.CreateOutput('rgb', Sdf.ValueTypeNames.Float3)
            surf.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).ConnectToSource(uv.ConnectableAPI(), 'rgb')
        else:
            col = pbr.get('baseColorFactor', [0.8, 0.8, 0.8, 1])
            surf.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*[float(c) for c in col[:3]]))
        mat.CreateSurfaceOutput().ConnectToSource(surf.ConnectableAPI(), 'surface')
        materials[mi] = mat
        return mat

    tris = 0

    def walk(ni, parent_m):
        nonlocal tris
        node = gltf['nodes'][ni]
        m = parent_m @ node_matrix(node)
        if 'mesh' in node:
            for pi, prim in enumerate(gltf['meshes'][node['mesh']]['primitives']):
                a = prim['attributes']
                pos = accessor(gltf, binary, a['POSITION']).astype(np.float64)
                pos = (np.c_[pos, np.ones(len(pos))] @ m.T)[:, :3] * scale
                idx = accessor(gltf, binary, prim['indices']).astype(np.int64) if 'indices' in prim else np.arange(len(pos))
                name = 'mesh_%d_%d' % (ni, pi)
                mesh = UsdGeom.Mesh.Define(stage, root.GetPath().AppendChild(name))
                mesh.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(pos.astype(np.float32)))
                mesh.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(idx.astype(np.int32)))
                mesh.CreateFaceVertexCountsAttr(Vt.IntArray.FromNumpy(np.full(len(idx) // 3, 3, np.int32)))
                mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
                mesh.CreateDoubleSidedAttr(gltf['materials'][prim.get('material', 0)].get('doubleSided', False))
                if 'NORMAL' in a:
                    nrm = accessor(gltf, binary, a['NORMAL']).astype(np.float64) @ np.linalg.inv(m[:3, :3]).T
                    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
                    mesh.CreateNormalsAttr(Vt.Vec3fArray.FromNumpy(nrm.astype(np.float32)))
                    mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
                if 'TEXCOORD_0' in a:
                    st = accessor(gltf, binary, a['TEXCOORD_0']).astype(np.float32).copy()
                    st[:, 1] = 1.0 - st[:, 1]               # glTF: v ke bawah, USD: v ke atas
                    pv = UsdGeom.PrimvarsAPI(mesh).CreatePrimvar('st', Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.vertex)
                    pv.Set(Vt.Vec2fArray.FromNumpy(st))
                lo, hi = pos.min(axis=0), pos.max(axis=0)
                mesh.CreateExtentAttr([Gf.Vec3f(*lo.tolist()), Gf.Vec3f(*hi.tolist())])
                UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(material_for(prim.get('material', 0)))
                tris += len(idx) // 3
        for c in node.get('children', []):
            walk(c, m)

    for ni in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        walk(ni, np.eye(4))

    stage.GetRootLayer().Save()
    if os.path.exists(usdz_path):
        os.remove(usdz_path)
    cwd = os.getcwd()
    os.chdir(tmp)                                   # path tekstur relatif terhadap .usdc
    try:
        UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(os.path.basename(usdc)), usdz_path)
    finally:
        os.chdir(cwd)
    shutil.rmtree(tmp, ignore_errors=True)
    print('%-34s %5d tri  %7.1f KB  (bertekstur)' % (os.path.basename(usdz_path), tris, os.path.getsize(usdz_path) / 1024))


def scaled_copy(src, dst, scale):
    """Salin GLB apa adanya (tekstur, material, ekstensi) dengan skala di node akar."""
    gltf, binary = read_glb(src)
    wrapper = {'name': 'scale_%g' % scale, 'scale': [scale] * 3,
               'children': list(gltf['scenes'][gltf.get('scene', 0)]['nodes'])}
    gltf['nodes'].append(wrapper)
    gltf['scenes'][gltf.get('scene', 0)]['nodes'] = [len(gltf['nodes']) - 1]
    write_glb(dst, gltf, binary)


def any_to_usdz(glb_path, usdz_path, scale=1.0):
    (convert_textured if is_textured(glb_path) else convert)(glb_path, usdz_path, scale)


def main():
    if not os.path.exists(PORSCHE):
        sys.exit('Tidak menemukan %s' % PORSCHE)

    # miniatur 1:18 untuk unit A4 diturunkan dari model showroom yang sama
    mini_glb = os.path.join(PRODUCTS, 'porsche-356b-1-18.glb')
    scaled_copy(PORSCHE, mini_glb, MINI_SCALE)    # tekstur & clearcoat ikut terbawa
    print('%-34s %7.1f KB (turunan 1:18)' % (os.path.basename(mini_glb), os.path.getsize(mini_glb) / 1024))

    any_to_usdz(PORSCHE, os.path.join(ROOT, 'assets', 'Porsche 356B.usdz'))
    for name in sorted(os.listdir(PRODUCTS)):
        if name.endswith('.glb'):
            any_to_usdz(os.path.join(PRODUCTS, name),
                        os.path.join(PRODUCTS, name[:-4] + '.usdz'))


if __name__ == '__main__':
    main()
