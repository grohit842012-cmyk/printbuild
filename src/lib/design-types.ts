// Domain types for design specs and generated models.

export type Direction = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type RoomType =
  | "living"
  | "kitchen"
  | "bedroom"
  | "master_bedroom"
  | "bath"
  | "pooja"
  | "study"
  | "dining"
  | "courtyard"
  | "stairs";

export interface DesignSpec {
  plot: {
    widthFt: number;
    depthFt: number;
    shape: "rectangle" | "L-shape" | "irregular";
    facing: Direction;
  };
  floors: number;
  rooms: { type: RoomType; count: number; sizePref: "small" | "medium" | "large" }[];
  // Optional per-floor breakdown (floor 1 = ground floor). When present, this
  // overrides `rooms` for layout generation. Length should match `floors`.
  roomsPerFloor?: { type: RoomType; count: number; sizePref: "small" | "medium" | "large" }[][];
  curvature: "gentle" | "bold" | "mixed";
  roofStyle: "flat" | "domed" | "sloped";
  windowDensity: "low" | "medium" | "high";
  exteriorFeel: string;
  lifestyle: {
    familySize: number;
    workFromHome: boolean;
    entertaining: boolean;
    notes: string;
  };
}

export interface VastuPreferences {
  follow: "strict" | "flexible" | "none";
  entranceDirection?: Direction;
  poojaRoom: boolean;
  poojaDirection?: Direction;
  kitchenDirection?: Direction;
  masterBedroomDirection?: Direction;
  waterDirection?: Direction;
  courtyard: boolean;
  notes?: string;
}

// Architectural room rectangle on a floor plate (units = feet).
export interface RoomRect {
  type: RoomType;
  // Bottom-left corner + size in feet, with North = -y (top of plan)
  x: number;
  y: number;
  w: number;
  h: number;
  floor: number;
  label: string;
  // Optional: where the door from this room enters the hallway / parent room.
  // Stored as midpoint of door + which wall side it sits on.
  doorWall?: "N" | "E" | "S" | "W";
  doorMid?: number; // along the wall in feet, from the room's origin
}

// A door or window on one of the room's walls
export interface Opening {
  kind: "door" | "window";
  // Wall the opening sits on, expressed as endpoints in feet
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  floor: number;
  // Position along the wall (0..1) and width in feet
  t: number;
  width: number;
}

// Floor plate = the building footprint for a floor (in feet).
export interface FloorPlate {
  floor: number;
  // Outer rectangle in feet
  x: number;
  y: number;
  w: number;
  h: number;
  // Corner radius in feet (0 = sharp, >0 = rounded corners)
  cornerRadius: number;
  // Optional chamfer cut size at NE corner in feet (for L-shape feel) — 0 = none
  chamfer: number;
  rooms: RoomRect[];
  openings: Opening[];
  // The hallway corridor for this floor (light-gray spine in 2D).
  hallway?: { x: number; y: number; w: number; h: number };
  // The front door for this floor (only floor 1 typically).
  entranceDoor?: Opening;
}

export interface Liveability {
  hallway: boolean;
  bedroomsHaveWindows: boolean;
  bathroomsPrivate: boolean;
  entranceCorrect: boolean;
  stairsAligned: boolean;
  issues: string[];
}

export interface Variation {
  id: string;
  seed: number;
  curvatureLevel: number; // 0..1 — drives corner radius
  // Per-floor architectural plate
  plates: FloorPlate[];
  // Plot dimensions in feet (for scale)
  plotWidthFt: number;
  plotDepthFt: number;
  entranceDirection: Direction;
  entranceAngleDeg: number;
  vastuScore: number;
  vastuTier: "strict" | "mostly" | "partial";
  roofType: "flat" | "domed" | "sloped";
  paletteAccent: string;
  liveability: Liveability;
}
