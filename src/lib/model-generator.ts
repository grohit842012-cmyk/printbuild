import type {
  DesignSpec,
  Direction,
  ElevationStyle,
  FloorPlate,
  Liveability,
  Opening,
  ParkingArea,
  RoomRect,
  RoomType,
  Variation,
  VastuPreferences,
} from "./design-types";
import { DIRECTION_ANGLES, scoreVastu } from "./vastu";
import { generateDnaSet } from "./design-dna";

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

// Distinct exterior accents — one per variation so every elevation reads
// as its own house with its own face & colour, not a recoloured clone.
const ACCENTS = [
  "#264e8a", // deep navy
  "#a83e1a", // terracotta
  "#3b6db8", // azure
  "#4f6b3a", // olive
  "#7a3a5a", // plum
  "#b07a3a", // amber
  "#2f5a99", // ocean
  "#5b3a2a", // cocoa
  "#3a6b6b", // teal
  "#8a4a3a", // brick
];

const ELEVATION_STYLES: ElevationStyle[] = [
  "modern-minimal",
  "mediterranean-arch",
  "contemporary-box",
  "tropical-veranda",
  "art-deco",
  "scandi-pitched",
];

// ---------- Plan type catalogue (Rule Book v2.0 §Non-Box Geometry) ----------
// The system picks the best plan shape given plot size, room count and
// lifestyle. Each shape is realised in the existing FloorPlate via
// cornerRadius + chamfer, since the room solver already honours both.
export type PlanType = "compact-box" | "wide-box" | "l-shape" | "u-shape" | "courtyard";

type MassingStyle = NonNullable<Variation["massingStyle"]>;

const MASSING_STYLES: MassingStyle[] = [
  "butterfly-pavilion",
  "folded-butterfly",
  "terrace-pavilion",
  "courtyard-cut",
  "cantilever-front",
  "stepped-terrace",
  "side-veranda",
  "mono-slope-courtyard",
  "gabled-house",
  "jaali-court",
  "split-block",
];

const CHAMFER_CORNERS: NonNullable<FloorPlate["chamferCorner"]>[] = ["NE", "NW", "SE", "SW"];

interface FootprintInset {
  west: number;
  east: number;
  north: number;
  south: number;
}

const ZERO_INSET: FootprintInset = { west: 0, east: 0, north: 0, south: 0 };

function footprintForMassing(
  massing: MassingStyle,
  floorIndex: number,
  totalFloors: number,
  maxInset: number,
  rng: () => number,
): FootprintInset {
  if (maxInset <= 0.25) return ZERO_INSET;
  const topBias = totalFloors <= 1 ? 0 : floorIndex / Math.max(1, totalFloors - 1);
  const a = maxInset * (0.65 + rng() * 0.35);
  const b = maxInset * (0.35 + rng() * 0.3);
  switch (massing) {
    case "cantilever-front":
      return topBias > 0 ? { west: b, east: 0, north: 0, south: b } : { west: 0, east: b, north: a, south: 0 };
    case "stepped-terrace":
      return { west: b * topBias, east: a * topBias, north: b * topBias, south: a * topBias };
    case "side-veranda":
      return { west: a, east: 0, north: b, south: 0 };
    case "tower-wing":
      return topBias > 0.4 ? { west: a, east: b, north: 0, south: b } : { west: 0, east: b, north: 0, south: 0 };
    case "split-block":
      return floorIndex % 2 === 0 ? { west: a, east: 0, north: b, south: 0 } : { west: 0, east: a, north: 0, south: b };
    case "pergola-terrace":
      return topBias > 0 ? { west: b, east: b, north: 0, south: a * topBias } : ZERO_INSET;
    case "courtyard-cut":
    case "jaali-court":
      return { west: b, east: b, north: b, south: b };
    case "butterfly-pavilion":
    case "folded-butterfly":
    case "mono-slope-courtyard":
    case "terrace-pavilion":
      return { west: b, east: b, north: 0, south: 0 };
    case "gabled-house":
    default:
      return { west: 0, east: 0, north: b, south: b };
  }
}

function ensureVerticalCoreInsideUpperPlates(
  plates: FloorPlate[],
  plotW: number,
  plotD: number,
): FloorPlate[] {
  if (plates.length <= 1) return plates;
  const coreRooms = plates[0].rooms.filter((r) => r.type === "stairs" || r.type === "lift");
  if (coreRooms.length === 0) return plates;

  for (let i = 1; i < plates.length; i++) {
    let p = plates[i];
    let minX = p.x;
    let minY = p.y;
    let maxX = p.x + p.w;
    let maxY = p.y + p.h;
    let changed = false;

    for (const r of coreRooms) {
      const pad = 1;
      const rx1 = r.x - pad;
      const ry1 = r.y - pad;
      const rx2 = r.x + r.w + pad;
      const ry2 = r.y + r.h + pad;
      if (rx1 < minX || ry1 < minY || rx2 > maxX || ry2 > maxY) changed = true;
      minX = Math.min(minX, rx1);
      minY = Math.min(minY, ry1);
      maxX = Math.max(maxX, rx2);
      maxY = Math.max(maxY, ry2);
    }

    if (changed) {
      minX = Math.max(SETBACK, minX);
      minY = Math.max(SETBACK, minY);
      maxX = Math.min(plotW - SETBACK, maxX);
      maxY = Math.min(plotD - SETBACK, maxY);
      p = { ...p, x: minX, y: minY, w: Math.max(8, maxX - minX), h: Math.max(8, maxY - minY) };
      plates[i] = rebuildInteriorOpenings(p);
    }
  }
  return plates;
}

/** Structural sanity: no floor may hang off the floor below by more than a
 * plausible cantilever. Each upper plate is clamped into the plate beneath it
 * (plus a small cantilever allowance), and its rooms are clamped with it so
 * nothing pokes outside the walls. Rooms that get crushed are dropped. */
const MAX_CANTILEVER = 2.5; // ft of allowed overhang on any side

function supportUpperPlates(plates: FloorPlate[]): FloorPlate[] {
  if (plates.length <= 1) return plates;
  for (let i = 1; i < plates.length; i++) {
    const below = plates[i - 1];
    const p = plates[i];
    const minX = below.x - MAX_CANTILEVER;
    const minY = below.y - MAX_CANTILEVER;
    const maxX = below.x + below.w + MAX_CANTILEVER;
    const maxY = below.y + below.h + MAX_CANTILEVER;

    const nx = Math.max(p.x, minX);
    const ny = Math.max(p.y, minY);
    const nx2 = Math.min(p.x + p.w, maxX);
    const ny2 = Math.min(p.y + p.h, maxY);
    const nw = nx2 - nx;
    const nh = ny2 - ny;
    if (nw < 8 || nh < 8) continue;
    if (Math.abs(nx - p.x) < 0.05 && Math.abs(ny - p.y) < 0.05 && Math.abs(nw - p.w) < 0.05 && Math.abs(nh - p.h) < 0.05) {
      continue;
    }

    const rooms = plates[i].rooms
      .map((r) => {
        const rx = Math.max(r.x, nx);
        const ry = Math.max(r.y, ny);
        const rx2 = Math.min(r.x + r.w, nx2);
        const ry2 = Math.min(r.y + r.h, ny2);
        return { ...r, x: rx, y: ry, w: rx2 - rx, h: ry2 - ry };
      })
      .filter((r) => r.type === "stairs" || r.type === "lift" ? r.w > 2 && r.h > 2 : r.w >= 5 && r.h >= 5);

    let hallway = plates[i].hallway;
    if (hallway) {
      const hx = Math.max(hallway.x, nx);
      const hy = Math.max(hallway.y, ny);
      const hx2 = Math.min(hallway.x + hallway.w, nx2);
      const hy2 = Math.min(hallway.y + hallway.h, ny2);
      hallway = hx2 - hx > 1 && hy2 - hy > 1 ? { x: hx, y: hy, w: hx2 - hx, h: hy2 - hy } : undefined;
    }

    plates[i] = rebuildInteriorOpenings({ ...plates[i], x: nx, y: ny, w: nw, h: nh, rooms, hallway });
  }
  return plates;
}



