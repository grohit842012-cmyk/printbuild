// ---------------------------------------------------------------------------
// Stage 1 — Vertical stack contract & alignment self-check.
//
// Everything here is pure rectangle geometry on FloorPlate[]. It runs after the
// room solver has produced the plates, and guarantees that:
//   1. every upper plate is supported by the plate below it (no floating slabs)
//   2. no hairline slivers / gaps are left between stacked plates
//   3. every room sits inside its own plate (no wall missing its slab edge)
//   4. anything that could not be auto-corrected is reported as an issue string
// ---------------------------------------------------------------------------
import type { FloorPlate, RoomRect } from "./design-types";

/** Edges closer than this read as a construction error, not a design move. */
const SLIVER_FT = 1.5;
/** How far a lower plate may grow to catch an unsupported upper plate. */
const MAX_SUPPORT_GROWTH_FT = 5;
/** A plate never gets smaller than this in either direction. */
const MIN_PLATE_FT = 12;
/** A room never gets clamped below this in either direction. */
const MIN_ROOM_FT = 4;

export interface StackResult {
  /** Floors (1-based, matching FloorPlate.floor) whose geometry was rewritten. */
  changed: Set<number>;
  /** Human-readable notes for anything that could not be fully corrected. */
  issues: string[];
}

interface Box { x: number; y: number; w: number; h: number }

const right = (b: Box) => b.x + b.w;
const bottom = (b: Box) => b.y + b.h;

/**
 * Snap `upper` edges that are within SLIVER_FT of `lower` so stacked plates
 * either line up flush or step back by a real, visible amount.
 */
function snapSlivers(upper: Box, lower: Box): boolean {
  let changed = false;
  if (Math.abs(upper.x - lower.x) < SLIVER_FT && upper.x !== lower.x) {
    upper.w += upper.x - lower.x;
    upper.x = lower.x;
    changed = true;
  }
  if (Math.abs(upper.y - lower.y) < SLIVER_FT && upper.y !== lower.y) {
    upper.h += upper.y - lower.y;
    upper.y = lower.y;
    changed = true;
  }
  if (Math.abs(right(upper) - right(lower)) < SLIVER_FT && right(upper) !== right(lower)) {
    upper.w = right(lower) - upper.x;
    changed = true;
  }
  if (Math.abs(bottom(upper) - bottom(lower)) < SLIVER_FT && bottom(upper) !== bottom(lower)) {
    upper.h = bottom(lower) - upper.y;
    changed = true;
  }
  return changed;
}

/** Clamp every room of a plate inside the plate outline. */
function clampRooms(plate: FloorPlate): { rooms: RoomRect[]; changed: boolean } {
  let changed = false;
  const px1 = plate.x;
  const py1 = plate.y;
  const px2 = plate.x + plate.w;
  const py2 = plate.y + plate.h;

  const rooms = plate.rooms.map((r) => {
    const x1 = Math.max(px1, Math.min(r.x, px2 - MIN_ROOM_FT));
    const y1 = Math.max(py1, Math.min(r.y, py2 - MIN_ROOM_FT));
    const x2 = Math.min(px2, Math.max(r.x + r.w, x1 + MIN_ROOM_FT));
    const y2 = Math.min(py2, Math.max(r.y + r.h, y1 + MIN_ROOM_FT));
    const w = Math.max(MIN_ROOM_FT, x2 - x1);
    const h = Math.max(MIN_ROOM_FT, y2 - y1);
    if (
      Math.abs(x1 - r.x) > 0.01 || Math.abs(y1 - r.y) > 0.01 ||
      Math.abs(w - r.w) > 0.01 || Math.abs(h - r.h) > 0.01
    ) {
      changed = true;
      const wallLen = r.doorWall === "N" || r.doorWall === "S" ? w : h;
      const doorMid = r.doorMid == null
        ? undefined
        : Math.max(1.6, Math.min(wallLen - 1.6, r.doorMid));
      return { ...r, x: x1, y: y1, w, h, doorMid };
    }
    return r;
  });

  return { rooms, changed };
}

