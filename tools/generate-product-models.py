#!/usr/bin/env python3
"""Membuat model .glb sederhana (low-poly, ukuran nyata dalam meter) untuk
produk yang dipajang di dalam toko Wolfpup Virtual Mall.

Model sengaja dibuat kecil (beberapa KB) supaya cepat dimuat di WebXR/AR dan
tidak membebani repo. Jalankan ulang bila katalog produk berubah:

    pip install trimesh numpy
    python3 tools/generate-product-models.py
"""
import os
import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix, translation_matrix

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'products')
os.makedirs(OUT, exist_ok=True)


def hexcol(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)] + [255]


def paint(mesh, color):
    mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=np.tile(hexcol(color), (len(mesh.vertices), 1)))
    return mesh


def box(size, color, pos=(0, 0, 0), rot=None):
    m = trimesh.creation.box(extents=size)
    if rot is not None:
        m.apply_transform(rotation_matrix(np.radians(rot[0]), [1, 0, 0]))
        m.apply_transform(rotation_matrix(np.radians(rot[1]), [0, 1, 0]))
        m.apply_transform(rotation_matrix(np.radians(rot[2]), [0, 0, 1]))
    m.apply_translation(pos)
    return paint(m, color)


def cyl(radius, height, color, pos=(0, 0, 0), axis='y', sections=28):
    m = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    if axis == 'y':
        m.apply_transform(rotation_matrix(np.pi / 2, [1, 0, 0]))
    elif axis == 'x':
        m.apply_transform(rotation_matrix(np.pi / 2, [0, 1, 0]))
    m.apply_translation(pos)
    return paint(m, color)


def cone(r_bottom, r_top, height, color, pos=(0, 0, 0), sections=28):
    """Kerucut terpotong (mis. badan gelas kopi)."""
    ang = np.linspace(0, 2 * np.pi, sections, endpoint=False)
    bottom = np.column_stack([r_bottom * np.cos(ang), np.full(sections, -height / 2), r_bottom * np.sin(ang)])
    top = np.column_stack([r_top * np.cos(ang), np.full(sections, height / 2), r_top * np.sin(ang)])
    verts = np.vstack([bottom, top, [[0, -height / 2, 0]], [[0, height / 2, 0]]])
    bc, tc = 2 * sections, 2 * sections + 1
    faces = []
    for i in range(sections):
        j = (i + 1) % sections
        faces += [[i, j, sections + j], [i, sections + j, sections + i],
                  [bc, j, i], [tc, sections + i, sections + j]]
    m = trimesh.Trimesh(vertices=verts, faces=np.array(faces), process=True)
    m.apply_translation(pos)
    return paint(m, color)


def sphere(radius, color, pos=(0, 0, 0), scale=(1, 1, 1)):
    m = trimesh.creation.icosphere(subdivisions=2, radius=radius)
    m.apply_transform(np.diag([scale[0], scale[1], scale[2], 1]))
    m.apply_translation(pos)
    return paint(m, color)


def save(name, parts):
    scene = trimesh.Scene(parts)
    path = os.path.join(OUT, name + '.glb')
    scene.export(path)
    print('%-22s %6.1f KB' % (name + '.glb', os.path.getsize(path) / 1024))


# ---------------------------------------------------------------- katalog ---
# jam tangan pintar (± 4.5 cm)
save('smartwatch', [
    box((0.042, 0.011, 0.046), '#23262e', (0, 0.012, 0), rot=None),
    box((0.036, 0.002, 0.040), '#0e7ea8', (0, 0.018, 0)),
    cyl(0.004, 0.008, '#c9a227', (0.023, 0.012, 0), axis='x'),
    box((0.024, 0.006, 0.075), '#1b1d23', (0, 0.002, 0.055), rot=(18, 0, 0)),
    box((0.024, 0.006, 0.075), '#1b1d23', (0, 0.002, -0.055), rot=(-18, 0, 0)),
])

# ponsel (± 16 cm)
save('smartphone', [
    box((0.074, 0.008, 0.156), '#2b2f3a'),
    box((0.068, 0.001, 0.150), '#101828', (0, 0.0046, 0)),
    box((0.026, 0.004, 0.026), '#3b4150', (-0.018, -0.0055, 0.056)),
    cyl(0.006, 0.005, '#0b0e14', (-0.025, -0.0075, 0.062)),
    cyl(0.006, 0.005, '#0b0e14', (-0.011, -0.0075, 0.050)),
])

# gelas kopi takeaway (± 14 cm)
save('coffee-cup', [
    cone(0.035, 0.043, 0.115, '#f4efe6', (0, 0.0575, 0)),
    cyl(0.0445, 0.012, '#3f2d1e', (0, 0.119, 0)),
    cyl(0.020, 0.004, '#2b1d12', (0, 0.126, 0)),
    cyl(0.042, 0.040, '#b07a4a', (0, 0.055, 0)),
])

