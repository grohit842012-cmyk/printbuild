import type { ElevationStyle, Variation } from "./design-types";

export type Climate = "tropical" | "hot-dry" | "temperate" | "cold" | "coastal";

export interface ClimateFit {
  best: Climate[];
  avoid: Climate[];
  notes: string;
}

const STYLE_FIT: Record<ElevationStyle, ClimateFit> = {
  "tropical-veranda": {
    best: ["tropical", "coastal"],
    avoid: ["cold"],
    notes: "Deep verandas + cross ventilation suit hot, humid climates.",
  },
  "mediterranean-arch": {
    best: ["hot-dry", "coastal"],
    avoid: ["cold"],
    notes: "Thick walls + arched openings handle hot-dry sun and sea breeze.",
  },
  "modern-minimal": {
    best: ["temperate", "hot-dry"],
    avoid: [],
    notes: "Flat roofs and large glazing — best where rain & snow are moderate.",
  },
  "contemporary-box": {
    best: ["temperate", "tropical"],
    avoid: ["cold"],
    notes: "Cantilevered shades cut sun; flat-roof drainage matters in monsoon.",
  },
  "art-deco": {
    best: ["temperate", "coastal"],
    avoid: ["cold"],
    notes: "Stepped massing & curved bays look great in coastal or temperate light.",
  },
  "scandi-pitched": {
    best: ["cold", "temperate"],
    avoid: ["tropical"],
    notes: "Steep pitched roofs shed snow; insulation-friendly form.",
  },
};

export function climateFit(style: ElevationStyle): ClimateFit {
  return STYLE_FIT[style];
}

export function climateLabel(c: Climate): string {
  return c === "hot-dry" ? "Hot-dry"
    : c.charAt(0).toUpperCase() + c.slice(1);
}

/** Pick top N variations by combined Vastu + liveability score. */
export function recommendVariations(variations: Variation[], n = 3): Set<string> {
  const scored = variations.map((v) => {
    const live = v.liveability;
    const liveScore =
      (live.hallway ? 1 : 0) +
      (live.bedroomsHaveWindows ? 1 : 0) +
      (live.bathroomsPrivate ? 1 : 0) +
      (live.entranceCorrect ? 1 : 0) +
      (live.stairsAligned ? 1 : 0);
    return { id: v.id, score: v.vastuScore + liveScore * 4 };
  });
  scored.sort((a, b) => b.score - a.score);
  return new Set(scored.slice(0, n).map((s) => s.id));
}