/** Pick the plan family that fits the user's program & plot best.
 *
 * Non-box shapes (L, U, courtyard) carve a notch out of the NE corner of the
 * plate (that is how `FloorPlate.chamfer` is realised in 2D & 3D). The open
 * arm of the L therefore points NE — and the entrance must read into that
 * open arm for the silhouette to make architectural sense. So we only allow
 * a non-box plan when the user's chosen entrance/facing direction is on the
 * N, NE, or E side of the plot. For S/W/SW/SE/NW facings we fall back to a
 * box plan so the entrance never lands on the closed back of the L.
 */
export function pickPlanType(
  spec: DesignSpec,
  entranceDir?: Direction,
): PlanType {
  const area = spec.plot.widthFt * spec.plot.depthFt;
  const aspect = Math.max(spec.plot.widthFt, spec.plot.depthFt) /
    Math.max(1, Math.min(spec.plot.widthFt, spec.plot.depthFt));
  const wantsCourtyard = spec.rooms.some((r) => r.type === "courtyard");
  const bedrooms = spec.rooms
    .filter((r) => r.type === "bedroom" || r.type === "master_bedroom")
    .reduce((a, b) => a + b.count, 0);
  const dir = entranceDir ?? spec.plot.facing;
  const notchAligned = dir === "N" || dir === "NE" || dir === "E";
  // Courtyard is symmetric — allowed regardless of entrance side.
  if (wantsCourtyard && area >= 1800) return "courtyard";
  if (notchAligned && area >= 2800 && bedrooms >= 4) return "u-shape";
  if (notchAligned && area >= 1600 && aspect <= 1.4) return "l-shape";
  if (aspect > 1.4) return "wide-box";
  return "compact-box";
}

/** Pick the most space-efficient staircase given the available side band. */
export function pickStaircase(
  spec: DesignSpec,
  sideWidthFt: number,
): NonNullable<DesignSpec["staircaseType"]> {
  if (spec.staircaseType) return spec.staircaseType;
  // U-shape is the most compact for vertical travel and reads as a real
  // residential stair. Use it when there's room. L when band is medium.
  // Straight for narrow bands. Spiral only as a last resort (skipped if lift).
  if (sideWidthFt >= 9) return "u-shape";
  if (sideWidthFt >= 7) return "l-shape";
  if (sideWidthFt >= 4.5) return "straight";
  return spec.lift === "home" ? "straight" : "spiral";
}

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
  stairs: "Stairs",
  lift: "Lift",
  utility: "Utility",
  parking: "Parking",
};

// ---------- Room size preferences (PrintBuild Room Size Preference Rule Book) ----------
// Users select Small / Medium / Large per room. The generator targets the
// selected dimensions and never shrinks a room below its selected category —
// if it doesn't fit, the user is notified instead.
export type SizePref = "small" | "medium" | "large";

export const ROOM_DIMS_BY_PREF: Record<RoomType, Record<SizePref, { w: number; h: number }>> = {
  // Living Room / Hall
  living:         { small: { w: 10, h: 12 }, medium: { w: 12, h: 18 }, large: { w: 15, h: 20 } },
  master_bedroom: { small: { w: 10, h: 12 }, medium: { w: 12, h: 14 }, large: { w: 14, h: 16 } },
  bedroom:        { small: { w: 10, h: 10 }, medium: { w: 10, h: 12 }, large: { w: 12, h: 12 } },
  kitchen:        { small: { w: 8,  h: 10 }, medium: { w: 10, h: 10 }, large: { w: 10, h: 12 } },
  dining:         { small: { w: 10, h: 10 }, medium: { w: 10, h: 12 }, large: { w: 12, h: 14 } },
  // Bath covers both common and attached bathrooms.
  bath:           { small: { w: 5,  h: 7  }, medium: { w: 6,  h: 8  }, large: { w: 8,  h: 10 } },
  // Pooja: never oversize on constrained plots.
  pooja:          { small: { w: 3,  h: 4  }, medium: { w: 4,  h: 5  }, large: { w: 5,  h: 7  } },
  study:          { small: { w: 8,  h: 10 }, medium: { w: 10, h: 10 }, large: { w: 10, h: 12 } },
  utility:        { small: { w: 4,  h: 6  }, medium: { w: 6,  h: 8  }, large: { w: 8,  h: 10 } },
  courtyard:      { small: { w: 8,  h: 8  }, medium: { w: 10, h: 10 }, large: { w: 12, h: 12 } },
  // Circulation — sized by staircase shape elsewhere; these are the floor.
  stairs:         { small: { w: 4,  h: 8  }, medium: { w: 4.5,h: 9  }, large: { w: 5,  h: 10 } },
  lift:           { small: { w: 4,  h: 4  }, medium: { w: 4,  h: 4  }, large: { w: 4,  h: 4  } },
  // Parking: Small = single car (10×18), Medium = large single car (10×20), Large = two cars (18×20).
  parking:        { small: { w: 10, h: 18 }, medium: { w: 10, h: 20 }, large: { w: 18, h: 20 } },
};

/** Target dims for a room given its user-selected size preference. */
export function dimsFor(type: RoomType, pref: SizePref): { w: number; h: number } {
  return ROOM_DIMS_BY_PREF[type][pref];
}

/**
 * Absolute floor for a room — the smallest acceptable footprint.
 * Per the Room Size Preference Rule Book, we never shrink below the user's
 * selected category. This map represents the "small" tier as the global floor
 * for callers that don't know the user's pref (legacy parking/stair sizing).
 */
export const MIN_ROOM_DIMS: Record<RoomType, { w: number; h: number }> = Object.fromEntries(
  (Object.keys(ROOM_DIMS_BY_PREF) as RoomType[]).map((t) => [t, ROOM_DIMS_BY_PREF[t].small]),
) as Record<RoomType, { w: number; h: number }>;

interface FlatRoom {
  type: RoomType;
  sizePref: "small" | "medium" | "large";
}

// Rule Book v2.0: corridor minimum 4.5 ft, preferred 5 ft.
const HALLWAY_WIDTH = 5;

const SETBACK = 3;

// Rule Book v2.0 — Parking Validation. Realistic bay sizes (ft).
export const PARKING_DIMS = {
  car: { w: 10, h: 18 },
  suv: { w: 11, h: 20 },
  two: { w: 20, h: 18 }, // two cars side by side
} as const;

function parkingFootprint(
  parking: DesignSpec["parking"] | undefined,
): { w: number; h: number } | null {
  if (!parking || parking.count === 0) return null;
  if (parking.count === 2) return PARKING_DIMS.two;
  return parking.vehicle === "suv" ? PARKING_DIMS.suv : PARKING_DIMS.car;
}


/** Footprint dims by staircase shape (in ft), oriented along corridor (h) × wide (w). */
function stairDims(type: DesignSpec["staircaseType"]): { w: number; h: number } {
  switch (type) {
    case "spiral": return { w: 6, h: 6 };
    case "u-shape": return { w: 8, h: 10 };
    case "l-shape": return { w: 7, h: 9 };
    case "straight":
    default: return { w: 4, h: 12 };
  }
}

// ---------- Plot validation ----------
export interface PlotValidationIssue {
  floor: number;
  message: string;
}

/**
 * Check whether the requested rooms can fit on the plot at minimum dimensions.
 * Conservative: sums area incl. hallway + setbacks, and checks the smallest
 * single room dimension against plate dims.
 */
