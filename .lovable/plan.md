# Making PrintBuild homes worth living in

Three staged passes. Each is independently shippable, so you can review after each stage before I move to the next.

---

## Stage 1 — Massing & alignment

Goal: every generated variation is structurally coherent, not just "mostly right."

- **Vertical stack contract.** Add a post-generation pass in the model generator that walks floor plates bottom-to-top and enforces: every upper plate's footprint is fully contained by (or explicitly bridged to) the plate below, no zero-width slivers, and any setback area is claimed by a terrace, balcony, or an enlarged room rather than left as a gap.
- **Recessed balconies.** Instead of hanging a slab off the facade, carve the balcony out of the upper floor footprint where the plan allows it, so the railing line sits inside the building envelope. Cantilevered balconies stay only where the DNA massing explicitly calls for a projecting deck, and those get a visible soffit and support so they read as intentional.
- **Opening reconciliation.** One shared resolver decides where every door/window/sliding opening goes, so decorations, columns, jaali screens and pergolas can never land on top of an opening. Features query the resolver for free wall area before placing themselves.
- **Alignment self-check.** A validation function that flags floating slabs, unsupported spans, walls that miss their slab edge, and stairs/mumty that break the envelope. Failed checks are auto-corrected where possible; anything left over surfaces in the design's issue list.

## Stage 2 — Photoreal materials & lighting

Goal: renders read as photographs of a built house.

- **Material library** keyed to each variation's Design DNA: lime stucco, brushed/board-formed concrete, sawn stone, teak and oak cladding, powder-coated metal, clay tile — each with proper roughness, subtle normal/bump variation, and edge wear so surfaces aren't flat-shaded.
- **Glass done right:** tinted, slightly reflective, with visible mullions and interior depth rather than a plain transparent pane.
- **Lighting rig:** a chosen sun angle per variation (golden-hour default), soft area shadows, ambient occlusion in corners and under overhangs, and a warmer tone-mapping curve.
- **Site context:** graded ground plane with driveway/paving materials, planting beds, boundary edge, and the existing swaying trees given more depth so the house sits in a place instead of on a void.
- **Per-variation color discipline:** palettes drawn from the DNA (wall / roof / trim / accent) applied consistently across walls, frames, railings and roof so no two homes look alike but each one looks coordinated.

## Stage 3 — Livability audit

Goal: the app tells you honestly whether a plan is good.

- A scoring engine that grades each variation on: natural light reach, circulation efficiency (how much area is corridor vs. living), privacy gradient (public → private zoning), storage provision, kitchen work triangle, bathroom access per bedroom, and cross-ventilation.
- Each metric gets a score, a one-line plain-English verdict, and a specific suggestion when it falls short.
- Shown as an "Architect's review" card on the inspector page, alongside the existing Vastu and climate cards, plus a compact badge in the gallery so weak plans are visible before you open them.
- Variations that score badly on multiple metrics get regenerated automatically during generation rather than shown.

---

## Technical notes

- Stage 1 touches `src/lib/model-generator.ts` (stack contract, balcony carve, validation) and `src/components/model-viewer-3d.tsx` (opening resolver, feature placement, balcony geometry).
- Stage 2 is mostly `src/components/model-viewer-3d.tsx` plus a new `src/lib/materials.ts` driven by `src/lib/design-dna.ts`. Uses procedural/noise-based texturing rather than downloaded texture maps to keep the bundle light.
- Stage 3 adds `src/lib/livability-audit.ts` and a `src/components/livability-card.tsx`, wired into `src/routes/design.$id.view.$idx.tsx` and `src/routes/design.$id.gallery.tsx`. Pure geometry analysis — no schema or backend changes.
- No database migrations required; audit scores are derived from stored variation geometry at read time.
