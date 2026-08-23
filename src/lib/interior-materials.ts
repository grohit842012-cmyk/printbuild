/**
 * Procedural material library.
 *
 * All textures are generated in-canvas at runtime so nothing has to be
 * downloaded, and every design variation can get its own combination of
 * surfaces (wood species, plaster tone, stone coursing…) without shipping
 * image assets.
 */
import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

function canvasTexture(
  key: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, s: number) => void,
  repeat: [number, number] = [1, 1],
): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const ck = `${key}|${repeat[0]}x${repeat[1]}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(ck, tex);
  return tex;
}

function noise(ctx: CanvasRenderingContext2D, s: number, amount: number, alpha = 0.06) {
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  void alpha;
}

/** Wide-plank wood flooring. */
export function woodTexture(base: string, dark: string, repeat: [number, number] = [3, 3]) {
  return canvasTexture(`wood-${base}-${dark}`, 512, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const planks = 6;
    const ph = s / planks;
    for (let p = 0; p < planks; p++) {
      const y = p * ph;
      const shade = 0.88 + Math.random() * 0.24;
      ctx.fillStyle = shadeHex(base, shade);
      ctx.fillRect(0, y, s, ph - 1);
      // grain streaks
      for (let g = 0; g < 26; g++) {
        ctx.strokeStyle = withAlpha(dark, 0.05 + Math.random() * 0.09);
        ctx.lineWidth = 0.6 + Math.random() * 1.4;
        ctx.beginPath();
        const gy = y + Math.random() * ph;
        ctx.moveTo(0, gy);
        for (let x = 0; x <= s; x += 32) {
          ctx.lineTo(x, gy + Math.sin((x + p * 40) * 0.02) * 1.8);
        }
        ctx.stroke();
      }
      // plank seam
      ctx.strokeStyle = withAlpha(dark, 0.5);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, y + ph);
      ctx.lineTo(s, y + ph);
      ctx.stroke();
      // butt joint
      const jx = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(jx, y);
      ctx.lineTo(jx, y + ph);
      ctx.stroke();
    }
    noise(ctx, s, 10);
  }, repeat);
}

/** Matte plaster / lime render — the base wall surface, inside and out. */
export function plasterTexture(color: string, repeat: [number, number] = [2, 2], grit = 16) {
  return canvasTexture(`plaster-${color}-${grit}`, 256, (ctx, s) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = withAlpha(Math.random() > 0.5 ? "#ffffff" : "#000000", 0.02 + Math.random() * 0.03);
      const r = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
    noise(ctx, s, grit);
  }, repeat);
}

/** Polished / board-formed concrete. */
export function concreteTexture(color: string, repeat: [number, number] = [2, 2]) {
  return canvasTexture(`concrete-${color}`, 256, (ctx, s) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const g = ctx.createRadialGradient(Math.random() * s, Math.random() * s, 2, Math.random() * s, Math.random() * s, 60);
      g.addColorStop(0, withAlpha("#ffffff", 0.05));
      g.addColorStop(1, withAlpha("#000000", 0.03));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    // form-board lines
    for (let y = 0; y < s; y += s / 4) {
      ctx.strokeStyle = withAlpha("#000000", 0.07);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    noise(ctx, s, 14);
  }, repeat);
}

/** Coursed stone / large-format tile. */
export function stoneTexture(color: string, repeat: [number, number] = [3, 3]) {
  return canvasTexture(`stone-${color}`, 512, (ctx, s) => {
    ctx.fillStyle = shadeHex(color, 0.86);
    ctx.fillRect(0, 0, s, s);
    const rows = 5;
    const rh = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = -Math.random() * 60;
      while (x < s) {
        const bw = 60 + Math.random() * 90;
        ctx.fillStyle = shadeHex(color, 0.9 + Math.random() * 0.22);
        ctx.fillRect(x + 1.5, r * rh + 1.5, bw - 3, rh - 3);
        x += bw;
      }
    }
    noise(ctx, s, 12);
  }, repeat);
}

/** Vertical timber battens for facades. */
export function battenTexture(color: string, repeat: [number, number] = [4, 2]) {
  return canvasTexture(`batten-${color}`, 256, (ctx, s) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    const n = 10;
    for (let i = 0; i < n; i++) {
      const x = (i * s) / n;
      ctx.fillStyle = shadeHex(color, 0.86 + Math.random() * 0.28);
      ctx.fillRect(x + 1, 0, s / n - 3, s);
      ctx.fillStyle = withAlpha("#000000", 0.32);
      ctx.fillRect(x + s / n - 3, 0, 2, s);
    }
    noise(ctx, s, 10);
  }, repeat);
}

/** Paving / driveway. */
export function pavingTexture(color: string, repeat: [number, number] = [6, 6]) {
  return canvasTexture(`paving-${color}`, 256, (ctx, s) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    const n = 4;
    const c = s / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = shadeHex(color, 0.92 + Math.random() * 0.16);
        ctx.fillRect(i * c + 2, j * c + 2, c - 4, c - 4);
      }
    }
    noise(ctx, s, 16);
  }, repeat);
}

/** Grass with mown banding. */
export function grassTexture(repeat: [number, number] = [10, 10]) {
  return canvasTexture("grass", 256, (ctx, s) => {
    ctx.fillStyle = "#6f9450";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      ctx.strokeStyle = withAlpha(["#5b7f3e", "#7fa65c", "#4d6f34", "#87ad64"][i % 4], 0.7);
      ctx.lineWidth = 1;
      const x = Math.random() * s;
      const y = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 3);
      ctx.stroke();
    }
    noise(ctx, s, 10);
  }, repeat);
}

/** Roof surfaces: tile courses, standing seam, or membrane. */
export function roofTexture(kind: "tile" | "seam" | "membrane", color: string) {
  return canvasTexture(`roof-${kind}-${color}`, 256, (ctx, s) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    if (kind === "tile") {
      for (let y = 0; y < s; y += 18) {
        for (let x = -18; x < s; x += 26) {
          ctx.fillStyle = shadeHex(color, 0.85 + Math.random() * 0.35);
          ctx.beginPath();
          ctx.arc(x + ((y / 18) % 2 ? 13 : 0) + 13, y + 16, 13, Math.PI, 0);
          ctx.fill();
        }
      }
    } else if (kind === "seam") {
      for (let x = 0; x < s; x += 22) {
        ctx.fillStyle = shadeHex(color, 1.18);
        ctx.fillRect(x, 0, 3, s);
        ctx.fillStyle = shadeHex(color, 0.82);
        ctx.fillRect(x + 3, 0, 2, s);
      }
    }
    noise(ctx, s, kind === "membrane" ? 18 : 12);
  }, [4, 4]);
}

/* ------------------------------ helpers ------------------------------ */

function shadeHex(hex: string, mul: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(mul);
  return `#${c.getHexString()}`;
}