export function validatePlotFit(spec: DesignSpec): PlotValidationIssue[] {
  const issues: PlotValidationIssue[] = [];
  const fw = spec.plot.widthFt - SETBACK * 2;
  const fh = spec.plot.depthFt - SETBACK * 2;
  if (fw < 22 || fh < 26) {
    issues.push({
      floor: 0,
      message: `Plot is too small (${spec.plot.widthFt}×${spec.plot.depthFt} ft). PrintBuild needs at least 28×32 ft to fit small-tier rooms with circulation.`,
    });
    return issues;
  }

  const perFloor = spec.roomsPerFloor ?? [];
  for (let f = 0; f < spec.floors; f++) {
    const rooms = perFloor[f] ?? [];
    let needed = 0;
    for (const r of rooms) {
      const m = dimsFor(r.type, r.sizePref);
      needed += m.w * m.h * r.count;
    }
    // hallway area estimate
    const hallway = HALLWAY_WIDTH * fh;
    const usable = fw * fh - hallway;
    if (needed > usable) {
      issues.push({
        floor: f + 1,
        message: `Floor ${f + 1}: rooms at selected sizes need ${Math.ceil(needed)} sqft but plot only fits ${Math.floor(usable)} sqft after hallway. Pick a smaller size for one or more rooms, drop a room, or use a larger plot.`,
      });
    }
    // Largest single room must fit between hallway and outer wall
    const sideZone = (fw - HALLWAY_WIDTH) / 2;
    for (const r of rooms) {
      if (r.count <= 0) continue;
      const m = dimsFor(r.type, r.sizePref);
      const minSide = Math.min(m.w, m.h);
      if (minSide > sideZone) {
        issues.push({
          floor: f + 1,
          message: `Floor ${f + 1}: ${LABEL[r.type]} (${r.sizePref}) needs ${minSide} ft but only ${Math.floor(sideZone)} ft available beside hallway. Pick a smaller size or widen the plot.`,
        });
      }
    }
  }

  // ---- Parking feasibility (Rule Book v2.0) ----
  const fp = parkingFootprint(spec.parking);
  if (fp && spec.parking?.location === "inside" && !spec.stiltParking) {
    // Parking must fit in the setback band beside the building (we use the
    // front band by entrance, depth = SETBACK + a 5 ft clearance for door swing
    // and turning). If the building consumes the full plot minus setbacks, the
    // available band is just SETBACK ft deep — not enough for an 18 ft bay.
    const wall = pickEntranceWall(spec.plot.facing);
    const bandDepth = SETBACK; // setback strip between plate and plot edge
    const bayDepth = wall === "N" || wall === "S" ? fp.h : fp.w;
    const bayWidth = wall === "N" || wall === "S" ? fp.w : fp.h;
    const bandWidth = wall === "N" || wall === "S" ? spec.plot.widthFt : spec.plot.depthFt;
    if (bandDepth < bayDepth || bandWidth < bayWidth + 4) {
      const label =
        spec.parking!.count === 2
          ? "2-car parking (20×18 ft)"
          : spec.parking!.vehicle === "suv"
            ? "SUV parking (11×20 ft)"
            : "1-car parking (10×18 ft)";
      issues.push({
        floor: 0,
        message:
          `Plot can't fit ${label} inside without overlapping the house. ` +
          `Try: enable stilt parking, move parking outside the plot, reduce to 1 car, ` +
          `or enlarge the plot.`,
      });
    }
  }

  return issues;
}


// ---------- Helpers ----------
function pickEntranceWall(dir: Direction): "N" | "E" | "S" | "W" {
  // Map 8-way to 4-way wall (which wall the front door cuts through)
  if (dir === "N" || dir === "NE" || dir === "NW") return "N";
  if (dir === "S" || dir === "SE" || dir === "SW") return "S";
  if (dir === "E") return "E";
  if (dir === "W") return "W";
  return "E";
}

interface PlacedZone {
  type: RoomType;
  sizePref: "small" | "medium" | "large";
  // Zone slot: which side of hallway, and order along the corridor
  side: "left" | "right";
  order: number; // 0 = closest to entrance
  isEnsuiteOf?: number; // index of master bedroom in placed list
}

type HallSide = "left" | "right";

/**
 * Plan a residential floor:
 *   - hallway runs from front wall to back wall
 *   - rooms hang off either side of hallway in zones (public near entrance,
 *     private at the back)
 *   - bathrooms cluster on plumbing wall
 */
function planFloor(
  rooms: FlatRoom[],
  entranceWall: "N" | "E" | "S" | "W",
  rng: () => number,
  stairSide: HallSide,
): PlacedZone[] {
  // Public zone (priority front): living, dining, kitchen, pooja
  // Private zone (priority back): bedrooms, master_bedroom, study
  // Service: stairs (mid), baths (clustered, near bedrooms or kitchen wall)
  const PUBLIC: RoomType[] = ["living", "dining", "kitchen", "pooja", "courtyard"];
  const PRIVATE: RoomType[] = ["master_bedroom", "bedroom", "study"];

  // We always think in "hallway runs from front to back, with left/right sides".
  // Rotation back to actual entranceWall happens at the placement step.
  const list = [...rooms];

  // Pull out one master bedroom and one bathroom to be ensuite if both exist.
  const masterIdx = list.findIndex((r) => r.type === "master_bedroom");
  const bathIdx = list.findIndex((r) => r.type === "bath");
  let ensuiteBath: FlatRoom | null = null;
  if (masterIdx >= 0 && bathIdx >= 0) {
    ensuiteBath = list.splice(bathIdx, 1)[0];
  }

  // Pull out stairs to place mid-corridor.
  const stairsIdx = list.findIndex((r) => r.type === "stairs");
  const stairs = stairsIdx >= 0 ? list.splice(stairsIdx, 1)[0] : null;

  // Sort: public items first, then private. Within each, larger area first.
  const sortKey = (r: FlatRoom) => {
    const m = dimsFor(r.type, r.sizePref);
    return -(m.w * m.h);
  };
  const varyOrder = (a: FlatRoom, b: FlatRoom) => {
    const primary = sortKey(a) - sortKey(b);
    return Math.abs(primary) > 24 ? primary : rng() - 0.5;
  };
  const publicRooms = list.filter((r) => PUBLIC.includes(r.type)).sort(varyOrder);
  const privateRooms = list.filter((r) => PRIVATE.includes(r.type)).sort(varyOrder);
  const baths = list.filter((r) => r.type === "bath").sort(() => rng() - 0.5);
  const others = list.filter(
    (r) =>
      !PUBLIC.includes(r.type) &&
      !PRIVATE.includes(r.type) &&
      r.type !== "bath" &&
      r.type !== "stairs" &&
      r.type !== "lift", // lift is placed beside stair, not as its own zone
  );

  // Order along the corridor (front → back):
  // [public left/right alternating] → [stairs centred] → [bath cluster] → [private left/right alternating]
  const order: PlacedZone[] = [];
  let leftCount = 0;
  let rightCount = 0;
  const pushTo = (r: FlatRoom, side: HallSide) => {
    const orderIndex = side === "left" ? leftCount : rightCount;
    order.push({ type: r.type, sizePref: r.sizePref, side, order: orderIndex });
    if (side === "left") leftCount++;
    else rightCount++;
  };
  const pushAlt = (r: FlatRoom) => {
    const side: HallSide = leftCount === rightCount
      ? (rng() < 0.5 ? "left" : "right")
      : leftCount < rightCount ? "left" : "right";
    pushTo(r, side);
  };
  if (stairs) pushTo(stairs, stairSide);
  // Kitchen and dining must be adjacent (same side of the corridor, back to
  // back) so serving food isn't a trek across the house.
  const kIdx = publicRooms.findIndex((r) => r.type === "kitchen");
  const dIdx = publicRooms.findIndex((r) => r.type === "dining");
  if (kIdx >= 0 && dIdx >= 0 && Math.abs(kIdx - dIdx) > 1) {
    const [dining] = publicRooms.splice(dIdx, 1);
    publicRooms.splice(publicRooms.findIndex((r) => r.type === "kitchen") + 1, 0, dining);
  }
  for (let pi = 0; pi < publicRooms.length; pi++) {
    const r = publicRooms[pi];
    const prev = publicRooms[pi - 1];
    // Dining follows the kitchen onto the SAME side of the corridor.
    if (r.type === "dining" && prev?.type === "kitchen") {
      pushTo(r, order[order.length - 1].side);
    } else if (r.type === "kitchen" && publicRooms[pi + 1]?.type === "dining") {
      pushAlt(r);
    } else {
      pushAlt(r);
    }
  }

  // Cluster bathrooms (skip ensuite, handled with master)
  for (const r of baths) pushAlt(r);
  for (const r of privateRooms) pushAlt(r);
  // Mark ensuite next to its master
  if (ensuiteBath) {
    const masterPlaceIdx = order.findIndex((o) => o.type === "master_bedroom");
    if (masterPlaceIdx >= 0) {
      const masterSide = order[masterPlaceIdx].side;
      // Place bath on same side, immediately after master in the order
      order.splice(masterPlaceIdx + 1, 0, {
        type: "bath",
        sizePref: ensuiteBath.sizePref,
        side: masterSide,
        order: order[masterPlaceIdx].order + 0.5,
        isEnsuiteOf: masterPlaceIdx,
      });
    } else {
      // No master, just append
      pushAlt(ensuiteBath);
    }
  }
  for (const r of others) pushAlt(r);

  const rebalanceStairOnlySide = () => {
    const leftRooms = order.filter((o) => o.side === "left");
    const rightRooms = order.filter((o) => o.side === "right");
    if (leftRooms.length === 1 && leftRooms[0].type === "stairs" && rightRooms.length > 1) {
      const move = rightRooms.find((o) => o.type !== "stairs");
      if (move) move.side = "left";
    } else if (rightRooms.length === 1 && rightRooms[0].type === "stairs" && leftRooms.length > 1) {
      const move = leftRooms.find((o) => o.type !== "stairs");
      if (move) move.side = "right";
    }
  };
  rebalanceStairOnlySide();

  // Re-number order positions
  const left = order.filter((o) => o.side === "left").sort((a, b) => a.order - b.order);
  const right = order.filter((o) => o.side === "right").sort((a, b) => a.order - b.order);
  left.forEach((o, i) => (o.order = i));
  right.forEach((o, i) => (o.order = i));

  return [...left, ...right];
}

