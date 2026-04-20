import type { DesignSpec, RoomLayout, Variation, VastuPreferences, RoomType, Direction } from "./design-types";
import { DIRECTION_ANGLES, VASTU_IDEAL, scoreVastu } from "./vastu";

// Seeded RNG (mulberry32)
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ACCENTS = ["#b8693a", "#7a8a64", "#6f86a8", "#a87a6f", "#8a7a64", "#5e7a7a"];

function dirToCenter(dir: Direction, radius = 0.32): { cx: number; cy: number } {
  const angleDeg = DIRECTION_ANGLES[dir];
  const rad = (angleDeg * Math.PI) / 180;
  return {
    cx: 0.5 + Math.sin(rad) * radius,
    cy: 0.5 - Math.cos(rad) * radius,
  };
}

function pickPreferredDir(
  type: RoomType,
  prefs: VastuPreferences,
  rng: () => number,
): Direction {
  // User explicit prefs override
  if (type === "pooja" && prefs.poojaDirection) return prefs.poojaDirection;
  if (type === "kitchen" && prefs.kitchenDirection) return prefs.kitchenDirection;
  if (type === "master_bedroom" && prefs.masterBedroomDirection) return prefs.masterBedroomDirection;

  const ideal = VASTU_IDEAL[type];
  if (!ideal) {
    const dirs: Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.floor(rng() * 8)];
  }

  if (prefs.follow === "strict") return ideal[0];
  if (prefs.follow === "flexible") return ideal[Math.floor(rng() * ideal.length)];

  const dirs: Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.floor(rng() * 8)];
}

function generateFloorOutline(
  curvature: number,
  rng: () => number,
): { x: number; y: number }[] {
  // Generate 8 control points around the perimeter, perturbed.
  const pts: { x: number; y: number }[] = [];
  const segments = 24;
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const wobble = curvature * (0.06 + rng() * 0.05) * Math.sin(t * (2 + Math.floor(rng() * 3)));
    const r = 0.42 + wobble;
    pts.push({
      x: 0.5 + Math.cos(t) * r,
      y: 0.5 + Math.sin(t) * r * 0.8,
    });
  }
  return pts;
}

export function generateVariations(
  spec: DesignSpec,
  vastu: VastuPreferences,
  count = 10,
): Variation[] {
  const variations: Variation[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);

  for (let i = 0; i < count; i++) {
    const seed = baseSeed + i * 1009;
    const rng = mulberry32(seed);

    // Curvature: vary across batch
    const baseCurvature =
      spec.curvature === "gentle" ? 0.25 : spec.curvature === "bold" ? 0.75 : 0.5;
    const curvatureLevel = Math.max(0.1, Math.min(1, baseCurvature + (rng() - 0.5) * 0.3));

    // Layout rooms across floors
    const rooms: RoomLayout[] = [];
    const floorRooms: Record<number, { type: RoomType; sizePref: "small" | "medium" | "large" }[]> =
      {};
    for (let f = 1; f <= spec.floors; f++) floorRooms[f] = [];

    const flatRooms: { type: RoomType; sizePref: "small" | "medium" | "large" }[] = [];
    for (const r of spec.rooms) {
      for (let k = 0; k < r.count; k++) flatRooms.push({ type: r.type, sizePref: r.sizePref });
    }
    // Distribute round-robin across floors (essential rooms on floor 1)
    const essentialOrder: RoomType[] = ["living", "kitchen", "pooja", "dining", "courtyard"];
    flatRooms.sort((a, b) => {
      const ai = essentialOrder.indexOf(a.type);
      const bi = essentialOrder.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    let cursor = 0;
    for (const r of flatRooms) {
      const f = essentialOrder.includes(r.type) ? 1 : (cursor % spec.floors) + 1;
      floorRooms[f].push(r);
      cursor++;
    }

    for (let f = 1; f <= spec.floors; f++) {
      const list = floorRooms[f];
      const radius = 0.28 + rng() * 0.06;
      list.forEach((r, idx) => {
        const preferredDir = pickPreferredDir(r.type, vastu, rng);
        // Add slight angular jitter per variation
        const jitter = (rng() - 0.5) * 25;
        const angleDeg = DIRECTION_ANGLES[preferredDir] + jitter + idx * 5;
        const rad = (angleDeg * Math.PI) / 180;
        const cx = 0.5 + Math.sin(rad) * radius;
        const cy = 0.5 - Math.cos(rad) * radius;
        const sizeMap = { small: 0.08, medium: 0.11, large: 0.14 };
        const baseSize = sizeMap[r.sizePref];
        rooms.push({
          type: r.type,
          cx,
          cy,
          rx: baseSize + rng() * 0.02,
          ry: baseSize * (0.85 + rng() * 0.3),
          rotationDeg: rng() * 360,
          floor: f,
          curveBias: curvatureLevel,
        });
      });
    }

    // Entrance direction: respect plot facing + vastu pref
    const entranceDir: Direction = vastu.entranceDirection ?? spec.plot.facing;
    const entranceAngleDeg = DIRECTION_ANGLES[entranceDir] + (rng() - 0.5) * 10;

    const vastuResult = scoreVastu(rooms, vastu, entranceDir);

    const floorOutlines = [];
    for (let f = 1; f <= spec.floors; f++) {
      floorOutlines.push({ floor: f, points: generateFloorOutline(curvatureLevel, rng) });
    }

    variations.push({
      id: `var-${seed}`,
      seed,
      curvatureLevel,
      rooms,
      entranceAngleDeg,
      vastuScore: vastuResult.score,
      vastuTier: vastuResult.tier,
      floorOutlines,
      roofType: spec.roofStyle,
      paletteAccent: ACCENTS[i % ACCENTS.length],
    });
  }

  // Sort: highest vastu first
  variations.sort((a, b) => b.vastuScore - a.vastuScore);
  return variations;
}