# botol cold brew (± 22 cm)
save('coffee-bottle', [
    cyl(0.034, 0.150, '#4a2c17', (0, 0.075, 0)),
    cone(0.034, 0.016, 0.045, '#4a2c17', (0, 0.1725, 0)),
    cyl(0.017, 0.030, '#4a2c17', (0, 0.210, 0)),
    cyl(0.019, 0.016, '#d8b45f', (0, 0.222, 0)),
    cyl(0.0345, 0.070, '#e8e2d2', (0, 0.070, 0)),
])

# kue tart (± 22 cm)
save('cake', [
    cyl(0.105, 0.045, '#f6e2c0', (0, 0.0225, 0)),
    cyl(0.108, 0.012, '#e8b6c6', (0, 0.051, 0)),
    cyl(0.100, 0.040, '#fff6ea', (0, 0.077, 0)),
    cyl(0.103, 0.010, '#d9718f', (0, 0.102, 0)),
    sphere(0.014, '#c0392b', (0, 0.115, 0)),
    cyl(0.112, 0.006, '#c9c2b4', (0, 0.003, 0)),
])

# roti sourdough (± 24 cm)
save('bread', [
    sphere(0.115, '#c98b4b', (0, 0.055, 0), scale=(1.0, 0.55, 0.75)),
    box((0.10, 0.012, 0.012), '#8a5a2b', (0, 0.095, 0.012), rot=(0, 18, 0)),
    box((0.09, 0.012, 0.012), '#8a5a2b', (0, 0.092, -0.022), rot=(0, 18, 0)),
])

# dumbbell (± 35 cm)
save('dumbbell', [
    cyl(0.016, 0.180, '#9aa3b2', (0, 0, 0), axis='x'),
    cyl(0.020, 0.030, '#6d7480', (0.055, 0, 0), axis='x'),
    cyl(0.020, 0.030, '#6d7480', (-0.055, 0, 0), axis='x'),
    cyl(0.062, 0.028, '#2b2f38', (0.090, 0, 0), axis='x'),
    cyl(0.062, 0.028, '#2b2f38', (-0.090, 0, 0), axis='x'),
    cyl(0.050, 0.030, '#39404b', (0.120, 0, 0), axis='x'),
    cyl(0.050, 0.030, '#39404b', (-0.120, 0, 0), axis='x'),
])

# matras yoga tergulung (± 60 cm)
save('yoga-mat', [
    cyl(0.075, 0.600, '#5aa9a0', (0, 0, 0), axis='x'),
    cyl(0.076, 0.050, '#2f6f6a', (0.180, 0, 0), axis='x'),
    cyl(0.076, 0.050, '#2f6f6a', (-0.180, 0, 0), axis='x'),
    cyl(0.026, 0.610, '#3d8a83', (0, 0, 0), axis='x'),
])

# gelas jus + sedotan (± 17 cm)
save('juice-cup', [
    cone(0.034, 0.042, 0.130, '#ffb84d', (0, 0.065, 0)),
    cyl(0.044, 0.010, '#cfd6de', (0, 0.132, 0)),
    sphere(0.042, '#e9eef4', (0, 0.140, 0), scale=(1, 0.55, 1)),
    cyl(0.005, 0.120, '#e4572e', (0.012, 0.190, 0), axis='y'),
])

# kemeja batik terlipat (± 30 cm)
save('batik-shirt', [
    box((0.28, 0.018, 0.20), '#6b4a2f', (0, 0.009, 0)),
    box((0.27, 0.016, 0.19), '#9c6b3f', (0, 0.026, 0)),
    box((0.26, 0.016, 0.18), '#3f5d52', (0, 0.042, 0)),
    box((0.10, 0.012, 0.05), '#f2ead9', (0, 0.055, -0.06)),
    box((0.24, 0.004, 0.02), '#d8c9a8', (0, 0.052, 0.03)),
])

# gulungan kain batik (± 50 cm)
save('batik-roll', [
    cyl(0.055, 0.480, '#7a4b2a', (0, 0, 0), axis='x'),
    cyl(0.057, 0.060, '#c9a227', (0.120, 0, 0), axis='x'),
    cyl(0.057, 0.060, '#c9a227', (-0.120, 0, 0), axis='x'),
    cyl(0.020, 0.520, '#e8dcc0', (0, 0, 0), axis='x'),
    box((0.010, 0.060, 0.470), '#5d3a20', (0, 0.050, 0), rot=(0, 90, 0)),
])
