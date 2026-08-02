// ---------------------------------------------------------------------------
// Stage 2 — procedural material library.
//
// Every facade family gets a real surface: value-noise bump + roughness
// variation so stucco reads as stucco, timber shows grain, stone shows blotchy
// mineral variation, brick shows courses. All generated in code (no texture
// downloads) and cached per (kind, seed) so the bundle stays light.
// ---------------------------------------------------------------------------
import * as THREE from "three";

export type MaterialKind =
  | "render"
  | "timber"
  | "stone"
  | "brick"
  | "corten"
  | "glass"
  | "jaali"
  | "concrete"
  | "tile";

const SIZE = 128;

function hash(x: number, y: number, seed: number) {
  let h = x * 374761393 + y * 668265263 + seed * 2246822519;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

function fbm(x: number, y: number, seed: number, octaves = 4) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(x * f, y * f, seed + i * 131) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

/** Height field in 0..1 for a given surface family. */
function surfaceValue(kind: MaterialKind, u: number, v: number, seed: number): number {
  const x = u * SIZE;
  const y = v * SIZE;
  switch (kind) {
    case "timber": {
      // Long grain along U with knots and plank joints.
      const grain = fbm(x * 0.06, y * 1.4, seed, 5);
      const plank = Math.abs(((v * 7) % 1) - 0.5) < 0.03 ? 0.25 : 1;
      return 0.45 + grain * 0.5 * plank;
    }
    case "brick": {
      const course = Math.floor(v * 22);
      const offset = course % 2 ? 0.5 : 0;
      const bu = (u * 9 + offset) % 1;
      const bv = (v * 22) % 1;
      const mortar = bu < 0.05 || bu > 0.95 || bv < 0.12 || bv > 0.88;
      return (mortar ? 0.18 : 0.78) + fbm(x * 0.5, y * 0.5, seed, 3) * 0.18;
    }
    case "stone": {
      const blot = fbm(x * 0.09, y * 0.09, seed, 5);
      const joint = ((v * 9) % 1 < 0.045 || (u * 6 + Math.floor(v * 9) * 0.35) % 1 < 0.035) ? 0.2 : 1;
      return (0.35 + blot * 0.6) * joint;
    }
    case "concrete": {
      // Board-formed: horizontal board lines + fine mottling.
      const board = Math.abs(((v * 14) % 1) - 0.5) < 0.04 ? 0.4 : 0.85;
      return board * (0.7 + fbm(x * 0.25, y * 0.25, seed, 4) * 0.5);
    }
    case "tile": {
      const rib = Math.sin(u * Math.PI * 26) * 0.5 + 0.5;
      return 0.35 + rib * 0.55 + fbm(x * 0.4, y * 0.4, seed, 2) * 0.12;
    }
    case "corten":
      return 0.3 + fbm(x * 0.12, y * 0.12, seed, 5) * 0.8;
    case "jaali":
      return 0.4 + fbm(x * 0.3, y * 0.3, seed, 3) * 0.5;
    case "glass":
      return 0.5 + fbm(x * 0.05, y * 0.05, seed, 2) * 0.1;
    case "render":
    default:
      // Hand-troweled lime plaster — soft, low-frequency undulation.
      return 0.45 + fbm(x * 0.18, y * 0.18, seed, 5) * 0.55;
  }
}

const cache = new Map<string, THREE.DataTexture>();

function buildTexture(kind: MaterialKind, seed: number, repeat: number): THREE.DataTexture {
  const key = `${kind}:${seed}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const val = Math.max(0, Math.min(1, surfaceValue(kind, x / SIZE, y / SIZE, seed)));
      const c = Math.round(val * 255);
      const i = (y * SIZE + x) * 4;
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

export interface SurfaceProps {
  roughness: number;
  metalness: number;
  bumpMap: THREE.Texture;
  bumpScale: number;
  roughnessMap: THREE.Texture;
  /** Slight sheen for polished / metal families. */
  envMapIntensity: number;
}

const TUNING: Record<MaterialKind, { roughness: number; metalness: number; bump: number; repeat: number; env: number }> = {
  render:   { roughness: 0.92, metalness: 0.0,  bump: 0.012, repeat: 3,   env: 0.5 },
  concrete: { roughness: 0.86, metalness: 0.02, bump: 0.02,  repeat: 2.5, env: 0.6 },
  timber:   { roughness: 0.68, metalness: 0.0,  bump: 0.016, repeat: 2,   env: 0.7 },
  stone:    { roughness: 0.88, metalness: 0.02, bump: 0.028, repeat: 2.5, env: 0.6 },
  brick:    { roughness: 0.9,  metalness: 0.0,  bump: 0.03,  repeat: 3,   env: 0.5 },
  corten:   { roughness: 0.62, metalness: 0.38, bump: 0.018, repeat: 2.5, env: 1.0 },
  glass:    { roughness: 0.14, metalness: 0.08, bump: 0.002, repeat: 1,   env: 1.3 },
  jaali:    { roughness: 0.84, metalness: 0.02, bump: 0.022, repeat: 3,   env: 0.6 },
  tile:     { roughness: 0.72, metalness: 0.03, bump: 0.03,  repeat: 4,   env: 0.6 },
};

/** Physically-plausible surface settings for a facade family. */
export function surfaceFor(kind: MaterialKind, seed = 1, scale = 1): SurfaceProps {
  const t = TUNING[kind] ?? TUNING.render;
  const tex = buildTexture(kind, seed % 977, Math.max(0.5, t.repeat * scale));
  return {
    roughness: t.roughness,
    metalness: t.metalness,
    bumpMap: tex,
    bumpScale: t.bump,
    roughnessMap: tex,
    envMapIntensity: t.env,
  };
}

// ---------------------------------------------------------------------------
// Lighting rig — one sun angle & colour temperature per variation, taken from
// the DNA mood so the render matches the design's stated time of day.
// ---------------------------------------------------------------------------
export interface LightingRig {
  /** Sun direction in scene space (already scaled out to a useful distance). */
  sun: [number, number, number];
  sunColor: string;
  sunIntensity: number;
  ambientColor: string;
  ambientIntensity: string | number;
  fillIntensity: number;
  /** drei <Sky> params. */
  skyTurbidity: number;
  skyRayleigh: number;
  exposure: number;
  /** Ground / paving tint for this light. */
  groundTint: string;
  environment: "park" | "sunset" | "dawn" | "city";
}

export function lightingFor(mood: string | undefined, seed = 0): LightingRig {
  const m = (mood ?? "").toLowerCase();
  const swing = ((seed % 7) - 3) * 2.2; // small per-design variety in sun azimuth

  if (m.includes("blue hour") || m.includes("twilight")) {
    return {
      sun: [-16 + swing, 7, -14], sunColor: "#7f96d6", sunIntensity: 1.1,
      ambientColor: "#4a5a80", ambientIntensity: 0.55, fillIntensity: 0.35,
      skyTurbidity: 6, skyRayleigh: 3.2, exposure: 1.0,
      groundTint: "#4d5361", environment: "dawn",
    };
  }
  if (m.includes("overcast") || m.includes("misty") || m.includes("haze")) {
    return {
      sun: [-12 + swing, 20, -10], sunColor: "#e8eef2", sunIntensity: 1.5,
      ambientColor: "#cfd8de", ambientIntensity: 0.85, fillIntensity: 0.55,
      skyTurbidity: 14, skyRayleigh: 1.2, exposure: 1.05,
      groundTint: "#8f9490", environment: "city",
    };
  }
  if (m.includes("noon")) {
    return {
      sun: [6 + swing, 30, -8], sunColor: "#fff6e2", sunIntensity: 2.6,
      ambientColor: "#dfe6ea", ambientIntensity: 0.5, fillIntensity: 0.4,
      skyTurbidity: 4, skyRayleigh: 1.6, exposure: 1.05,
      groundTint: "#8d9280", environment: "park",
    };
  }
  if (m.includes("monsoon") || m.includes("dusk")) {
    return {
      sun: [-20 + swing, 9, -16], sunColor: "#d9a06a", sunIntensity: 1.6,
      ambientColor: "#7a8390", ambientIntensity: 0.6, fillIntensity: 0.45,
      skyTurbidity: 9, skyRayleigh: 2.6, exposure: 1.08,
      groundTint: "#6b6f68", environment: "sunset",
    };
  }
  // Default: golden hour, warm low sun.
  return {
    sun: [-22 + swing, 13, -18], sunColor: "#ffcf96", sunIntensity: 2.3,
    ambientColor: "#c9b79a", ambientIntensity: 0.45, fillIntensity: 0.42,
    skyTurbidity: 7, skyRayleigh: 2.1, exposure: 1.12,
    groundTint: "#7f8368", environment: "sunset",
  };
}