/**
 * Daylight-driven glazing.
 * Windows are sized by what the room is FOR and which way the wall faces
 * (northern-hemisphere sun): south/east walls get generous glazing, north gets
 * soft even light, west is restrained to keep afternoon heat out. Living rooms
 * and master bedrooms get wide (or split twin) openings; wet/service rooms get
 * a small high vent instead of nothing.
 */
function pushWindows(
  openings: Opening[],
  r: RoomRect,
  ri: number,
  floor: number,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
) {
  const service = ["stairs", "lift", "parking", "courtyard"].includes(r.type);
  if (service) return;
  const wet = ["bath", "utility", "pooja"].includes(r.type);

  const tol = 0.6;
  type ExtWall = { wall: "N" | "E" | "S" | "W"; len: number };
  const ext: ExtWall[] = [];
  if (Math.abs(r.x - fx) < tol) ext.push({ wall: "W", len: r.h });
  if (Math.abs(r.x + r.w - (fx + fw)) < tol) ext.push({ wall: "E", len: r.h });
  if (Math.abs(r.y - fy) < tol) ext.push({ wall: "N", len: r.w });
  if (Math.abs(r.y + r.h - (fy + fh)) < tol) ext.push({ wall: "S", len: r.w });
  if (ext.length === 0) return;

  // Solar desirability of each orientation.
  const solar: Record<"N" | "E" | "S" | "W", number> = { S: 1.0, E: 0.9, N: 0.75, W: 0.5 };
  ext.sort((a, b) => solar[b.wall] * b.len - solar[a.wall] * a.len);

  // How much of the wall becomes glass, by room purpose.
  const base =
    r.type === "living" ? 0.62 :
    r.type === "master_bedroom" ? 0.55 :
    r.type === "dining" ? 0.5 :
    r.type === "bedroom" || r.type === "study" ? 0.48 :
    r.type === "kitchen" ? 0.42 : 0.22;

  // Wet rooms: single small high vent on the best wall only.
  const walls = wet ? ext.slice(0, 1) : ext.slice(0, 2);

  walls.forEach((e, idx) => {
    const primary = idx === 0;
    let frac = base * solar[e.wall];
    if (!primary) frac *= 0.7;
    if (e.wall === "W" && !wet) frac = Math.min(frac, 0.32); // heat control
    const minW = wet ? 1.8 : 3;
    const maxW = wet ? 2.5 : 9;
    let span = Math.max(minW, Math.min(maxW, e.len * frac));
    if (span > e.len - 2) span = Math.max(minW, e.len - 2);
    if (span < minW) return;

    // Wide openings on living/master split into a twin bay for real facades.
    const twin = !wet && span > 7 && (r.type === "living" || r.type === "master_bedroom");
    const segments = twin
      ? [{ c: 0.34, s: span / 2 - 0.4 }, { c: 0.66, s: span / 2 - 0.4 }]
      : [{ c: 0.5, s: span }];

    for (const seg of segments) {
      if (e.wall === "W" || e.wall === "E") {
        const cy = r.y + r.h * seg.c;
        const x = e.wall === "W" ? r.x : r.x + r.w;
        openings.push({
          kind: "window",
          x1: x, y1: cy - seg.s / 2, x2: x, y2: cy + seg.s / 2,
          floor, t: 0.5, width: seg.s, wall: e.wall, roomIndex: ri,
        });
      } else {
        const cx = r.x + r.w * seg.c;
        const y = e.wall === "N" ? r.y : r.y + r.h;
        openings.push({
          kind: "window",
          x1: cx - seg.s / 2, y1: y, x2: cx + seg.s / 2, y2: y,
          floor, t: 0.5, width: seg.s, wall: e.wall, roomIndex: ri,
        });
      }
    }
  });

}

/**
 * Lay out one side of the hallway as a vertical stack of rooms.
 * Returns RoomRect[] in plate-local coordinates where:
 *   x=0 is the side wall (or hallway edge for the inner side)
 *   y=0 is the front of the building
 *   "depth" is along the hallway direction (front → back)
 */
/** Lift cab sized to occupancy. 2–3 ppl → 4×4, 4–5 → 5×5, 6+ → 6×6.
 *  Plus a 1.5 ft mechanism band rendered in 3D around/above the shaft. */
export function liftDims(familySize: number): { w: number; h: number } {
  if (familySize >= 6) return { w: 6, h: 6 };
  if (familySize >= 4) return { w: 5, h: 5 };
  return { w: 4, h: 4 };
}

function layoutSide(
  zones: PlacedZone[],
  sideWidth: number,
  totalDepth: number,
  startWall: "left" | "right",
  floorIndex: number,
  hallwayX: number,
  hallwayW: number,
  stairY: number | undefined,
  stairShape: DesignSpec["staircaseType"],
  withLift: boolean,
  liftSize: { w: number; h: number },
): { rooms: RoomRect[] } {
  if (zones.length === 0) return { rooms: [] };

  const orderedZones = [...zones];
  const stairIndex = orderedZones.findIndex((z) => z.type === "stairs");
  if (stairIndex > 0) {
    const [stair] = orderedZones.splice(stairIndex, 1);
    orderedZones.unshift(stair);
  }

  const sDims = stairDims(stairShape);

  const targets = orderedZones.map((z) => {
    if (z.type === "stairs") return sDims.h;
    const pref = dimsFor(z.type, z.sizePref);
    return Math.max(pref.w, pref.h);
  });
  const sumTarget = targets.reduce((a, b) => a + b, 0);
  const scale = totalDepth / Math.max(1, sumTarget);

  const rooms: RoomRect[] = [];
  let cursorY = 0;
  for (let i = 0; i < orderedZones.length; i++) {
    const z = orderedZones[i];
    const min = MIN_ROOM_DIMS[z.type];

    let depth = Math.max(min.h, targets[i] * scale);
    if (z.type === "stairs") depth = sDims.h;

    const remaining = totalDepth - cursorY;
    const remainingZones = orderedZones.length - i;
    if (depth > remaining - (remainingZones - 1) * min.h) {
      depth = Math.max(min.h, remaining - (remainingZones - 1) * min.h);
    }
    if (i === zones.length - 1) depth = remaining;
    // Rear-most room takes its door near the corridor end so the corridor
    // serves doors along its whole length instead of dead-ending in a
    // pointless walk-past strip.
    const isRear = i === orderedZones.length - 1 && z.type !== "stairs";


    const width = sideWidth;
    const x = startWall === "left" ? hallwayX - width : hallwayX + hallwayW;
    const y = z.type === "stairs" && stairY != null ? stairY : cursorY;

    const doorWall: "N" | "E" | "S" | "W" = startWall === "left" ? "E" : "W";

      // Lift sits BETWEEN hallway and stair so its door opens onto the
      // hallway directly — never blocked by the staircase shaft.
      const liftW = withLift ? Math.min(liftSize.w, sideWidth - 1) : 0;
      const liftGap = withLift ? 0.5 : 0;
      const stairW = withLift
        ? Math.max(MIN_ROOM_DIMS.stairs.w, sideWidth - liftW - liftGap)
        : sideWidth;

      if (z.type === "stairs") {
        const stairX = startWall === "left"
          ? hallwayX - liftW - liftGap - stairW
          : hallwayX + hallwayW + liftW + liftGap;
        rooms.push({
          type: "stairs", x: stairX, y, w: stairW, h: depth,
          floor: floorIndex, label: LABEL.stairs, doorWall, doorMid: depth / 2,
        });
        if (withLift) {
          const liftH = Math.min(liftSize.h, depth);
          const liftX = startWall === "left"
            ? hallwayX - liftW
            : hallwayX + hallwayW;
          rooms.push({
            type: "lift", x: liftX, y, w: liftW, h: liftH,
            floor: floorIndex, label: LABEL.lift, doorWall, doorMid: liftH / 2,
          });
        }
      } else {
        rooms.push({
          type: z.type, x, y, w: width, h: depth,
          floor: floorIndex, label: LABEL[z.type],
          doorWall,
          doorMid: isRear ? Math.max(depth / 2, depth - 3) : depth / 2,
        });

      }

    cursorY += depth;
  }

  return { rooms };
}

