// Design DNA — every variation gets a unique combination of architectural
// axes so no two elevations look the same. Deterministic per (seed, index)
// with a batch-level dedup guard on the visual "core" tuple.

import type { DesignSpec, Variation } from "./design-types";

export interface DesignDNA {
  massing: string;
  facade: string;
  roof: string;
  windows: string;
  signature: string;
  landscape: string;
  mood: string;
  palette: { wall: string; roof: string; trim: string; accent: string };
  name: string;
}

// ---- Vocabularies ----
const MASSING = [
  "single-storey box",
  "stepped stacked volumes",
  "cantilevered upper floor",
  "L-shaped plan wrapping a courtyard",
  "U-shaped plan around a garden",
  "split-level with half-storey shift",
  "tower + low wing",
  "twin volumes joined by a glass link",
  "wrap-around veranda base",
  "floating box on a stone plinth",
  "gabled longhouse",
  "monopitch wedge",
  "butterfly-roof pavilion",
  "podium with lightweight upper",
];

const FACADE = [
  { label: "exposed handmade brick",     wall: "#a24d31", trim: "#2a2a2a" },
  { label: "board-formed concrete",       wall: "#b8b3a8", trim: "#3a3a3a" },
  { label: "crisp white lime render",     wall: "#f2ece2", trim: "#1e1e1e" },
  { label: "charcoal render with black trim", wall: "#3d3a36", trim: "#0a0a0a" },
  { label: "weathered vertical timber",   wall: "#7a5a3a", trim: "#2f2016" },
  { label: "horizontal teak slats",       wall: "#8a5a2a", trim: "#2b1a0d" },
  { label: "terracotta jaali screen",     wall: "#c05a2b", trim: "#5a2a10" },
  { label: "corten steel panels",         wall: "#8a4a2a", trim: "#3a1e10" },
  { label: "cream Jaisalmer limestone",   wall: "#d9c48a", trim: "#5a4a2a" },
  { label: "grey granite with mortar joints", wall: "#7a7a75", trim: "#2a2a2a" },
  { label: "floor-to-ceiling glass curtain wall", wall: "#c8d8e6", trim: "#1e2a3a" },
  { label: "stone plinth + white render above", wall: "#eee8dc", trim: "#3a3a3a" },
  { label: "black burnt-timber (shou sugi ban)", wall: "#1a1a17", trim: "#0a0a0a" },
  { label: "polished stucco in warm ochre", wall: "#c69a5a", trim: "#4a3018" },
  { label: "reclaimed grey Kadappa stone",  wall: "#3a3a38", trim: "#0a0a0a" },
];

const ROOF = [
  "flat parapet roof",
  "single mono-pitch roof",
  "asymmetric gable",
  "butterfly (inverted V) roof",
  "sawtooth clerestory roof",
  "terraced roof with sky garden",
  "pergola-topped roof deck",
  "curved shell roof",
  "sloped tile roof with deep overhang",
  "green planted roof",
];

const WINDOWS = [
  "floor-to-ceiling ribbon glazing",
  "punched rectangular windows in a rhythmic grid",
  "tall arched windows",
  "geometric jaali screen fenestration",
  "corner-wrapping frameless glass",
  "vertical slot windows",
  "clerestory strip under the roofline",
  "picture window framing a specific view",
  "shuttered louver windows",
];

const SIGNATURE = [
  "double-height entry portal",
  "cantilevered first-floor balcony",
  "rooftop terrace with pergola",
  "brise-soleil vertical fins across the facade",
  "internal water court reflecting the sky",
  "single mature tree growing through a roof cut-out",
  "carved timber jaali screen wall",
  "external spiral stair as a facade feature",
  "sunken plinth with wide stone steps",
  "ribbon skylight slicing the roof",
  "deep recessed loggia across the front",
  "sculptural chimney/vent stack",
];

const LANDSCAPE = [
  "desert xeriscape with gravel and boulders",
  "dense tropical planting with palms and banana",
  "formal clipped parterre garden",
  "gravel courtyard with a single specimen tree",
  "manicured lawn edged with palms",
  "kitchen garden with raised beds",
  "bamboo grove privacy screen",
  "moss and stepping stones (Japanese)",
  "wildflower meadow front yard",
];

const MOOD = [
  { label: "golden hour, warm low sun", accent: "#e29a3a" },
  { label: "blue hour twilight with warm interior glow", accent: "#3a6bbf" },
  { label: "soft overcast morning light", accent: "#8a9baa" },
  { label: "post-monsoon dusk, wet ground reflections", accent: "#4a5a6a" },
  { label: "bright dry sunny noon", accent: "#f0c04a" },
  { label: "misty morning with soft haze", accent: "#a8b8c0" },
];

