// Shim ES module: modul post-processing three.js (examples/jsm) meng-import 'three';
// import map di mall.html mengarahkan 'three' ke sini supaya semua pass memakai
// instance THREE yang sama dengan A-Frame (tidak memuat three.js kedua).
const THREE = window.AFRAME.THREE;

export const ACESFilmicToneMapping = THREE.ACESFilmicToneMapping;
export const AddEquation = THREE.AddEquation;
export const AdditiveBlending = THREE.AdditiveBlending;
export const BufferGeometry = THREE.BufferGeometry;
export const CineonToneMapping = THREE.CineonToneMapping;
export const Clock = THREE.Clock;
export const Color = THREE.Color;
export const ColorManagement = THREE.ColorManagement;
export const CustomBlending = THREE.CustomBlending;
export const DataTexture = THREE.DataTexture;
export const DepthStencilFormat = THREE.DepthStencilFormat;
export const DepthTexture = THREE.DepthTexture;
export const DstAlphaFactor = THREE.DstAlphaFactor;
export const DstColorFactor = THREE.DstColorFactor;
export const Float32BufferAttribute = THREE.Float32BufferAttribute;
export const HalfFloatType = THREE.HalfFloatType;
export const LinearToneMapping = THREE.LinearToneMapping;
export const Matrix4 = THREE.Matrix4;
export const Mesh = THREE.Mesh;
export const MeshBasicMaterial = THREE.MeshBasicMaterial;
export const MeshNormalMaterial = THREE.MeshNormalMaterial;
export const NearestFilter = THREE.NearestFilter;
export const NoBlending = THREE.NoBlending;
export const OrthographicCamera = THREE.OrthographicCamera;
export const RGBAFormat = THREE.RGBAFormat;
export const RawShaderMaterial = THREE.RawShaderMaterial;
export const ReinhardToneMapping = THREE.ReinhardToneMapping;
export const RepeatWrapping = THREE.RepeatWrapping;
export const SRGBTransfer = THREE.SRGBTransfer;
export const ShaderMaterial = THREE.ShaderMaterial;
export const UniformsUtils = THREE.UniformsUtils;
export const UnsignedByteType = THREE.UnsignedByteType;
export const UnsignedInt248Type = THREE.UnsignedInt248Type;
export const Vector2 = THREE.Vector2;
export const Vector3 = THREE.Vector3;
export const WebGLRenderTarget = THREE.WebGLRenderTarget;
export const ZeroFactor = THREE.ZeroFactor;

export default THREE;