/** Build the floor plate for one floor using residential layout pipeline. */
function buildPlate(
  floorIndex: number,
  rooms: FlatRoom[],
  plotW: number,
  plotD: number,
  curvatureLevel: number,
  vastu: VastuPreferences,
  entranceDir: Direction,
  rng: () => number,
  isGroundFloor: boolean,
  stairSide: HallSide,
  stairShape: DesignSpec["staircaseType"],
  withLift: boolean,
  liftSize: { w: number; h: number },
  footprintInset: FootprintInset,
  layoutShift: number,
): FloorPlate {
  const fx = SETBACK + footprintInset.west;
  const fy = SETBACK + footprintInset.north;
  const fw = plotW - SETBACK * 2 - footprintInset.west - footprintInset.east;
  const fh = plotD - SETBACK * 2 - footprintInset.north - footprintInset.south;

  const entranceWall = pickEntranceWall(entranceDir);

  // We always plan in "front=top, hallway runs vertically (top→bottom)"
  // Then rotate the plan so 'front' aligns to the entranceWall.
  // For simplicity we keep the plan oriented with hallway running along the
  // longer dimension, with front edge = entranceWall.

  const hallwayAlongY = entranceWall === "N" || entranceWall === "S";
  // Plate-local working dims: depth runs from front to back, side width
  // perpendicular.
  const workDepth = hallwayAlongY ? fh : fw;
  const workWidth = hallwayAlongY ? fw : fh;

  const hallwayW = HALLWAY_WIDTH;
  const maxOffset = Math.max(0, (workWidth - hallwayW) / 2 - 8);
  const hallwayOffset = Math.max(-maxOffset, Math.min(maxOffset, layoutShift));
  const hallwayLocalX = (workWidth - hallwayW) / 2 + hallwayOffset;
  const leftSideWidth = hallwayLocalX;
  const rightSideWidth = workWidth - hallwayLocalX - hallwayW;

  const zones = planFloor(rooms, entranceWall, rng, stairSide);
  const leftZones = zones.filter((z) => z.side === "left");
  const rightZones = zones.filter((z) => z.side === "right");

  const leftLayout = layoutSide(leftZones, leftSideWidth, workDepth, "left", floorIndex, hallwayLocalX, hallwayW, undefined, stairShape, withLift, liftSize);
  const rightLayout = layoutSide(rightZones, rightSideWidth, workDepth, "right", floorIndex, hallwayLocalX, hallwayW, undefined, stairShape, withLift, liftSize);
  const localRooms = [...leftLayout.rooms, ...rightLayout.rooms];

  // Rotate / mirror local coords to match entranceWall.
  // Local: front = y=0, hallway vertical at x=hallwayLocalX
  // Entrance "S": front is at y=fh (south), so flip y.
  // Entrance "E": rotate 90° so hallway runs horizontally with front at x=fw.
  // Entrance "W": rotate 90° with front at x=0.
  const placed: RoomRect[] = [];
  for (const r of localRooms) {
    let nx = r.x;
    let ny = r.y;
    let nw = r.w;
    let nh = r.h;
    let dw = r.doorWall;
    if (entranceWall === "N") {
      // local matches: front at top (y=0)
    } else if (entranceWall === "S") {
      // flip vertically
      ny = workDepth - r.y - r.h;
      if (dw === "N") dw = "S";
      else if (dw === "S") dw = "N";
    } else if (entranceWall === "E") {
      // rotate 90° clockwise: (x,y) -> (workDepth - y - h, x)
      nx = workDepth - r.y - r.h;
      ny = r.x;
      nw = r.h;
      nh = r.w;
      const map: Record<"N" | "E" | "S" | "W", "N" | "E" | "S" | "W"> = { N: "E", E: "S", S: "W", W: "N" };
      if (dw) dw = map[dw];
    } else if (entranceWall === "W") {
      // rotate 90° counter-clockwise: (x,y) -> (y, workWidth - x - w)
      nx = r.y;
      ny = workWidth - r.x - r.w;
      nw = r.h;
      nh = r.w;
      const map: Record<"N" | "E" | "S" | "W", "N" | "E" | "S" | "W"> = { N: "W", W: "S", S: "E", E: "N" };
      if (dw) dw = map[dw];
    }
    placed.push({
      type: r.type,
      x: fx + nx,
      y: fy + ny,
      w: nw,
      h: nh,
      floor: floorIndex,
      label: r.label,
      doorWall: dw,
      doorMid: r.doorMid,
    });
  }

  // Compute hallway rectangle in plate coords
  let hallway: { x: number; y: number; w: number; h: number };
  if (entranceWall === "N" || entranceWall === "S") {
    hallway = { x: fx + hallwayLocalX, y: fy, w: hallwayW, h: fh };
  } else if (entranceWall === "E") {
    hallway = { x: fx, y: fy + hallwayLocalX, w: fw, h: hallwayW };
  } else {
    hallway = { x: fx, y: fy + hallwayLocalX, w: fw, h: hallwayW };
  }

  // ---------- Openings: doors onto hallway, windows on outer walls ----------
  const openings: Opening[] = [];
  for (let ri = 0; ri < placed.length; ri++) {
    const r = placed[ri];
    // Door onto hallway (or onto adjacent room for ensuite)
    if (r.doorWall && r.doorMid != null) {
      const dwidth = 3;
      const mid = Math.max(
        1.5 + dwidth / 2,
        Math.min(
          (r.doorWall === "N" || r.doorWall === "S" ? r.w : r.h) - 1.5 - dwidth / 2,
          r.doorMid,
        ),
      );
      if (r.doorWall === "E") {
        openings.push({
          kind: "door",
          x1: r.x + r.w, y1: r.y + mid - dwidth / 2,
          x2: r.x + r.w, y2: r.y + mid + dwidth / 2,
          floor: floorIndex, t: 0.5, width: dwidth,
          wall: "E", roomIndex: ri,
        });
      } else if (r.doorWall === "W") {
        openings.push({
          kind: "door",
          x1: r.x, y1: r.y + mid - dwidth / 2,
          x2: r.x, y2: r.y + mid + dwidth / 2,
          floor: floorIndex, t: 0.5, width: dwidth,
          wall: "W", roomIndex: ri,
        });
      } else if (r.doorWall === "N") {
        openings.push({
          kind: "door",
          x1: r.x + mid - dwidth / 2, y1: r.y,
          x2: r.x + mid + dwidth / 2, y2: r.y,
          floor: floorIndex, t: 0.5, width: dwidth,
          wall: "N", roomIndex: ri,
        });
      } else if (r.doorWall === "S") {
        openings.push({
          kind: "door",
          x1: r.x + mid - dwidth / 2, y1: r.y + r.h,
          x2: r.x + mid + dwidth / 2, y2: r.y + r.h,
          floor: floorIndex, t: 0.5, width: dwidth,
          wall: "S", roomIndex: ri,
        });
      }
    }

    // Windows: daylight-driven, not just "one per room"
    pushWindows(openings, r, ri, floorIndex, fx, fy, fw, fh);

  }

  // Front door at hallway entry on the entrance wall
  let entranceDoor: Opening | undefined;
  if (isGroundFloor) {
    const dw = 3.5;
    if (entranceWall === "N") {
      const ex = hallway.x + hallway.w / 2;
      entranceDoor = {
        kind: "door",
        x1: ex - dw / 2, y1: fy, x2: ex + dw / 2, y2: fy,
        floor: floorIndex, t: 0.5, width: dw, wall: "N",
      };
    } else if (entranceWall === "S") {
      const ex = hallway.x + hallway.w / 2;
      entranceDoor = {
        kind: "door",
        x1: ex - dw / 2, y1: fy + fh, x2: ex + dw / 2, y2: fy + fh,
        floor: floorIndex, t: 0.5, width: dw, wall: "S",
      };
    } else if (entranceWall === "E") {
      const ey = hallway.y + hallway.h / 2;
      entranceDoor = {
        kind: "door",
        x1: fx + fw, y1: ey - dw / 2, x2: fx + fw, y2: ey + dw / 2,
        floor: floorIndex, t: 0.5, width: dw, wall: "E",
      };
    } else if (entranceWall === "W") {
      const ey = hallway.y + hallway.h / 2;
      entranceDoor = {
        kind: "door",
        x1: fx, y1: ey - dw / 2, x2: fx, y2: ey + dw / 2,
        floor: floorIndex, t: 0.5, width: dw, wall: "W",
      };
    }
    if (entranceDoor) openings.push(entranceDoor);
  }

  // Tasteful corner curvature on the plate corners — drives both the 2D
  // corner rooms and 3D corner pillars. Scales with curvatureLevel.
  const minSide = Math.min(fw, fh);
  const cornerRadius = Math.max(0.8, Math.min(4.5, minSide * 0.06 * curvatureLevel));
  void vastu;
  void rng;

  return {
    floor: floorIndex,
    x: fx, y: fy, w: fw, h: fh,
    cornerRadius,
    chamfer: 0,
    rooms: placed,
    openings,
    hallway,
    entranceDoor,
  };
}

