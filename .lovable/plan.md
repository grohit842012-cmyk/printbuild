# Photorealistic Interiors + Walk-Through Mode

Goal: make the inside of a generated house look like the reference — warm wall-wash lighting, soft shadows, real materials on floors/walls, and a first-person view you move through, instead of the current procedural blocks seen from outside.

## What you'll get

1. **New "Interior" view mode** in the 3D viewer toolbar (alongside the existing exterior/floor views)
   - Camera drops inside the house at eye height (5.5 ft) in the living room.
   - WASD + mouse-look on desktop (pointer lock), on-screen joystick + drag-look on mobile.
   - Collision against walls so you can't walk through them; doorway openings let you pass between rooms.
   - "Exit interior" button returns to the orbit view.

2. **Cinematic interior lighting**
   - Warm ceiling downlights and wall-wash strips per room (the glow-on-wall look from the reference).
   - Daylight spilling through each window/sliding door as a directional shaft.
   - Soft shadows, ambient occlusion in corners, and a subtle bloom on light sources.
   - Day/night already exists — night becomes the moody lamp-lit version, day stays bright.

3. **Real interior materials** (replacing flat colors)
   - Floors: wide-plank wood, polished concrete, or stone per design variation (keeps every model unique).
   - Walls: matte plaster with faint texture; one accent wall per living/master room in the variation's accent tone.
   - Ceilings: white matte with a recessed cove where lights sit.
   - Skirting trim line at the wall/floor junction, and door/window reveals so walls read as thick.

4. **Better furniture**
   - Rounded, upholstered forms (sofa with cushions, armchair, round coffee table, bed with headboard, dining set, kitchen counters with worktop) instead of plain boxes.
   - Rugs, a floor lamp, and framed wall art, placed against walls and clear of doorways.

## Technical notes

- Work is confined to `src/components/model-viewer-3d.tsx` plus a new `src/lib/interior-materials.ts` (per-variation palette + texture picks) and `src/components/interior-controls.tsx` (movement/collision).
- Reuse the existing `FloorPlate` / `RoomRect` / openings data — no changes to `model-generator.ts`, so plans and elevations stay as they are.
- Lighting cost is managed: lights are only instantiated for the floor currently being viewed, and shadow maps limited to nearby lights so it stays smooth on a laptop.
- Post-processing (bloom + AO) via `@react-three/postprocessing`, enabled only in interior mode.
- Textures generated procedurally in-code (canvas-based wood grain/plaster noise) so no large image downloads.

## Out of scope for this pass

- Automated camera tour on rails (can be added after).
- Interior design styling per room type beyond materials + furniture (e.g. curated decor sets).
