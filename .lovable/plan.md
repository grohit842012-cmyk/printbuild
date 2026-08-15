# Photorealistic Interiors + Exteriors + Walk-Through Mode

Honest framing first: this runs in a browser in real time, so it won't match an offline render frame-for-frame. What the reference clip actually shows is achievable in-browser — warm wall-wash lighting, soft shadows, believable materials, and smooth first-person movement — and that is the bar I'll hold. It will look close to that. It will not look like a Corona/V-Ray still, and any promise otherwise would be a lie.

## 1. Interior view mode

- New "Interior" mode in the 3D viewer toolbar.
- Camera drops inside at eye height (5.5 ft) in the living room.
- WASD + mouse-look on desktop (pointer lock); on-screen joystick + drag-look on mobile.
- Wall collision so you can't walk through walls; door openings let you pass between rooms.
- "Exit interior" returns to the orbit view.

## 2. Cinematic lighting (interior and exterior)

- Interior: warm ceiling downlights and wall-wash strips per room (the glow-on-wall look from the reference), daylight shafts through each window/sliding door, soft shadows, corner ambient occlusion, subtle bloom on light sources.
- Exterior: a real sun position with soft shadow cascades, sky-and-ground bounce light, and a golden-hour / midday / dusk selector driving both sun angle and colour temperature.
- Day/night already exists — night becomes the lamp-lit moody version, windows glowing from outside.

## 3. Materials — interior

- Floors: wide-plank wood, polished concrete, or stone per variation (keeps every model unique).
- Walls: matte plaster with faint texture; one accent wall per living/master room in the variation's accent tone.
- Ceilings: white matte with a recessed cove where the lights sit.
- Skirting trim at the wall/floor junction; door and window reveals so walls read as thick, not paper.

## 4. Materials — exterior

- Facade surfaces get real surface response: stucco tooth, wood-batten grain, exposed-concrete mottling, stone coursing — each variation keeps its own combination so no two models look alike.
- Glass gets proper reflection and slight tint rather than flat panels; frames in the variation's accent metal.
- Ground plane becomes a site: driveway paving, a grass/gravel apron, boundary edge, and soft shadow contact where the building meets ground.
- Roof materials differentiated (tile, standing-seam metal, membrane) instead of a single flat tone.
- Existing swaying trees stay and get shadow-casting so the facade gets dappled light.

## 5. Furniture

- Rounded, upholstered forms — sofa with cushions, armchair, round coffee table, bed with headboard, dining set, kitchen counters with worktop — instead of plain boxes.
- Rugs, a floor lamp, and framed wall art, placed against walls and clear of doorways.

## Technical notes

- Work stays in `src/components/model-viewer-3d.tsx`, plus new `src/lib/interior-materials.ts` (per-variation palette and texture picks) and `src/components/interior-controls.tsx` (movement and collision).
- Reuses existing `FloorPlate` / `RoomRect` / opening data — `model-generator.ts` is untouched, so plans and elevations don't change.
- Post-processing (bloom, ambient occlusion, subtle sharpening) via `@react-three/postprocessing`.
- Textures generated procedurally in-code (canvas-based grain/noise/plaster) so there are no heavy image downloads.
- Performance guard: lights and shadow maps only instantiated for the floor in view, capped shadow resolution, and a quality toggle (High / Balanced) so it stays smooth on a laptop.

## Out of scope this pass

- Automated camera tour on rails.
- Curated per-room decor sets beyond materials and the furniture list above.
