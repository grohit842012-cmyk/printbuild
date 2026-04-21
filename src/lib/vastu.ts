import type { Direction, RoomType, VastuPreferences, RoomRect } from "./design-types";

// Compass: 0 = N, increases clockwise.
export const DIRECTION_ANGLES: Record<Direction, number> = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};

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

/** Direction of a point relative to plate center. y increases downward (south). */
export function pointToDirection(cx: number, cy: number, centerX: number, centerY: number): Direction {
  const dx = cx - centerX;
  const dy = cy - centerY;
  // North = -dy. Angle clockwise from north.
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const normalized = (angle + 360) % 360;
  const dirs: Direction[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(normalized / 45) % 8];
}

export interface VastuScoreResult {
  score: number;
  tier: "strict" | "mostly" | "partial";
  conflicts: string[];
}

export function scoreVastu(
  rooms: RoomRect[],
  prefs: VastuPreferences,
  entranceDirection: Direction,
  plateCenter: { x: number; y: number },
): VastuScoreResult {
  if (prefs.follow === "none") {
    return { score: 100, tier: "strict", conflicts: [] };
  }

  let total = 0;
  let earned = 0;
  const conflicts: string[] = [];

  if (prefs.entranceDirection) {
    total += 20;
    if (prefs.entranceDirection === entranceDirection) earned += 20;
    else conflicts.push(`Entrance ${entranceDirection}, prefers ${prefs.entranceDirection}`);
  }

  for (const room of rooms.filter((r) => r.floor === 1)) {
    const ideal = VASTU_IDEAL[room.type];
    if (!ideal || ideal.length === 0) continue;
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;
    const actual = pointToDirection(cx, cy, plateCenter.x, plateCenter.y);
    total += 10;
    if (ideal.includes(actual)) earned += 10;
    else if (ideal.some((d) => Math.abs(DIRECTION_ANGLES[d] - DIRECTION_ANGLES[actual]) <= 45)) {
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
