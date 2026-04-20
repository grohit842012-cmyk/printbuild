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
  | "courtyard";

export interface DesignSpec {
  plot: {
    widthFt: number;
    depthFt: number;
    shape: "rectangle" | "L-shape" | "irregular";
    facing: Direction;
  };
  floors: number;
  rooms: { type: RoomType; count: number; sizePref: "small" | "medium" | "large" }[];
  curvature: "gentle" | "bold" | "mixed";
  roofStyle: "flat" | "domed" | "sloped";
  windowDensity: "low" | "medium" | "high";
  exteriorFeel: string; // free text
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

// Generated parametric variation
export interface RoomLayout {
  type: RoomType;
  // Polar position on plot (cx, cy normalized to plot 0..1)
  cx: number;
  cy: number;
  // Half-widths
  rx: number;
  ry: number;
  rotationDeg: number;
  floor: number;
  curveBias: number; // 0..1 curvature for walls
}

export interface Variation {
  id: string;
  seed: number;
  curvatureLevel: number; // 0..1
  rooms: RoomLayout[];
  entranceAngleDeg: number; // 0=N, 90=E
  vastuScore: number; // 0..100
  vastuTier: "strict" | "mostly" | "partial";
  // Per-floor outline (closed bezier ring sample points)
  floorOutlines: { floor: number; points: { x: number; y: number }[] }[];
  roofType: "flat" | "domed" | "sloped";
  paletteAccent: string;
}
