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

// ---------- Architectural minimum dimensions (ft) ----------
// Sourced from Architectural Rule Book v2.0 (mandatory minimums).
export const MIN_ROOM_DIMS: Record<RoomType, { w: number; h: number }> = {
  living: { w: 14, h: 16 },
  master_bedroom: { w: 13, h: 14 },
  bedroom: { w: 11, h: 12 },
  kitchen: { w: 9, h: 11 },
  dining: { w: 10, h: 12 },
  bath: { w: 6, h: 7 },
  pooja: { w: 5, h: 6 },
  study: { w: 8, h: 8 },
  courtyard: { w: 8, h: 8 },
  stairs: { w: 4, h: 8 },
  lift: { w: 4, h: 4 },
  utility: { w: 6, h: 7 },
  parking: { w: 9, h: 18 },
};

// Preferred dimensions (Rule Book v2.0 "Preferred" tier).
const PREF_ROOM_DIMS: Record<RoomType, { w: number; h: number }> = {
  living: { w: 16, h: 20 },
  master_bedroom: { w: 14, h: 16 },
  bedroom: { w: 12, h: 13 },
  kitchen: { w: 10, h: 12 },
  dining: { w: 12, h: 14 },
  bath: { w: 7, h: 8 },
  pooja: { w: 6, h: 8 },
  study: { w: 9, h: 10 },
  courtyard: { w: 10, h: 10 },
  stairs: { w: 4.5, h: 9 },
  lift: { w: 4, h: 4 },
  utility: { w: 7, h: 8 },
  parking: { w: 9, h: 18 },
};

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
      message: `Plot is too small (${spec.plot.widthFt}×${spec.plot.depthFt} ft). Rule Book v2.0 minimums need at least 28×32 ft.`,
    });
    return issues;
  }

  const perFloor = spec.roomsPerFloor ?? [];
  for (let f = 0; f < spec.floors; f++) {
    const rooms = perFloor[f] ?? [];
    let needed = 0;
    for (const r of rooms) {
      const m = MIN_ROOM_DIMS[r.type];
      needed += m.w * m.h * r.count;
    }
    // hallway area estimate
    const hallway = HALLWAY_WIDTH * fh;
    const usable = fw * fh - hallway;
    if (needed > usable) {
      issues.push({
        floor: f + 1,
        message: `Floor ${f + 1}: rooms need ${Math.ceil(needed)} sqft but plot only fits ${Math.floor(usable)} sqft after hallway.`,
      });
    }
    // Largest single room must fit between hallway and outer wall
    const sideZone = (fw - HALLWAY_WIDTH) / 2;
    for (const r of rooms) {
      if (r.count <= 0) continue;
      const m = MIN_ROOM_DIMS[r.type];
      const minSide = Math.min(m.w, m.h);
      if (minSide > sideZone) {
        issues.push({
          floor: f + 1,
          message: `Floor ${f + 1}: ${LABEL[r.type]} needs ${minSide} ft but only ${Math.floor(sideZone)} ft available beside hallway.`,
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
    const m = PREF_ROOM_DIMS[r.type];
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
  for (const r of publicRooms) pushAlt(r);
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
 * Lay out one side of the hallway as a vertical stack of rooms.
 * Returns RoomRect[] in plate-local coordinates where:
 *   x=0 is the side wall (or hallway edge for the inner side)
 *   y=0 is the front of the building
 *   "depth" is along the hallway direction (front → back)
 */
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
    const pref = PREF_ROOM_DIMS[z.type];
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

    const width = sideWidth;
    const x = startWall === "left" ? hallwayX - width : hallwayX + hallwayW;
    const y = z.type === "stairs" && stairY != null ? stairY : cursorY;

    const doorWall: "N" | "E" | "S" | "W" = startWall === "left" ? "E" : "W";

    if (z.type === "stairs") {
      // No lift: stair fills the entire side band (no outer gap).
      // With lift: stair takes its core size and lift fills the rest of the band.
      const stairW = withLift
        ? Math.min(sDims.w, sideWidth - MIN_ROOM_DIMS.lift.w - 0.5)
        : sideWidth;
      const stairX = startWall === "left"
        ? hallwayX - stairW
        : hallwayX + hallwayW + (withLift ? 0 : 0);
      rooms.push({
        type: "stairs", x: stairX, y, w: stairW, h: depth,
        floor: floorIndex, label: LABEL.stairs, doorWall, doorMid: depth / 2,
      });
      if (withLift) {
        const liftW = MIN_ROOM_DIMS.lift.w;
        const liftH = Math.min(MIN_ROOM_DIMS.lift.h, depth);
        const liftX = startWall === "left" ? stairX - liftW - 0.5 : stairX + stairW + 0.5;
        // Clamp lift inside the side band
        const minX = startWall === "left" ? hallwayX - sideWidth : hallwayX + hallwayW;
        const maxX = startWall === "left" ? hallwayX - liftW : hallwayX + hallwayW + sideWidth - liftW;
        const lx = Math.max(minX, Math.min(maxX, liftX));
        rooms.push({
          type: "lift", x: lx, y, w: liftW, h: liftH,
          floor: floorIndex, label: LABEL.lift, doorWall, doorMid: liftH / 2,
        });
      }
    } else {
      rooms.push({
        type: z.type, x, y, w: width, h: depth,
        floor: floorIndex, label: LABEL[z.type], doorWall, doorMid: depth / 2,
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
): FloorPlate {
  const fx = SETBACK;
  const fy = SETBACK;
  const fw = plotW - SETBACK * 2;
  const fh = plotD - SETBACK * 2;

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
  const sideWidth = (workWidth - hallwayW) / 2;
  const hallwayLocalX = sideWidth; // hallway starts here (in local coords)

  const zones = planFloor(rooms, entranceWall, rng, stairSide);
  const leftZones = zones.filter((z) => z.side === "left");
  const rightZones = zones.filter((z) => z.side === "right");

  const leftLayout = layoutSide(leftZones, sideWidth, workDepth, "left", floorIndex, hallwayLocalX, hallwayW, undefined, stairShape, withLift);
  const rightLayout = layoutSide(rightZones, sideWidth, workDepth, "right", floorIndex, hallwayLocalX, hallwayW, undefined, stairShape, withLift);
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

    // Windows on the outer wall (the wall opposite the hallway side)
    const tol = 0.6;
    const habitable = !["bath","stairs","pooja","lift","utility","parking"].includes(r.type);
    if (habitable) {
      // Determine the longest exterior wall and place ONE window there
      type ExtWall = { wall: "N" | "E" | "S" | "W"; len: number };
      const ext: ExtWall[] = [];
      if (Math.abs(r.x - fx) < tol) ext.push({ wall: "W", len: r.h });
      if (Math.abs(r.x + r.w - (fx + fw)) < tol) ext.push({ wall: "E", len: r.h });
      if (Math.abs(r.y - fy) < tol) ext.push({ wall: "N", len: r.w });
      if (Math.abs(r.y + r.h - (fy + fh)) < tol) ext.push({ wall: "S", len: r.w });
      ext.sort((a, b) => b.len - a.len);
      for (const e of ext) {
        if (e.wall === "W") {
          openings.push({
            kind: "window",
            x1: r.x, y1: r.y + r.h * 0.3, x2: r.x, y2: r.y + r.h * 0.7,
            floor: floorIndex, t: 0.5, width: r.h * 0.4,
            wall: "W", roomIndex: ri,
          });
        } else if (e.wall === "E") {
          openings.push({
            kind: "window",
            x1: r.x + r.w, y1: r.y + r.h * 0.3,
            x2: r.x + r.w, y2: r.y + r.h * 0.7,
            floor: floorIndex, t: 0.5, width: r.h * 0.4,
            wall: "E", roomIndex: ri,
          });
        } else if (e.wall === "N") {
          openings.push({
            kind: "window",
            x1: r.x + r.w * 0.3, y1: r.y, x2: r.x + r.w * 0.7, y2: r.y,
            floor: floorIndex, t: 0.5, width: r.w * 0.4,
            wall: "N", roomIndex: ri,
          });
        } else if (e.wall === "S") {
          openings.push({
            kind: "window",
            x1: r.x + r.w * 0.3, y1: r.y + r.h,
            x2: r.x + r.w * 0.7, y2: r.y + r.h,
            floor: floorIndex, t: 0.5, width: r.w * 0.4,
            wall: "S", roomIndex: ri,
          });
        }
      }
    }
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

    const habitable = !["bath","stairs","pooja","lift","utility","parking"].includes(r.type);
    if (!habitable) continue;
    const tol = 0.6;
    const ext: { wall: "N" | "E" | "S" | "W"; len: number }[] = [];
    if (Math.abs(r.x - fx) < tol) ext.push({ wall: "W", len: r.h });
    if (Math.abs(r.x + r.w - (fx + fw)) < tol) ext.push({ wall: "E", len: r.h });
    if (Math.abs(r.y - fy) < tol) ext.push({ wall: "N", len: r.w });
    if (Math.abs(r.y + r.h - (fy + fh)) < tol) ext.push({ wall: "S", len: r.w });
    const e = ext.sort((a, b) => b.len - a.len)[0];
    if (!e) continue;
    if (e.wall === "W") openings.push({ kind: "window", x1: r.x, y1: r.y + r.h * 0.3, x2: r.x, y2: r.y + r.h * 0.7, floor: plate.floor, t: 0.5, width: r.h * 0.4, wall: "W", roomIndex: ri });
    else if (e.wall === "E") openings.push({ kind: "window", x1: r.x + r.w, y1: r.y + r.h * 0.3, x2: r.x + r.w, y2: r.y + r.h * 0.7, floor: plate.floor, t: 0.5, width: r.h * 0.4, wall: "E", roomIndex: ri });
    else if (e.wall === "N") openings.push({ kind: "window", x1: r.x + r.w * 0.3, y1: r.y, x2: r.x + r.w * 0.7, y2: r.y, floor: plate.floor, t: 0.5, width: r.w * 0.4, wall: "N", roomIndex: ri });
    else openings.push({ kind: "window", x1: r.x + r.w * 0.3, y1: r.y + r.h, x2: r.x + r.w * 0.7, y2: r.y + r.h, floor: plate.floor, t: 0.5, width: r.w * 0.4, wall: "S", roomIndex: ri });
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
  const fp = parkingFootprint(parkingSpec);
  if (!fp || parkingSpec?.location === "outside") return undefined;

  const wall: "N" | "E" | "S" | "W" = pickEntranceWall(entranceDir);
  const door = ground.entranceDoor;
  const bays = parkingSpec!.count;
  const covered = rng() < 0.6;

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

  return { x, y, w, h, bays, covered };
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

  const planType = pickPlanType(spec);

  // If stilt parking, ground floor is parking + stairs (+optional utility).
  if (stiltParking) {
    const stilt: FlatRoom[] = [
      { type: "parking", sizePref: "medium" },
      { type: "parking", sizePref: "medium" },
      { type: "stairs", sizePref: "medium" },
    ];
    if (spec.stiltUtilityRoom) stilt.push({ type: "utility", sizePref: "small" });
    perFloor[0] = stilt;
  }

  // Inject stair on every floor when multi-floor — EXCEPT the top floor for
  // sloped/pitched roofs. There is no roof access on a pitched house, so no
  // landing/mumty should appear up there.
  if (spec.floors > 1) {
    const topFloor = spec.floors - 1;
    for (let f = 0; f < spec.floors; f++) {
      if (spec.roofStyle === "sloped" && f === topFloor) continue;
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

    const baseCurv =
      spec.curvature === "gentle" ? 0.25 : spec.curvature === "bold" ? 0.8 : 0.5;
    const curvatureLevel = Math.max(0.1, Math.min(1, baseCurv + (rng() - 0.5) * 0.25));
    const stairSide: HallSide = rng() < 0.5 ? "left" : "right";

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
        ),
      );
    }

    // Align stair shafts vertically across floors. The ground-floor stair
    // defines the canonical (x, y, w, h). On every upper floor, replace the
    // stair rect with those same coordinates AND reflow any room on the same
    // side whose vertical span overlaps the stair, by shrinking that room to
    // the remaining vertical band (front-of-stair OR back-of-stair).
    // For sloped roofs the topmost floor has no stair (no roof access), so
    // limit the alignment pass to floors that actually contain a stair.
    const lastStairFloor =
      spec.roofStyle === "sloped" ? plates.length - 1 : plates.length;
    if (plates.length > 1) {
      const groundStairs = plates[0].rooms.find((r) => r.type === "stairs");
      if (groundStairs) {
        const sx = groundStairs.x;
        const sy = groundStairs.y;
        const sw = groundStairs.w;
        const sh = groundStairs.h;
        for (let f = 1; f < lastStairFloor; f++) {
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
    for (const p of plates) p.chamfer = chamfer;

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
      parking,
      paletteAccent: accent,
      liveability,
    });
  }

  variations.sort((a, b) => b.vastuScore - a.vastuScore);
  return variations;
}