function rebuildInteriorOpenings(plate: FloorPlate): FloorPlate {
  const openings: Opening[] = [];
  const fx = plate.x;
  const fy = plate.y;
  const fw = plate.w;
  const fh = plate.h;

  for (let ri = 0; ri < plate.rooms.length; ri++) {
    const r = plate.rooms[ri];
    if (r.doorWall && r.doorMid != null) {
      const dwidth = 3;
      const wallLen = r.doorWall === "N" || r.doorWall === "S" ? r.w : r.h;
      const mid = Math.max(1.5 + dwidth / 2, Math.min(wallLen - 1.5 - dwidth / 2, r.doorMid));
      if (r.doorWall === "E") openings.push({ kind: "door", x1: r.x + r.w, y1: r.y + mid - dwidth / 2, x2: r.x + r.w, y2: r.y + mid + dwidth / 2, floor: plate.floor, t: 0.5, width: dwidth, wall: "E", roomIndex: ri });
      else if (r.doorWall === "W") openings.push({ kind: "door", x1: r.x, y1: r.y + mid - dwidth / 2, x2: r.x, y2: r.y + mid + dwidth / 2, floor: plate.floor, t: 0.5, width: dwidth, wall: "W", roomIndex: ri });
      else if (r.doorWall === "N") openings.push({ kind: "door", x1: r.x + mid - dwidth / 2, y1: r.y, x2: r.x + mid + dwidth / 2, y2: r.y, floor: plate.floor, t: 0.5, width: dwidth, wall: "N", roomIndex: ri });
      else openings.push({ kind: "door", x1: r.x + mid - dwidth / 2, y1: r.y + r.h, x2: r.x + mid + dwidth / 2, y2: r.y + r.h, floor: plate.floor, t: 0.5, width: dwidth, wall: "S", roomIndex: ri });
    }

    pushWindows(openings, r, ri, plate.floor, fx, fy, fw, fh);

  }

  return { ...plate, openings, entranceDoor: undefined };
}

// ---------- Liveability evaluation ----------
function evaluateLiveability(
  plates: FloorPlate[],
  entranceDir: Direction,
): Liveability {
  const issues: string[] = [];
  const ground = plates[0];

  const hallway = !!ground.hallway;
  if (!hallway) issues.push("No hallway found on ground floor.");

  const habitableTypes: RoomType[] = ["bedroom", "master_bedroom", "living", "dining", "study"];
  let bedroomsHaveWindows = true;
  for (const p of plates) {
    for (const r of p.rooms) {
      if (!habitableTypes.includes(r.type)) continue;
      const windows = p.openings.filter(
        (o) =>
          o.kind === "window" &&
          o.x1 >= r.x - 0.6 && o.x2 <= r.x + r.w + 0.6 &&
          o.y1 >= r.y - 0.6 && o.y2 <= r.y + r.h + 0.6,
      );
      if (windows.length === 0) {
        bedroomsHaveWindows = false;
        issues.push(`Floor ${p.floor}: ${r.label} has no window.`);
      }
    }
  }

  // Bathrooms private = no bath room shares a wall with kitchen or pooja
  let bathroomsPrivate = true;
  const tol = 0.8;
  for (const p of plates) {
    const baths = p.rooms.filter((r) => r.type === "bath");
    const sensitives = p.rooms.filter((r) => r.type === "kitchen" || r.type === "pooja");
    for (const b of baths) {
      for (const s of sensitives) {
        const sharesV =
          (Math.abs(b.x + b.w - s.x) < tol || Math.abs(s.x + s.w - b.x) < tol) &&
          Math.min(b.y + b.h, s.y + s.h) - Math.max(b.y, s.y) > 1;
        const sharesH =
          (Math.abs(b.y + b.h - s.y) < tol || Math.abs(s.y + s.h - b.y) < tol) &&
          Math.min(b.x + b.w, s.x + s.w) - Math.max(b.x, s.x) > 1;
        if (sharesV || sharesH) {
          bathroomsPrivate = false;
          issues.push(`Floor ${p.floor}: bath next to ${s.label}.`);
        }
      }
    }
  }

  const entranceCorrect = !!ground.entranceDoor;
  if (!entranceCorrect) issues.push(`No front door cut on ${entranceDir} wall.`);

  // Stairs aligned: in multi-floor, stairs in same x/y on every floor.
  let stairsAligned = true;
  if (plates.length > 1) {
    const groundStair = plates[0].rooms.find((r) => r.type === "stairs");
    if (!groundStair) {
      stairsAligned = false;
      issues.push("No staircase on ground floor.");
    } else {
      for (let i = 1; i < plates.length; i++) {
        const s = plates[i].rooms.find((r) => r.type === "stairs");
        if (!s) {
          stairsAligned = false;
          issues.push(`Floor ${plates[i].floor}: missing staircase.`);
          continue;
        }
        if (Math.abs(s.x - groundStair.x) > 0.5 || Math.abs(s.y - groundStair.y) > 0.5) {
          stairsAligned = false;
          issues.push(`Floor ${plates[i].floor}: stairs not aligned with ground floor.`);
        }
      }
    }
  }

  return { hallway, bedroomsHaveWindows, bathroomsPrivate, entranceCorrect, stairsAligned, issues };
}

