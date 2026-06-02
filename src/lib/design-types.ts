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
  | "stairs"
  | "lift"
  | "utility"
  | "parking";

export type StaircaseType = "straight" | "l-shape" | "u-shape" | "spiral";
export type LiftOption = "none" | "home";

export interface DesignSpec {
  plot: {
    widthFt: number;
    depthFt: number;
    shape: "rectangle" | "L-shape" | "irregular";
    facing: Direction;
  };
  floors: number;
  rooms: { type: RoomType; count: number; sizePref: "small" | "medium" | "large" }[];
  roomsPerFloor?: { type: RoomType; count: number; sizePref: "small" | "medium" | "large" }[][];
  curvature: "gentle" | "bold" | "mixed";
  roofStyle: "flat" | "sloped";
  windowDensity: "low" | "medium" | "high";
  exteriorFeel: string;
  // New: staircase, lift, parking choices
  staircaseType?: StaircaseType;
  lift?: LiftOption;
  // Dedicate ground floor to parking + stairs (stilt). Floors above are normal rooms.
  stiltParking?: boolean;
  // If stilt parking is on, include a small utility room beside the stairs.
  stiltUtilityRoom?: boolean;
  // Realistic parking spec (Rule Book v2.0 Parking Validation).
  parking?: {
    count: 0 | 1 | 2;
    vehicle: "car" | "suv";
    location: "inside" | "outside";
  };
  // Open plan = only bedrooms/baths/pooja/utility/stairs/lift get walls.
  // Closed plan = every room is walled.
  planMode?: "open" | "closed";
  // Kitchen open to dining/living vs walled-off.
  kitchenOpen?: boolean;
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
  // Optional fast-lookup tags so the 3D resolver doesn't need geometric matching
  wall?: "N" | "E" | "S" | "W";
  roomIndex?: number;
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

export type ElevationStyle =
  | "modern-minimal"
  | "mediterranean-arch"
  | "contemporary-box"
  | "tropical-veranda"
  | "art-deco"
  | "scandi-pitched";

export interface ParkingArea {
  // In plot-local feet, sits in the front setback band beside the entrance
  x: number;
  y: number;
  w: number;
  h: number;
  bays: number;
  covered: boolean;
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
  elevationStyle: ElevationStyle;
  parking?: ParkingArea;
  paletteAccent: string;
  liveability: Liveability;
}
