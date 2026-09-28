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
"""
import os
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


def main():
    if not os.path.exists(PORSCHE):
        sys.exit('Tidak menemukan %s' % PORSCHE)

    # miniatur 1:18 untuk unit A4 diturunkan dari model showroom yang sama
    mini_glb = os.path.join(PRODUCTS, 'porsche-356b-1-18.glb')
    mini = trimesh.load(PORSCHE, force='scene')
    mini.apply_scale(MINI_SCALE)
    mini.export(mini_glb)
    print('%-34s %7.1f KB (turunan 1:18)' % (os.path.basename(mini_glb), os.path.getsize(mini_glb) / 1024))

    convert(PORSCHE, os.path.join(ROOT, 'assets', 'Porsche 356B.usdz'))
    for name in sorted(os.listdir(PRODUCTS)):
        if name.endswith('.glb'):
            convert(os.path.join(PRODUCTS, name),
                    os.path.join(PRODUCTS, name[:-4] + '.usdz'))


if __name__ == '__main__':
    main()