/** Clamp the hallway spine inside its plate. */
function clampHallway(plate: FloorPlate): FloorPlate["hallway"] {
  const hw = plate.hallway;
  if (!hw) return hw;
  const x1 = Math.max(plate.x, hw.x);
  const y1 = Math.max(plate.y, hw.y);
  const x2 = Math.min(plate.x + plate.w, hw.x + hw.w);
  const y2 = Math.min(plate.y + plate.h, hw.y + hw.h);
  if (x2 - x1 < 2 || y2 - y1 < 2) return undefined;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Enforce the vertical stack contract. Mutates `plates` in place and returns
 * which floors changed (so the caller can rebuild their openings) plus any
 * issues that remained after auto-correction.
 */
export function enforceStackContract(
  plates: FloorPlate[],
  plotW: number,
  plotD: number,
  setback: number,
): StackResult {
  const changed = new Set<number>();
  const issues: string[] = [];
  if (plates.length === 0) return { changed, issues };

  const minX = setback;
  const minY = setback;
  const maxX = plotW - setback;
  const maxY = plotD - setback;

  // Pass A (bottom-up): make sure each upper plate is carried by the one below.
  for (let i = 1; i < plates.length; i++) {
    const lower = plates[i - 1];
    const upper = plates[i];
    const box: Box = { x: upper.x, y: upper.y, w: upper.w, h: upper.h };
    let touched = snapSlivers(box, lower);

    // How far does the upper plate overhang the lower one on each side?
    const overW = lower.x - box.x;
    const overN = lower.y - box.y;
    const overE = right(box) - right(lower);
    const overS = bottom(box) - bottom(lower);
    const worst = Math.max(overW, overN, overE, overS);

    if (worst > 0.05) {
      if (worst <= MAX_SUPPORT_GROWTH_FT) {
        // Small overhang — grow the lower plate so it actually carries the load.
        const nx = Math.max(minX, Math.min(lower.x, box.x));
        const ny = Math.max(minY, Math.min(lower.y, box.y));
        const nx2 = Math.min(maxX, Math.max(right(lower), right(box)));
        const ny2 = Math.min(maxY, Math.max(bottom(lower), bottom(box)));
        if (nx2 - nx >= MIN_PLATE_FT && ny2 - ny >= MIN_PLATE_FT) {
          lower.x = nx;
          lower.y = ny;
          lower.w = nx2 - nx;
          lower.h = ny2 - ny;
          changed.add(lower.floor);
        }
      }
      // Whatever overhang survives (plot setback hit it) gets trimmed away.
      const cx = Math.max(lower.x, box.x);
      const cy = Math.max(lower.y, box.y);
      const cx2 = Math.min(right(lower), right(box));
      const cy2 = Math.min(bottom(lower), bottom(box));
      if (cx2 - cx >= MIN_PLATE_FT && cy2 - cy >= MIN_PLATE_FT) {
        if (Math.abs(cx - box.x) > 0.05 || Math.abs(cy - box.y) > 0.05 ||
            Math.abs(cx2 - right(box)) > 0.05 || Math.abs(cy2 - bottom(box)) > 0.05) {
          box.x = cx; box.y = cy; box.w = cx2 - cx; box.h = cy2 - cy;
          touched = true;
        }
      } else {
        issues.push(
          `Floor ${upper.floor}: footprint could not be fully supported by the floor below — kept as a cantilever.`,
        );
      }
    }

    // A step-back smaller than a sliver is a construction artefact; make the
    // upper plate flush so no hairline ledge is generated.
    snapSlivers(box, lower);

    if (touched) {
      upper.x = box.x;
      upper.y = box.y;
      upper.w = box.w;
      upper.h = box.h;
      changed.add(upper.floor);
    }
  }

  // Pass B: rooms + hallway must live inside their own plate.
  for (const p of plates) {
    const { rooms, changed: roomsChanged } = clampRooms(p);
    if (roomsChanged) {
      p.rooms = rooms;
      changed.add(p.floor);
    }
    const hw = clampHallway(p);
    if (hw !== p.hallway) {
      p.hallway = hw;
      changed.add(p.floor);
    }
  }

  return { changed, issues };
}

export interface SetbackBand {
  floor: number;
  side: "N" | "E" | "S" | "W";
  /** Depth of the step-back in feet — usable terrace / balcony depth. */
  depth: number;
  /** Span of the band along the wall, in feet. */
  span: number;
}

/**
 * Report every step-back between a floor and the floor below it. The 3D layer
 * turns these into real terraces / balconies so no set-back area is left as an
 * unexplained gap in the massing.
 */
export function setbackBands(plates: FloorPlate[]): SetbackBand[] {
  const bands: SetbackBand[] = [];
  for (let i = 1; i < plates.length; i++) {
    const lower = plates[i - 1];
    const upper = plates[i];
    const f = upper.floor;
    const w = Math.max(0, upper.x - lower.x);
    const n = Math.max(0, upper.y - lower.y);
    const e = Math.max(0, right(lower) - right(upper));
    const s = Math.max(0, bottom(lower) - bottom(upper));
    if (w > SLIVER_FT) bands.push({ floor: f, side: "W", depth: w, span: upper.h });
    if (e > SLIVER_FT) bands.push({ floor: f, side: "E", depth: e, span: upper.h });
    if (n > SLIVER_FT) bands.push({ floor: f, side: "N", depth: n, span: upper.w });
    if (s > SLIVER_FT) bands.push({ floor: f, side: "S", depth: s, span: upper.w });
  }
  return bands;
}

/** Read-only alignment audit — used to surface anything still wrong. */
export function alignmentIssues(plates: FloorPlate[]): string[] {
  const issues: string[] = [];
  for (let i = 1; i < plates.length; i++) {
    const lower = plates[i - 1];
    const upper = plates[i];
    const over = Math.max(
      lower.x - upper.x,
      lower.y - upper.y,
      right(upper) - right(lower),
      bottom(upper) - bottom(lower),
    );
    if (over > 0.05) {
      issues.push(`Floor ${upper.floor}: overhangs the floor below by ${over.toFixed(1)}′.`);
    }
  }
  for (const p of plates) {
    for (const r of p.rooms) {
      if (
        r.x < p.x - 0.05 || r.y < p.y - 0.05 ||
        r.x + r.w > p.x + p.w + 0.05 || r.y + r.h > p.y + p.h + 0.05
      ) {
        issues.push(`Floor ${p.floor}: ${r.label} breaks the building outline.`);
      }
    }
  }
  return issues;
}
