import type {
  DesignSpec,
  Direction,
  FloorPlate,
  Opening,
  RoomRect,
  RoomType,
  Variation,
  VastuPreferences,
} from "./design-types";
import { DIRECTION_ANGLES, scoreVastu, VASTU_IDEAL } from "./vastu";

// ---------- Seeded RNG ----------
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

const ACCENTS = ["#3b6db8", "#2f5a99", "#4a7fc1", "#5b8fd1", "#264e8a", "#6ea1df"];

// ---------- Architectural sizing (sq ft per room) ----------
const ROOM_AREA: Record<RoomType, { small: number; medium: number; large: number }> = {
  living: { small: 180, medium: 260, large: 360 },
  kitchen: { small: 90, medium: 130, large: 180 },
  bedroom: { small: 110, medium: 150, large: 200 },
  master_bedroom: { small: 160, medium: 220, large: 300 },
  bath: { small: 35, medium: 50, large: 70 },
  pooja: { small: 25, medium: 36, large: 48 },
  study: { small: 80, medium: 110, large: 150 },
  dining: { small: 100, medium: 140, large: 180 },
  courtyard: { small: 80, medium: 120, large: 180 },
};

const LABEL: Record<RoomType, string> = {
  living: "Living",
  kitchen: "Kitchen",
  bedroom: "Bedroom",
  master_bedroom: "Master Bed",
  bath: "Bath",
  pooja: "Pooja",
  study: "Study",
  dining: "Dining",
  courtyard: "Courtyard",
};

interface FlatRoom { type: RoomType; sizePref: "small" | "medium" | "large" }

// ---------- BSP-style room placement ----------
interface Cell { x: number; y: number; w: number; h: number }

/**
 * Split a rectangle into N cells of roughly target areas using recursive
 * binary splits along the longer axis. Produces an axis-aligned grid layout.
 */
function splitCells(
  cell: Cell,
  weights: number[],
  rng: () => number,
): Cell[] {
  if (weights.length <= 1) return [cell];
  const total = weights.reduce((a, b) => a + b, 0);

  // Choose split index roughly at half of total weight
  let acc = 0;
  let splitAt = 1;
  const target = total / 2 + (rng() - 0.5) * total * 0.15;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (acc >= target) { splitAt = Math.max(1, Math.min(weights.length - 1, i + 1)); break; }
  }
  const leftW = weights.slice(0, splitAt);
  const rightW = weights.slice(splitAt);
  const leftSum = leftW.reduce((a, b) => a + b, 0);
  const ratio = leftSum / total;

  // Split along longer axis
  let a: Cell, b: Cell;
  if (cell.w >= cell.h) {
    const split = cell.w * ratio;
    a = { x: cell.x, y: cell.y, w: split, h: cell.h };
    b = { x: cell.x + split, y: cell.y, w: cell.w - split, h: cell.h };
  } else {
    const split = cell.h * ratio;
    a = { x: cell.x, y: cell.y, w: cell.w, h: split };
    b = { x: cell.x, y: cell.y + split, w: cell.w, h: cell.h - split };
  }
  return [...splitCells(a, leftW, rng), ...splitCells(b, rightW, rng)];
}

/** Sort flat rooms so that vastu-preferred ones land in their preferred quadrant. */
function orderRoomsForQuadrants(
  rooms: FlatRoom[],
  vastu: VastuPreferences,
): { quadrant: Direction; room: FlatRoom }[] {
  // Quadrants of the plate (roughly): NE, NW, SE, SW; and edge dirs N,E,S,W absorbed.
  const dirOf = (r: FlatRoom): Direction => {
    if (r.type === "pooja" && vastu.poojaDirection) return vastu.poojaDirection;
    if (r.type === "kitchen" && vastu.kitchenDirection) return vastu.kitchenDirection;
    if (r.type === "master_bedroom" && vastu.masterBedroomDirection) return vastu.masterBedroomDirection;
    const ideal = VASTU_IDEAL[r.type];
    if (vastu.follow !== "none" && ideal && ideal.length) return ideal[0];
    const all: Direction[] = ["NE", "NW", "SE", "SW"];
    return all[Math.floor(Math.random() * 4)];
  };
  return rooms.map((r) => ({ quadrant: dirOf(r), room: r }));
}

