

## Improve 3D coordinates, openings, and modelling

The 3D model currently doesn't match the 2D plan because walls are drawn from a single rounded outer shell instead of from actual room rectangles. Doors and windows also float because their openings are cut from that shell, not from the wall the room actually owns. This rebuilds the 3D geometry directly from room coordinates so 3D and 2D match exactly.

### 1. `src/components/model-viewer-3d.tsx` — rebuild geometry from rooms

**a. Replace the outer rounded shell with per-room walls**
- For each room, walk its 4 sides and classify each as:
  - **Exterior** (touches plate boundary) → solid wall, full height, with windows cut where `Opening.kind === "window"` falls on this segment.
  - **Hallway-facing** (touches `plate.hallway` rect) → wall with a 3 ft door cutout at the room's `doorMid` / `doorWall`.
  - **Shared with another room** (deduped by sorted endpoint pairs so the wall is drawn once) → solid partition, no openings unless ensuite.
- Wall thickness 0.5 ft, height = `floorHeight(plate.floor)`. Build each segment as a `BoxGeometry` placed along the edge so coordinates match `RoomRect` exactly.

**b. Fix opening coordinates**
- Today `Opening` endpoints are drawn as freestanding glass planes that often miss the wall. Resolve each opening to the wall segment it belongs to (match `(x1,y1)-(x2,y2)` against room edges with 0.1 ft tolerance), then cut the hole in that wall's `BoxGeometry` via CSG-style subtraction using two flanking boxes (left jamb, right jamb, lintel, sill) instead of one plane. Window: sill at 3 ft, head at 7 ft, width from `Opening.width`. Door: sill 0, head 7 ft, width 3 ft.
- Frames + sills now sit flush in the wall plane at the wall's actual position, not floating in front.

**c. Plinth, slab, and roof from room footprint**
- Build plinth and floor slab as a merged shape of all room rectangles for the floor (use `THREE.Shape` per room, combined into an `ExtrudeGeometry`), padded outward by 0.8 ft for the plinth.
- Roof slab = same merged footprint inflated by 1.5 ft for the eave overhang. Straight edges, no rounded shell.
- Drop the global rounded-rect plate shape from 3D entirely (2D keeps it for the floor-plan clip — no change there).

**d. Wall corner curvature (walls only)**
- For rooms sitting on the building's outer corners, replace the corner edge of the two meeting exterior walls with a 1.5 ft quarter-cylinder. All other walls stay straight. Roofs and slabs stay straight-edged.

**e. Per-floor coordinate alignment**
- Use `floorBaseY(plate.floor)` consistently for plinth, walls, openings, slab, and roof so each floor stacks exactly on the one below — no half-floor gaps.
- Stair landing slab on each non-top floor sits at `floorBaseY(plate.floor + 1)` over the stair cell.

**f. Entrance porch**
- Porch slab + 2 columns + door panel + arch keyed off `groundPlate.entranceDoor` endpoints (already correct), but anchor the door panel and arch into the actual exterior wall segment now drawn there, so the porch reads as cut into the facade instead of stuck on top of it.

### 2. `src/lib/model-generator.ts` — make openings resolvable

- When pushing each `Opening`, snap its endpoints to the owning room's wall coordinates exactly (same floats, no rounding drift) so the 3D resolver in step 1b finds the wall on the first pass.
- For each window, also store `wall: "N" | "E" | "S" | "W"` and `room: roomIndex` to make resolution O(1) instead of geometric matching. Add these two optional fields to `Opening` in `src/lib/design-types.ts`.
- Ensure every habitable room emits exactly one window opening on its longest exterior wall (already intended — verify and fix if missing).

### 3. `src/lib/design-types.ts`
- Extend `Opening` with optional `wall?: "N" | "E" | "S" | "W"` and `roomIndex?: number` for fast 3D lookup. Existing data without these fields still works (3D falls back to geometric match).

### Out of scope
- 2D plan rendering (no change).
- Wizard, routes, liveability panel (no change).
- Furniture, drag-edit, terraces, payments.

### Files changed
- `src/components/model-viewer-3d.tsx` — full geometry rebuild from rooms.
- `src/lib/model-generator.ts` — snap opening coordinates, tag wall + roomIndex.
- `src/lib/design-types.ts` — add optional `wall` and `roomIndex` to `Opening`.