// ---- Seeded RNG ----
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

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function titleCase(s: string) {
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function nameFor(dna: Omit<DesignDNA, "name" | "palette">): string {
  // Compose a short evocative name from the DNA — always unique-feeling.
  const facadeKey = dna.facade.split(" ").slice(-1)[0];      // e.g. "brick", "concrete", "render"
  const massingKey = dna.massing.split(" ").slice(-1)[0];    // e.g. "box", "courtyard", "pavilion"
  const sigKey = dna.signature.split(" ").slice(0, 2).join(" ");
  return titleCase(`${sigKey} ${facadeKey} ${massingKey}`);
}

/** Generate `count` unique DNAs for one design batch (dedup on visual core tuple). */
export function generateDnaSet(baseSeed: number, count: number): DesignDNA[] {
  const used = new Set<string>();
  const out: DesignDNA[] = [];
  for (let i = 0; i < count; i++) {
    let attempt = 0;
    let dna: DesignDNA | null = null;
    while (attempt < 30) {
      const rng = mulberry32(baseSeed + i * 1013 + attempt * 7919);
      const massing = pick(MASSING, rng);
      const facade = pick(FACADE, rng);
      const roof = pick(ROOF, rng);
      const windows = pick(WINDOWS, rng);
      const signature = pick(SIGNATURE, rng);
      const landscape = pick(LANDSCAPE, rng);
      const mood = pick(MOOD, rng);
      const key = `${massing}|${facade.label}|${roof}|${signature}`;
      if (used.has(key)) { attempt++; continue; }
      used.add(key);
      const base: Omit<DesignDNA, "name" | "palette"> = {
        massing, facade: facade.label, roof, windows, signature, landscape, mood: mood.label,
      };
      dna = {
        ...base,
        palette: {
          wall: facade.wall,
          trim: facade.trim,
          roof: roof.includes("green") ? "#4a6a3a" : roof.includes("tile") ? "#7a3a2a" : "#3a3a38",
          accent: mood.accent,
        },
        name: nameFor(base),
      };
      break;
    }
    // Fallback if we couldn't find a unique combo (very unlikely)
    if (!dna) {
      const rng = mulberry32(baseSeed + i * 1013 + 99999);
      const facade = pick(FACADE, rng);
      const mood = pick(MOOD, rng);
      const base = {
        massing: pick(MASSING, rng),
        facade: facade.label,
        roof: pick(ROOF, rng),
        windows: pick(WINDOWS, rng),
        signature: pick(SIGNATURE, rng),
        landscape: pick(LANDSCAPE, rng),
        mood: mood.label,
      };
      dna = {
        ...base,
        palette: { wall: facade.wall, trim: facade.trim, roof: "#3a3a38", accent: mood.accent },
        name: nameFor(base),
      };
    }
    out.push(dna);
  }
  return out;
}

/** Build the image-generation prompt for an exterior render from DNA + spec. */
export function dnaToRenderPrompt(
  dna: DesignDNA,
  spec: Pick<DesignSpec, "plot" | "floors" | "rooms" | "lifestyle">,
  avoidTuples: string[] = [],
): string {
  const bedrooms = spec.rooms
    .filter((r) => r.type === "bedroom" || r.type === "master_bedroom")
    .reduce((a, b) => a + b.count, 0);
  const bhk = bedrooms > 0 ? `${bedrooms} BHK` : "";
  const plotDesc = `${spec.plot.widthFt}x${spec.plot.depthFt} ft plot`;
  const floorDesc = spec.floors === 1 ? "single-storey" : `${spec.floors}-storey`;

  const avoid =
    avoidTuples.length > 0
      ? ` Do NOT repeat these already-used combinations: ${avoidTuples
          .map((t) => `[${t}]`)
          .join(", ")}.`
      : "";

  return [
    `Ultra-photorealistic architectural exterior render of a ${floorDesc} ${bhk} residential home on a ${plotDesc}, facing ${spec.plot.facing}.`,
    `Massing: ${dna.massing}.`,
    `Primary facade material: ${dna.facade}.`,
    `Roof: ${dna.roof}.`,
    `Windows: ${dna.windows}.`,
    `Signature feature: ${dna.signature}.`,
    `Front yard: ${dna.landscape}.`,
    `Lighting & mood: ${dna.mood}.`,
    `Style must be a completely unique elevation — do not resemble a generic modern box. Show the front and one side, three-quarter view, ground level, wide angle 24mm lens. Realistic materials, physically-based rendering, sharp architectural detail, no people, no cars visible in the shot.${avoid}`,
  ].join(" ");
}

/** Fallback DNA for legacy variations that were generated before DNA support. */
export function fallbackDnaFromVariation(v: Variation, index = 0): DesignDNA {
  const dna = generateDnaSet(v.seed || index + 1, 1)[0];
  return dna;
}