/** Build the floor plate for one floor. */
function buildPlate(
  floorIndex: number,
  rooms: FlatRoom[],
  plotW: number,
  plotD: number,
  curvatureLevel: number,
  vastu: VastuPreferences,
  rng: () => number,
): FloorPlate {
  // Footprint: leave a 3 ft setback from plot
  const setback = 3;
  const fx = setback;
  const fy = setback;
  const fw = plotW - setback * 2;
  const fh = plotD - setback * 2;

  // Areas
  const totalArea = rooms.reduce(
    (sum, r) => sum + ROOM_AREA[r.type][r.sizePref],
    0,
  );
  // Add ~18% for circulation
  const usableFootprint = fw * fh;
  const areaScale = Math.min(1, (usableFootprint * 0.82) / Math.max(1, totalArea));

  // Group into NE / NW / SE / SW buckets based on vastu preference; rooms with
  // edge-only ideals (N,E,S,W) snap to the closest quadrant.
  const quadrantMap: Record<"NE" | "NW" | "SE" | "SW", FlatRoom[]> = {
    NE: [], NW: [], SE: [], SW: [],
  };
  const snap: Record<Direction, "NE" | "NW" | "SE" | "SW"> = {
    N: "NE", NE: "NE", E: "NE",
    S: "SW", SW: "SW", W: "SW",
    SE: "SE", NW: "NW",
  };
  for (const { quadrant, room } of orderRoomsForQuadrants(rooms, vastu)) {
    quadrantMap[snap[quadrant]].push(room);
  }

  // If a quadrant is empty, pull from the largest one to balance.
  const quadrants: ("NE" | "NW" | "SE" | "SW")[] = ["NE", "NW", "SE", "SW"];
  for (const q of quadrants) {
    if (quadrantMap[q].length === 0) {
      const donor = quadrants
        .map((k) => ({ k, n: quadrantMap[k].length }))
        .sort((a, b) => b.n - a.n)[0];
      if (donor.n > 1) {
        quadrantMap[q].push(quadrantMap[donor.k].pop()!);
      }
    }
  }

  // Map quadrants to a 2x2 grid of cells (north = top = -y direction in our coords;
  // we place +y as south, +x as east).
  const halfW = fw / 2;
  const halfH = fh / 2;
  // Slight asymmetry for variation
  const splitX = halfW * (0.85 + rng() * 0.3);
  const splitY = halfH * (0.85 + rng() * 0.3);

  const quadCells: Record<"NE" | "NW" | "SE" | "SW", Cell> = {
    NW: { x: fx, y: fy, w: splitX, h: splitY },
    NE: { x: fx + splitX, y: fy, w: fw - splitX, h: splitY },
    SW: { x: fx, y: fy + splitY, w: splitX, h: fh - splitY },
    SE: { x: fx + splitX, y: fy + splitY, w: fw - splitX, h: fh - splitY },
  };

  const placed: RoomRect[] = [];
  for (const q of quadrants) {
    const list = quadrantMap[q];
    if (list.length === 0) continue;
    const weights = list.map((r) => ROOM_AREA[r.type][r.sizePref] * areaScale);
    const cells = splitCells(quadCells[q], weights, rng);
    list.forEach((r, i) => {
      const c = cells[i] ?? cells[cells.length - 1];
      // Inset 0.5 ft for wall thickness gap
      placed.push({
        type: r.type,
        x: c.x + 0.5,
        y: c.y + 0.5,
        w: Math.max(6, c.w - 1),
        h: Math.max(6, c.h - 1),
        floor: floorIndex,
        label: LABEL[r.type],
      });
    });
  }

  // ---------- Openings: doors between adjacent rooms, windows on outer walls ----------
  const openings: Opening[] = [];
  const tol = 0.6; // ft
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i];
    // Windows on outer walls
    if (Math.abs(a.x - fx - 0.5) < tol) {
      // West wall
      openings.push({
        kind: "window", x1: a.x, y1: a.y + a.h * 0.3, x2: a.x, y2: a.y + a.h * 0.7,
        floor: floorIndex, t: 0.5, width: a.h * 0.4,
      });
    }
    if (Math.abs(a.x + a.w - (fx + fw - 0.5)) < tol) {
      openings.push({
        kind: "window", x1: a.x + a.w, y1: a.y + a.h * 0.3, x2: a.x + a.w, y2: a.y + a.h * 0.7,
        floor: floorIndex, t: 0.5, width: a.h * 0.4,
      });
    }
    if (Math.abs(a.y - fy - 0.5) < tol) {
      openings.push({
        kind: "window", x1: a.x + a.w * 0.3, y1: a.y, x2: a.x + a.w * 0.7, y2: a.y,
        floor: floorIndex, t: 0.5, width: a.w * 0.4,
      });
    }
    if (Math.abs(a.y + a.h - (fy + fh - 0.5)) < tol) {
      openings.push({
        kind: "window", x1: a.x + a.w * 0.3, y1: a.y + a.h, x2: a.x + a.w * 0.7, y2: a.y + a.h,
        floor: floorIndex, t: 0.5, width: a.w * 0.4,
      });
    }
    // Doors with neighbours (shared wall)
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j];
      // Vertical shared wall
      if (Math.abs(a.x + a.w - b.x) < tol || Math.abs(b.x + b.w - a.x) < tol) {
        const x = Math.abs(a.x + a.w - b.x) < tol ? a.x + a.w : a.x;
        const y0 = Math.max(a.y, b.y);
        const y1 = Math.min(a.y + a.h, b.y + b.h);
        if (y1 - y0 > 3) {
          const mid = (y0 + y1) / 2;
          openings.push({
            kind: "door", x1: x, y1: mid - 1.5, x2: x, y2: mid + 1.5,
            floor: floorIndex, t: 0.5, width: 3,
          });
        }
      }
      // Horizontal shared wall
      if (Math.abs(a.y + a.h - b.y) < tol || Math.abs(b.y + b.h - a.y) < tol) {
        const y = Math.abs(a.y + a.h - b.y) < tol ? a.y + a.h : a.y;
        const x0 = Math.max(a.x, b.x);
        const x1 = Math.min(a.x + a.w, b.x + b.w);
        if (x1 - x0 > 3) {
          const mid = (x0 + x1) / 2;
          openings.push({
            kind: "door", x1: mid - 1.5, y1: y, x2: mid + 1.5, y2: y,
            floor: floorIndex, t: 0.5, width: 3,
          });
        }
      }
    }
  }

  // Curvature is now ALWAYS at maximum for every variation — corners are
  // strongly rounded so corner rooms read as curved.
  const minSide = Math.min(fw, fh);
  const cornerRadius = minSide * (0.20 + 0.04 * curvatureLevel);

  return {
    floor: floorIndex,
    x: fx, y: fy, w: fw, h: fh,
    cornerRadius,
    chamfer: 0,
    rooms: placed,
    openings,
  };
}