function computeParking(
  ground: FloorPlate,
  plotW: number,
  plotD: number,
  entranceDir: Direction,
  parkingSpec: DesignSpec["parking"] | undefined,
  rng: () => number,
): ParkingArea | undefined {
  const bikeCount = parkingSpec?.bikes ?? 0;
  const fp = parkingFootprint(parkingSpec);
  // Allow bike-only parking when no car bay was requested.
  if ((!fp || parkingSpec?.location === "outside") && bikeCount === 0) return undefined;

  const wall: "N" | "E" | "S" | "W" = pickEntranceWall(entranceDir);
  const door = ground.entranceDoor;
  const covered = rng() < 0.6;

  // Bike strip is 3 ft wide × (count × 3) ft long, parked perpendicular to the wall.
  const bikeStripLong = bikeCount * 3;
  const bikeStripShort = 6;

  // Bike-only case: no car footprint — drop a small strip in the setback.
  if (!fp) {
    const w = wall === "N" || wall === "S" ? bikeStripLong : bikeStripShort;
    const h = wall === "N" || wall === "S" ? bikeStripShort : bikeStripLong;
    let x = 0, y = 0;
    if (wall === "N") { y = Math.max(0, ground.y - h); x = ground.x; }
    else if (wall === "S") { y = ground.y + ground.h; x = ground.x; }
    else if (wall === "E") { x = ground.x + ground.w; y = ground.y; }
    else { x = Math.max(0, ground.x - w); y = ground.y; }
    x = Math.max(0, Math.min(plotW - w, x));
    y = Math.max(0, Math.min(plotD - h, y));
    return {
      x, y, w, h, bays: 0, covered: false,
      bikeBays: { x, y, w, h, count: bikeCount },
    };
  }

  const bays = parkingSpec!.count;

  // Bay orientation: along N/S walls, vehicle nose points N–S (depth = h on plot).
  // On E/W walls, vehicle nose points E–W (depth runs along x).
  let w: number;
  let h: number;
  if (wall === "N" || wall === "S") {
    w = fp.w;
    h = fp.h;
  } else {
    w = fp.h; // depth along x
    h = fp.w;
  }

  let x = 0;
  let y = 0;

  if (wall === "N") {
    y = Math.max(0, ground.y - h);
    const doorMid = door ? (door.x1 + door.x2) / 2 : ground.x + ground.w / 2;
    const sideOffset = doorMid > plotW / 2 ? -1 : 1;
    x = doorMid + sideOffset * (w / 2 + 4) - w / 2;
  } else if (wall === "S") {
    y = ground.y + ground.h;
    const doorMid = door ? (door.x1 + door.x2) / 2 : ground.x + ground.w / 2;
    const sideOffset = doorMid > plotW / 2 ? -1 : 1;
    x = doorMid + sideOffset * (w / 2 + 4) - w / 2;
  } else if (wall === "E") {
    x = ground.x + ground.w;
    const doorMid = door ? (door.y1 + door.y2) / 2 : ground.y + ground.h / 2;
    const sideOffset = doorMid > plotD / 2 ? -1 : 1;
    y = doorMid + sideOffset * (h / 2 + 4) - h / 2;
  } else {
    x = Math.max(0, ground.x - w);
    const doorMid = door ? (door.y1 + door.y2) / 2 : ground.y + ground.h / 2;
    const sideOffset = doorMid > plotD / 2 ? -1 : 1;
    y = doorMid + sideOffset * (h / 2 + 4) - h / 2;
  }

  // Hard clamp — bay must lie fully inside the plot rectangle. We DO NOT
  // shrink width/depth here: feasibility was already validated in
  // validatePlotFit. If the clamp would push the bay into the building, we
  // return undefined rather than overlap rooms.
  x = Math.max(0, Math.min(plotW - w, x));
  y = Math.max(0, Math.min(plotD - h, y));

  // Overlap check vs. ground-floor footprint.
  const overlaps =
    x + w > ground.x &&
    x < ground.x + ground.w &&
    y + h > ground.y &&
    y < ground.y + ground.h;
  if (overlaps) return undefined;

  // Tuck bike bays alongside the car bay, on the side away from the entrance door.
  let bikeBays: ParkingArea["bikeBays"] | undefined;
  if (bikeCount > 0) {
    const alongX = wall === "N" || wall === "S";
    const bw = alongX ? bikeStripLong : bikeStripShort;
    const bh = alongX ? bikeStripShort : bikeStripLong;
    // Place adjacent to the car bay, opposite side from entrance door.
    const doorMid = door
      ? (alongX ? (door.x1 + door.x2) / 2 : (door.y1 + door.y2) / 2)
      : alongX ? plotW / 2 : plotD / 2;
    const bayMid = alongX ? x + w / 2 : y + h / 2;
    const farFromDoor = bayMid > doorMid ? 1 : -1;
    let bx = x, by = y;
    if (alongX) bx = x + (farFromDoor > 0 ? w + 1 : -bw - 1);
    else by = y + (farFromDoor > 0 ? h + 1 : -bh - 1);
    bx = Math.max(0, Math.min(plotW - bw, bx));
    by = Math.max(0, Math.min(plotD - bh, by));
    const bikeOverlap =
      bx + bw > ground.x && bx < ground.x + ground.w &&
      by + bh > ground.y && by < ground.y + ground.h;
    if (!bikeOverlap) bikeBays = { x: bx, y: by, w: bw, h: bh, count: bikeCount };
  }

  return { x, y, w, h, bays, covered, bikeBays };
}


