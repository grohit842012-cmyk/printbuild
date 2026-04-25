import type {
  DesignSpec,
  Direction,
  FloorPlate,
  Liveability,
  Opening,
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

const ACCENTS = ["#3b6db8", "#2f5a99", "#4a7fc1", "#5b8fd1", "#264e8a", "#6ea1df"];

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
};

// ---------- Architectural minimum dimensions (ft) ----------
// Width × Depth (independent of orientation: rooms can be rotated to fit)
export const MIN_ROOM_DIMS: Record<RoomType, { w: number; h: number }> = {
  living: { w: 14, h: 16 },
  master_bedroom: { w: 12, h: 14 },
  bedroom: { w: 10, h: 10 },
  kitchen: { w: 8, h: 10 },
  dining: { w: 8, h: 10 },
  bath: { w: 5, h: 7 },
  pooja: { w: 5, h: 5 },
  study: { w: 8, h: 8 },
  courtyard: { w: 8, h: 8 },
  stairs: { w: 5, h: 8 },
};

// Preferred (target) dimensions used when there's plenty of room.
const PREF_ROOM_DIMS: Record<RoomType, { w: number; h: number }> = {
  living: { w: 16, h: 18 },
  master_bedroom: { w: 14, h: 16 },
  bedroom: { w: 11, h: 12 },
  kitchen: { w: 10, h: 12 },
  dining: { w: 10, h: 11 },
  bath: { w: 6, h: 8 },
  pooja: { w: 6, h: 6 },
  study: { w: 9, h: 10 },
  courtyard: { w: 10, h: 10 },
  stairs: { w: 5.5, h: 9 },
};

interface FlatRoom {
  type: RoomType;
  sizePref: "small" | "medium" | "large";
}

const HALLWAY_WIDTH = 3.5;
const SETBACK = 3;

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
  if (fw < 18 || fh < 22) {
    issues.push({
      floor: 0,
      message: `Plot is too small (${spec.plot.widthFt}×${spec.plot.depthFt} ft). Need at least 24×28 ft.`,
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
      r.type !== "stairs",
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
  hallwayX: number, // x position where hallway starts (the inner edge for this side)
  hallwayW: number,
  stairY?: number,
): { rooms: RoomRect[] } {
  if (zones.length === 0) return { rooms: [] };

  const orderedZones = [...zones];
  const stairIndex = orderedZones.findIndex((z) => z.type === "stairs");
  if (stairIndex > 0) {
    const [stair] = orderedZones.splice(stairIndex, 1);
    orderedZones.unshift(stair);
  }

  // Compute target depths (along corridor) for each zone, scaled to fit.
  const targets = orderedZones.map((z) => {
    const pref = PREF_ROOM_DIMS[z.type];
    // Orient long side along the hallway when sensible
    const along = Math.max(pref.w, pref.h);
    return along;
  });
  const sumTarget = targets.reduce((a, b) => a + b, 0);
  const scale = totalDepth / Math.max(1, sumTarget);

  const rooms: RoomRect[] = [];
  let cursorY = 0;
  for (let i = 0; i < orderedZones.length; i++) {
    const z = orderedZones[i];
    const min = MIN_ROOM_DIMS[z.type];
    const pref = PREF_ROOM_DIMS[z.type];

    let depth = Math.max(min.h, targets[i] * scale);
    if (z.type === "stairs") {
      depth = MIN_ROOM_DIMS.stairs.h;
    }
    // Clamp so we don't overrun
    const remaining = totalDepth - cursorY;
    const remainingZones = orderedZones.length - i;
    if (depth > remaining - (remainingZones - 1) * min.h) {
      depth = Math.max(min.h, remaining - (remainingZones - 1) * min.h);
    }
    if (i === zones.length - 1) depth = remaining; // last room takes the rest

    // Always fill the full side width so there are no empty bands between
    // the hallway and the outer wall.
    void pref;
    void min;
    const width = sideWidth;
    // Position: anchor against outer wall on this side
    const x = startWall === "left" ? hallwayX - width : hallwayX + hallwayW;
    const y = z.type === "stairs" && stairY != null ? stairY : cursorY;

    // Decide door wall: opens onto hallway → wall facing hallway
    const doorWall: "N" | "E" | "S" | "W" =
      startWall === "left" ? "E" : "W";

    rooms.push({
      type: z.type,
      x,
      y,
      w: width,
      h: depth,
      floor: floorIndex,
      label: LABEL[z.type],
      doorWall,
      doorMid: depth / 2,
    });

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

  const leftLayout = layoutSide(leftZones, sideWidth, workDepth, "left", floorIndex, hallwayLocalX, hallwayW);
  const rightLayout = layoutSide(rightZones, sideWidth, workDepth, "right", floorIndex, hallwayLocalX, hallwayW);
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
    const habitable = r.type !== "bath" && r.type !== "stairs" && r.type !== "pooja";
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

  // Keep the 2D/3D footprint tight. Large rounded clips create false-looking
  // empty corner gaps compared with real architectural plans.
  const minSide = Math.min(fw, fh);
  const cornerRadius = Math.min(1.5, minSide * 0.02 * curvatureLevel);
  void vastu; // currently unused; preferences influence entranceDir + scoring elsewhere
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

    const habitable = r.type !== "bath" && r.type !== "stairs" && r.type !== "pooja";
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

  // For multi-floor homes inject a stair shaft on every floor (if missing).
  if (spec.floors > 1) {
    for (let f = 0; f < spec.floors; f++) {
      const has = perFloor[f].some((r) => r.type === "stairs");
      if (!has) perFloor[f].push({ type: "stairs", sizePref: "medium" });
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
            if (r.type === "stairs") continue;
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
      liveability,
    });
  }

  variations.sort((a, b) => b.vastuScore - a.vastuScore);
  return variations;
}