function withAlpha(hex: string, a: number) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

/* ------------------------- per-variation scheme ------------------------- */

export type FloorFinish = "wood" | "concrete" | "stone";

export interface InteriorScheme {
  floorFinish: FloorFinish;
  floorMap: THREE.Texture | null;
  floorColor: string;
  floorRoughness: number;
  wallMap: THREE.Texture | null;
  wallColor: string;
  accentWall: string;
  ceilingColor: string;
  trim: string;
  lightColor: string;
}

const WOODS: [string, string][] = [
  ["#a9784b", "#5d3a1e"],
  ["#c39a6b", "#7a5230"],
  ["#8d6440", "#4a2e18"],
  ["#b98c5e", "#6b4526"],
];

/**
 * Every variation gets its own interior finish set, derived from its seed and
 * accent colour, so no two generated homes read the same inside.
 */
export function interiorSchemeFor(seed: number, accent: string): InteriorScheme {
  const s = Math.abs(Math.floor(seed || 1));
  const finish: FloorFinish = (["wood", "wood", "stone", "concrete"] as FloorFinish[])[s % 4];
  const [wBase, wDark] = WOODS[s % WOODS.length];
  const wallTone = ["#e6ddcd", "#e2d9c9", "#e9e2d4", "#ded5c4"][s % 4];
  const accentCol = new THREE.Color(accent);
  const accentWall = `#${accentCol.clone().lerp(new THREE.Color("#3a2f26"), 0.42).getHexString()}`;
  return {
    floorFinish: finish,
    floorMap:
      finish === "wood"
        ? woodTexture(wBase, wDark, [2.2, 2.2])
        : finish === "stone"
          ? stoneTexture("#d8d2c6", [2, 2])
          : concreteTexture("#cfcac1", [1.6, 1.6]),
    floorColor: finish === "wood" ? "#ffffff" : "#ffffff",
    floorRoughness: finish === "concrete" ? 0.42 : finish === "stone" ? 0.5 : 0.55,
    wallMap: plasterTexture(wallTone, [1.6, 1.6], 12),
    // Slightly warm off-white so interiors don't blow out to pure white.
    wallColor: "#ded8cc",
    accentWall,
    ceilingColor: "#e9e4d9",
    trim: "#ddd3c2",
    lightColor: "#ffd7a3",
  };
}

