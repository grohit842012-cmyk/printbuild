
## Goal

Every one of the 10 generated designs is a **one-of-a-kind elevation** — no two look alike, no repeating style presets. Each variation still respects the user's plot, BHK, floors, room-size preferences, and Vastu, and each gets its own photorealistic exterior render and richer illustrated 2D plan.

## How uniqueness is guaranteed (no fixed style list)

Instead of a fixed catalog of 10 styles, each variation gets a **freshly composed design DNA** — a random-but-coherent combination sampled per variation, seeded by `designId + variationIndex` (deterministic per design, unique across variations):

- **Massing** — cuboidal, stepped, cantilevered, L-shape, wrap-around, split-level, tower-and-wing, courtyard, floating box, gabled, monopitch, butterfly-roof…
- **Facade material** — exposed brick, board-formed concrete, white render, charcoal render, weathered timber, teak slats, terracotta jaali, corten steel, limestone, granite, glass curtain, stone plinth + render…
- **Roof form** — flat, mono-pitch, gable, butterfly, sawtooth, terraced with sky garden, pergola-topped, curved shell…
- **Window rhythm** — floor-to-ceiling ribbon, punched rectangles, arched, jaali screen, corner glass, vertical slot, clerestory strip…
- **Signature move** (exactly one per variation) — double-height entry, cantilevered balcony, rooftop terrace, brise-soleil, water-court, tree-well, jaali screen wall, spiral external stair, sunken plinth, ribbon skylight…
- **Landscaping** — desert xeriscape, tropical dense, formal parterre, gravel + boulders, lawn + palms, kitchen garden, bamboo grove…
- **Mood / time of day** — golden hour, blue hour, overcast morning, monsoon dusk, dry sunny noon, twilight with warm interior glow…

A deterministic seeded RNG picks one from each axis per variation, with a **guard** that runs across the 10 variations in a single design and rejects any duplicate `(massing, facade, roof, signature)` combination — resampling until every variation has a distinct core. Additionally, each variation's render prompt includes an explicit *"do not repeat these exact combinations already used: […]"* clause to push the image model toward visible differentiation.

The style name shown to the user is generated from the chosen DNA (e.g. *"Cantilevered Corten Court"*, *"Jaali-Screened Terrace House"*) — never a preset label.

## What each variation gets

1. **A unique design DNA** (as above), stored on the variation.
2. **A photorealistic exterior render** generated per variation via Lovable AI Gateway (`openai/gpt-image-2`, `quality: "low"`, streamed). Prompt is built from the DNA plus plot size, BHK, floors, orientation, and an exclusion list of previously-used DNAs from the same design.
3. **The existing interactive 3D model**, with materials tinted from the DNA (walls, roof, trim) — no geometry rebuild in this pass (that's tracked separately in `.lovable/plan.md`).
4. **A richer illustrated 2D plan** — room labels with sq ft, dimension ticks on outer walls, north arrow, scale bar, furniture symbols (bed / sofa / dining / WC / kitchen counter / car), hatched walls, door swing arcs, window mullions, accent tint from the DNA.

## User-visible flow

- **Gallery**: 10 cards, each showing its unique render + generated style name + BHK/sqft. Renders stream in progressively (blur → sharp) on first view; then cached.
- **Variation view**: hero render on top, interactive 3D + illustrated 2D plan below, a short caption listing the DNA (materials, roof, signature move).
- **Fallback**: if a render fails (moderation / credits / rate limit), show a Three.js still with a "Retry render" button — never blocks the page.

## Technical changes

### Data model (`src/lib/design-types.ts`)
Extend `Variation`:
```ts
dna: {
  massing: string;
  facade: string;
  roof: string;
  windows: string;
  signature: string;
  landscape: string;
  mood: string;
  palette: { wall: string; roof: string; trim: string; accent: string };
  name: string;               // generated, e.g. "Cantilevered Corten Court"
}
renderUrl?: string;
```

### DNA generator (`src/lib/design-dna.ts`, new)
- Axis vocabularies + weighted samplers.
- `seededRng(designId, index)` for deterministic-per-variation randomness.
- `generateDnaSet(designId, n)` returns `n` unique DNAs (dedup by core tuple).
- `dnaToPrompt(dna, spec)` builds the image prompt including the exclusion list.
- `dnaToName(dna)` composes the display name.

### Variation generation (`src/lib/model-generator.ts`)
- After building the 10 variations, attach one DNA to each via `generateDnaSet`.
- Feed `dna.palette` into materials used by the 3D viewer.

### Render pipeline
- **New**: server route `src/routes/api/generate-render.ts` — raw HTTP handler that streams SSE from AI Gateway (`createServerFn` can't stream). Body pass-through, no buffering.
- **New**: `src/lib/streamImage.ts` — client helper using `eventsource-parser` + `flushSync` (per `ai-image-generation` knowledge).
- **New**: Supabase Storage bucket `design-renders` (public read). On `image_generation.completed`, upload the PNG and PATCH `renderUrl` into the design's `generated_variations` JSON.
- Renders are **lazy**: only generated the first time a variation card/view is opened. Never auto-regenerated on spec edits — user clicks "Regenerate".

### 2D plan (`src/components/floor-plan-2d.tsx`)
- Add SVG `<pattern>` hatched wall fill.
- Furniture symbols per room type.
- Dimension lines with ticks on the outer envelope.
- North arrow + scale bar.
- Door swing arcs, window mullion lines.
- Accent color from `variation.dna.palette.accent`.

### 3D (`src/components/model-viewer-3d.tsx`)
- Read `variation.dna.palette` for wall / roof / trim materials only. No geometry changes.

### Routes
- `src/routes/design.$id.gallery.tsx`: card shows `renderUrl` or streams it in. Style name + BHK/sqft caption.
- `src/routes/design.$id.view.$idx.tsx`: hero render on top; 3D + illustrated 2D below; DNA caption block.

## Out of scope
- Interior renders (exterior only for this pass).
- Furnishing the 3D model.
- Rebuilding 3D geometry from room rectangles (already tracked in `.lovable/plan.md`).
- Auto-regenerating renders on spec edits.

## Files touched
- **new**: `src/lib/design-dna.ts`, `src/lib/streamImage.ts`, `src/routes/api/generate-render.ts`, Supabase migration for `design-renders` bucket
- **edited**: `src/lib/design-types.ts`, `src/lib/model-generator.ts`, `src/components/floor-plan-2d.tsx`, `src/components/model-viewer-3d.tsx`, `src/routes/design.$id.gallery.tsx`, `src/routes/design.$id.view.$idx.tsx`

Approve and I'll build it end-to-end.
