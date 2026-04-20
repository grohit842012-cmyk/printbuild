import type { Direction, RoomType, VastuPreferences, RoomLayout } from "./design-types";

// Compass angle in degrees: 0 = N, increasing clockwise.
export const DIRECTION_ANGLES: Record<Direction, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

// Ideal Vastu directions per room type.
export const VASTU_IDEAL: Partial<Record<RoomType, Direction[]>> = {
  pooja: ["NE"],
  kitchen: ["SE", "NW"],
  master_bedroom: ["SW"],
  bedroom: ["W", "S", "SW"],
  living: ["N", "E", "NE"],
  bath: ["NW", "W"],
  study: ["W", "NW", "N"],
  dining: ["W", "E"],
  courtyard: ["NE", "E", "N"],
};

/** Convert a (cx, cy) in 0..1 plot coords to a compass direction relative to center. */
export function pointToDirection(cx: number, cy: number): Direction {
  const dx = cx - 0.5;
  // y in image: 0=top=North. Convert: northVec = (0,-1)
  const dy = cy - 0.5;
  // angle from north, clockwise
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const normalized = (angle + 360) % 360;
  // Snap to nearest 45°
  const dirs: Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(normalized / 45) % 8;
  return dirs[idx];
}

export interface VastuScoreResult {
  score: number; // 0..100
  tier: "strict" | "mostly" | "partial";
  conflicts: string[];
}

/** Score a layout against Vastu rules + user preferences. */
export function scoreVastu(
  rooms: RoomLayout[],
  prefs: VastuPreferences,
  entranceDirection: Direction,
): VastuScoreResult {
  if (prefs.follow === "none") {
    return { score: 100, tier: "strict", conflicts: [] };
  }

  let total = 0;
  let earned = 0;
  const conflicts: string[] = [];

  // Entrance check
  if (prefs.entranceDirection) {
    total += 20;
    if (prefs.entranceDirection === entranceDirection) earned += 20;
    else conflicts.push(`Entrance is ${entranceDirection}, prefers ${prefs.entranceDirection}`);
  }

  // Per-room ideal direction
  for (const room of rooms.filter((r) => r.floor === 1)) {
    const ideal = VASTU_IDEAL[room.type];
    if (!ideal || ideal.length === 0) continue;
    const actual = pointToDirection(room.cx, room.cy);
    total += 10;
    if (ideal.includes(actual)) earned += 10;
    else if (
      ideal.some((d) => Math.abs(DIRECTION_ANGLES[d] - DIRECTION_ANGLES[actual]) <= 45)
    ) {
      earned += 5;
      conflicts.push(`${room.type} in ${actual} (prefers ${ideal.join("/")})`);
    } else {
      conflicts.push(`${room.type} in ${actual} (prefers ${ideal.join("/")})`);
    }
  }

  const score = total === 0 ? 100 : Math.round((earned / total) * 100);
  const tier: "strict" | "mostly" | "partial" =
    score >= 90 ? "strict" : score >= 65 ? "mostly" : "partial";
  return { score, tier, conflicts };
}
