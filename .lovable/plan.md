

## Fix all critical liveability issues

Rebuild the layout engine to produce real, liveable homes with hallways, proper doors, realistic room sizes, and add architectural detail to the 3D view plus a liveability check on the inspector.

### 1. `src/lib/design-types.ts`
- Add `entranceDoor: Opening` to `FloorPlate`.
- Add `hallway?: { x: number; y: number; w: number; h: number }` to `FloorPlate` so the 2D and liveability check can render/verify it.
- Add to `Variation`:
  ```ts
  liveability: {
    hallway: boolean;
    bedroomsHaveWindows: boolean;
    bathroomsPrivate: boolean;
    entranceCorrect: boolean;
    stairsAligned: boolean;
    issues: string[];
  }
  ```

### 2. `src/lib/model-generator.ts` — full layout rewrite
Replace the quadrant BSP inside `buildPlate` with a residential pipeline:

- **Entrance**: cut a 3.5 ft front door on the facade matching the requested Vastu direction (fallback: longest street-facing wall).
- **Hallway spine**: 3.5 ft wide corridor running from the front door to the back of the plate; perpendicular branch added when bedroom count ≥ 3.
- **Stair shaft**: placed flush against the hallway (not floating), vertically aligned across all floors (keep existing alignment pass).
- **Zoning**:
  - Public zone (front, near entrance): living, dining, kitchen — sharing walls.
  - Private zone (rear): bedrooms grouped together, each touching one exterior wall.
  - Master bedroom: largest exterior corner + ensuite bath.
  - Pooja: NE if Vastu enabled, accessed from hallway.
  - Bathrooms: clustered on a single plumbing wall, back-to-back with kitchen where possible.
- **Fixed minimum room sizes** (reject + surface error if plot too small):
  bedroom ≥ 10×10, master ≥ 12×14, bath ≥ 5×7, kitchen ≥ 8×10, living ≥ 14×16, dining ≥ 8×10, pooja ≥ 5×5.
- **Doors**: each room gets exactly one door onto the hallway (ensuite exception). Bathroom doors never face kitchen or pooja (validate + rotate door wall if conflict).
- **Windows**: at least one per habitable room, on the longest exterior wall.
- **Liveability scoring**: after placing rooms, evaluate the 5 checks and store on `Variation.liveability`.

### 3. `src/components/floor-plan-2d.tsx`
- Render the hallway as a distinct light-gray corridor below room fills.
- Render the front door as a clearly marked opening with a swing arc and "Entry" label.
- Render per-room door swing arcs (quarter-circle).
- Keep existing rounded-corner clip path.

### 4. `src/components/model-viewer-3d.tsx`
- **Plinth**: 1.5 ft stone base extruded under the building footprint.
- **Per-floor heights**: ground 11 ft, upper floors 10 ft (currently uniform).
- **Roof overhang**: extrude roof slab 1.5 ft beyond wall plate on all sides.
- **Front porch**: small slab + 2 columns + visible door cutout at the entrance wall.
- **Window frames**: add sill + lintel band geometry around each window opening (not just glass plane).
- Keep wall corner curvature; do NOT curve the roof.

### 5. `src/routes/design.$id.view.$idx.tsx`
Add a "Liveability check" panel above the "Book it" button showing the 5 checks from `variation.liveability` with green check / red cross icons and the `issues[]` list. Booking button stays enabled — warnings are advisory.

### 6. `src/routes/design.new.tsx`
On submit, if any floor's room set violates minimum dimensions for the plot, show a toast explaining which room won't fit and block submission.

### Out of scope this round
Furniture icons, drag-to-edit, terraces/setbacks, walkthrough camera, payments, structural validation.

### Files changed
- `src/lib/design-types.ts`
- `src/lib/model-generator.ts`
- `src/components/floor-plan-2d.tsx`
- `src/components/model-viewer-3d.tsx`
- `src/routes/design.$id.view.$idx.tsx`
- `src/routes/design.new.tsx`