export function generateVariations(
  spec: DesignSpec,
  vastu: VastuPreferences,
  count = 10,
): Variation[] {
  const variations: Variation[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);

  // Per-floor room distribution.
  // - If spec.roomsPerFloor is provided, use it directly (customer-driven).
  // - Otherwise, fall back to auto-distribution from spec.rooms.
  const perFloor: FlatRoom[][] = [];
  if (spec.roomsPerFloor && spec.roomsPerFloor.length > 0) {
    for (let f = 0; f < spec.floors; f++) {
      const list: FlatRoom[] = [];
      const src = spec.roomsPerFloor[f] ?? [];
      for (const r of src) {
        for (let k = 0; k < r.count; k++) list.push({ type: r.type, sizePref: r.sizePref });
      }
      perFloor.push(list);
    }
  } else {
    const flat: FlatRoom[] = [];
    for (const r of spec.rooms) {
      for (let k = 0; k < r.count; k++) flat.push({ type: r.type, sizePref: r.sizePref });
    }
    const groundFirst: RoomType[] = ["living", "kitchen", "dining", "pooja", "courtyard"];
    flat.sort((a, b) => {
      const ai = groundFirst.indexOf(a.type);
      const bi = groundFirst.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    for (let f = 0; f < spec.floors; f++) perFloor.push([]);
    let cursor = 0;
    for (const r of flat) {
      const floor = groundFirst.includes(r.type) ? 0 : cursor++ % spec.floors;
      perFloor[floor].push(r);
    }
  }

  for (let i = 0; i < count; i++) {
    const seed = baseSeed + i * 1009;
    const rng = mulberry32(seed);

    const baseCurv =
      spec.curvature === "gentle" ? 0.25 : spec.curvature === "bold" ? 0.8 : 0.5;
    const curvatureLevel = Math.max(0.1, Math.min(1, baseCurv + (rng() - 0.5) * 0.25));

    const plates: FloorPlate[] = [];
    for (let f = 0; f < spec.floors; f++) {
      const list = perFloor[f].length > 0
        ? perFloor[f]
        : [{ type: "bedroom", sizePref: "medium" } as FlatRoom];
      plates.push(
        buildPlate(f + 1, list, spec.plot.widthFt, spec.plot.depthFt, curvatureLevel, vastu, rng),
      );
    }

    const entranceDir: Direction = vastu.entranceDirection ?? spec.plot.facing;
    const entranceAngleDeg = DIRECTION_ANGLES[entranceDir];

    // Score on floor 1 rooms
    const allRooms = plates.flatMap((p) => p.rooms);
    const center = {
      x: plates[0].x + plates[0].w / 2,
      y: plates[0].y + plates[0].h / 2,
    };
    const vastuResult = scoreVastu(allRooms, vastu, entranceDir, center);

    variations.push({
      id: `var-${seed}`,
      seed,
      curvatureLevel,
      plates,
      plotWidthFt: spec.plot.widthFt,
      plotDepthFt: spec.plot.depthFt,
      entranceDirection: entranceDir,
      entranceAngleDeg,
      vastuScore: vastuResult.score,
      vastuTier: vastuResult.tier,
      roofType: spec.roofStyle,
      paletteAccent: ACCENTS[i % ACCENTS.length],
    });
  }

  variations.sort((a, b) => b.vastuScore - a.vastuScore);
  return variations;
}