export function generateVariations(
  spec: DesignSpec,
  vastu: VastuPreferences,
  count = 10,
): Variation[] {
  const variations: Variation[] = [];
  const baseSeed = Math.floor(Math.random() * 1_000_000);

  // Per-floor room distribution.
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

  const baseStairShape: DesignSpec["staircaseType"] = spec.staircaseType ?? "straight";
  const withLift = spec.lift === "home";
  const stiltParking = !!spec.stiltParking && spec.floors >= 2;

  // Estimate side band so the auto-picker can choose a stair shape that fits.
  const usableW = spec.plot.widthFt - SETBACK * 2;
  const usableD = spec.plot.depthFt - SETBACK * 2;
  const longSide = Math.max(usableW, usableD);
  const shortSide = Math.min(usableW, usableD);
  const sideBand = (shortSide - HALLWAY_WIDTH) / 2;
  const autoStair = pickStaircase(spec, sideBand);
  const stairShape = spec.staircaseType ?? autoStair;
  void baseStairShape;
  void longSide;

  const entranceDirEarly: Direction = vastu.entranceDirection ?? spec.plot.facing;
  const planType = pickPlanType(spec, entranceDirEarly);

  // If stilt parking, ground floor is parking + stairs (+optional utility).
  if (stiltParking) {
    // One open parking bay (no internal partition between cars) + stairs.
    // The bay sizes itself to fit 1 or 2 cars from spec.parking?.count.
    const stilt: FlatRoom[] = [
      { type: "parking", sizePref: "large" },
      { type: "stairs", sizePref: "medium" },
    ];
    if (spec.stiltUtilityRoom) stilt.push({ type: "utility", sizePref: "small" });
    perFloor[0] = stilt;
  }


  // Inject stair on every habitable floor when multi-floor. Sloped/butterfly
  // roofs only suppress the roof mumty in the 3D roof renderer — the top floor
  // still needs a real stair landing so people can reach it.
  if (spec.floors > 1) {
    for (let f = 0; f < spec.floors; f++) {
      const has = perFloor[f].some((r) => r.type === "stairs");
      if (!has) perFloor[f].push({ type: "stairs", sizePref: "medium" });
    }
  }
  // Inject lift on every floor when enabled (multi-floor).
  if (withLift && spec.floors > 1) {
    for (let f = 0; f < spec.floors; f++) {
      const has = perFloor[f].some((r) => r.type === "lift");
      if (!has) perFloor[f].push({ type: "lift", sizePref: "small" });
    }
  }

  const entranceDir: Direction = vastu.entranceDirection ?? spec.plot.facing;
  const entranceAngleDeg = DIRECTION_ANGLES[entranceDir];

  for (let i = 0; i < count; i++) {
    const seed = baseSeed + i * 1009;
    const rng = mulberry32(seed);
    const massingStyle = MASSING_STYLES[i % MASSING_STYLES.length];

    const baseCurv =
      spec.curvature === "gentle" ? 0.25 : spec.curvature === "bold" ? 0.8 : 0.5;
    const curvatureLevel = Math.max(0.1, Math.min(1, baseCurv + (rng() - 0.5) * 0.25));
    const stairSide: HallSide = rng() < 0.5 ? "left" : "right";
    const sideBandInset = Math.max(0, Math.min(6, (Math.min(usableW, usableD) - HALLWAY_WIDTH - 18) / 2));
    const layoutShift = ((i % 5) - 2) * Math.min(2.4, Math.max(0.5, sideBandInset * 0.45));

    const plates: FloorPlate[] = [];
    for (let f = 0; f < spec.floors; f++) {
      const list = perFloor[f].length > 0
        ? perFloor[f]
        : [{ type: "bedroom", sizePref: "medium" } as FlatRoom];
      plates.push(
        buildPlate(
          f + 1,
          list,
          spec.plot.widthFt,
          spec.plot.depthFt,
          curvatureLevel,
          vastu,
          entranceDir,
          rng,
          f === 0,
          stairSide,
          stairShape,
          withLift && spec.floors > 1,
          liftDims(spec.lifestyle.familySize),
          footprintForMassing(massingStyle, f, spec.floors, sideBandInset, rng),
          layoutShift,
        ),
      );
    }

    // Align stair shafts vertically across floors. The ground-floor stair
    // defines the canonical (x, y, w, h). On every upper floor, replace the
    // stair rect with those same coordinates AND reflow any room on the same
    // side whose vertical span overlaps the stair, by shrinking that room to
    // the remaining vertical band (front-of-stair OR back-of-stair).
    if (plates.length > 1) {
      const groundStairs = plates[0].rooms.find((r) => r.type === "stairs");
      if (groundStairs) {
        const sx = groundStairs.x;
        const sy = groundStairs.y;
        const sw = groundStairs.w;
        const sh = groundStairs.h;
        for (let f = 1; f < plates.length; f++) {
          const rooms = plates[f].rooms;
          // Reflow rooms on the same vertical side as the stair (overlapping x)
          for (let i = 0; i < rooms.length; i++) {
            const r = rooms[i];
            if (r.type === "stairs" || r.type === "lift") continue;
            // Same vertical band (overlaps stair x range)?
            const xOverlap = !(r.x + r.w <= sx + 0.01 || r.x >= sx + sw - 0.01);
            if (!xOverlap) continue;
            // Vertical overlap with stair?
            const yOverlap = !(r.y + r.h <= sy + 0.01 || r.y >= sy + sh - 0.01);
            if (!yOverlap) continue;
            // Determine where most of the room lies relative to stair
            const roomCenter = r.y + r.h / 2;
            const stairCenter = sy + sh / 2;
            if (roomCenter < stairCenter) {
              // Shrink to space above (in front of) stair
              const newH = Math.max(0, sy - r.y);
              if (newH < 6) {
                // Too small — collapse this room (mark zero, will be filtered)
                rooms[i] = { ...r, h: 0 };
              } else {
                rooms[i] = { ...r, h: newH, doorMid: Math.min(r.doorMid ?? newH / 2, newH - 1.5) };
              }
            } else {
              // Shrink to space below (behind) stair
              const newY = sy + sh;
              const newH = Math.max(0, r.y + r.h - newY);
              if (newH < 6) {
                rooms[i] = { ...r, h: 0 };
              } else {
                rooms[i] = { ...r, y: newY, h: newH, doorMid: Math.min(r.doorMid ?? newH / 2, newH - 1.5) };
              }
            }
          }
          // Filter zero-height casualties
          plates[f].rooms = rooms.filter((r) => r.h > 0.5);
          // Now stamp stair (replace existing if any, else add) and make it
          // read as the upper-floor stair landing, not a separate entrance.
          const stairIdx = plates[f].rooms.findIndex((r) => r.type === "stairs");
          const doorWall: "N" | "E" | "S" | "W" = groundStairs.doorWall === "E" ? "W" : groundStairs.doorWall === "W" ? "E" : groundStairs.doorWall === "N" ? "S" : "N";
          const stairRect: RoomRect = {
            type: "stairs",
            x: sx, y: sy, w: sw, h: sh,
            floor: plates[f].floor,
            label: LABEL.stairs,
            doorWall,
            doorMid: groundStairs.doorMid,
          };
          if (stairIdx >= 0) plates[f].rooms[stairIdx] = stairRect;
          else plates[f].rooms.push(stairRect);

          // Align lift across floors too (if ground has one)
          const groundLift = plates[0].rooms.find((r) => r.type === "lift");
          if (groundLift) {
            const liftIdx = plates[f].rooms.findIndex((r) => r.type === "lift");
            const liftRect: RoomRect = {
              type: "lift",
              x: groundLift.x, y: groundLift.y, w: groundLift.w, h: groundLift.h,
              floor: plates[f].floor,
              label: LABEL.lift,
              doorWall,
              doorMid: groundLift.doorMid,
            };
            if (liftIdx >= 0) plates[f].rooms[liftIdx] = liftRect;
            else plates[f].rooms.push(liftRect);
          }
          plates[f] = rebuildInteriorOpenings(plates[f]);
        }
      }
    }

    supportUpperPlates(plates);
    ensureVerticalCoreInsideUpperPlates(plates, spec.plot.widthFt, spec.plot.depthFt);

    const allRooms = plates.flatMap((p) => p.rooms);
    const center = {
      x: plates[0].x + plates[0].w / 2,
      y: plates[0].y + plates[0].h / 2,
    };
    const vastuResult = scoreVastu(allRooms, vastu, entranceDir, center);
    const liveability = evaluateLiveability(plates, entranceDir);

    // Every variation must read as its own house — unique facade style AND
    // unique accent colour. Cycle both lists at coprime strides so 10
    // variations get 10 distinct (style, colour) pairs.
    const elevationStyle = ELEVATION_STYLES[i % ELEVATION_STYLES.length];
    const accent = ACCENTS[i % ACCENTS.length];

    // Apply plan-type silhouette via chamfer (existing 2D/3D both honour it).
    // Vary the chamfer side per variation so each elevation has a different
    // "face" — front wing, back wing, side notch — instead of identical boxes.
    const sideAspect = Math.min(plates[0].w, plates[0].h);
    const chamferFor: Record<PlanType, number> = {
      "compact-box": 0,
      "wide-box": Math.min(3, sideAspect * 0.08),
      "l-shape": Math.min(7, sideAspect * 0.22),
      "u-shape": Math.min(9, sideAspect * 0.3),
      "courtyard": Math.min(5, sideAspect * 0.15),
    };
    const chamfer = chamferFor[planType] * (0.75 + rng() * 0.5);
    // For courtyard/L/U-shape plans, align the notch with the entrance wall
    // (front) or the opposite wall (back) so the courtyard sits directly in
    // front of or behind the main door — never trapped on a side.
    const frontBackCorners: Record<Direction, NonNullable<FloorPlate["chamferCorner"]>[]> = {
      N: ["NE", "NW", "SE", "SW"],
      S: ["SE", "SW", "NE", "NW"],
      E: ["NE", "SE", "NW", "SW"],
      W: ["NW", "SW", "NE", "SE"],
      NE: ["NE", "SW"], NW: ["NW", "SE"], SE: ["SE", "NW"], SW: ["SW", "NE"],
    };
    const alignsWithEntrance = planType === "l-shape" || planType === "u-shape" || planType === "courtyard" || massingStyle === "courtyard-cut" || massingStyle === "jaali-court" || massingStyle === "mono-slope-courtyard";
    const candidates = alignsWithEntrance ? frontBackCorners[entranceDir] : CHAMFER_CORNERS;
    const chamferCorner = candidates[i % candidates.length];
    for (const p of plates) {
      p.chamfer = chamfer || (massingStyle === "split-block" || massingStyle === "jaali-court" ? Math.min(5, sideAspect * 0.12) : 0);
      p.chamferCorner = chamferCorner;
    }

    // Parking lives inside the plot. When stilt-parking is enabled, parking
    // is a room on the ground floor instead of a separate strip.
    const parking = stiltParking
      ? undefined
      : computeParking(plates[0], spec.plot.widthFt, spec.plot.depthFt, entranceDir, spec.parking, rng);

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
      elevationStyle,
      massingStyle,
      parking,
      paletteAccent: accent,
      liveability,
    });
  }

  variations.sort((a, b) => b.vastuScore - a.vastuScore);

  // Attach a unique architectural DNA to every variation. Deterministic per
  // batch (via baseSeed), and dedup'd on the core visual tuple across the 10
  // so no two elevations share the same massing/facade/roof/signature combo.
  const dnaSet = generateDnaSet(baseSeed, variations.length);
  for (let i = 0; i < variations.length; i++) {
    variations[i].dna = dnaSet[i];
    variations[i].paletteAccent = dnaSet[i].palette.accent;
  }

  return variations;
}

