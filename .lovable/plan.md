

## Fix wasted space + missing upper-floor stairs + keep hallway

Three targeted fixes. Hallway stays exactly as-is.

### 1. `src/lib/model-generator.ts` — rooms fill the plate, stairs reserved on every floor

**a. Remove the empty bands.** In `layoutSide`, change the room width from clamped-to-preferred to the **full sideWidth**:
```ts
const width = sideWidth;  // was: Math.min(sideWidth, Math.max(min.w, pref.w))
```
Each room now spans from the hallway edge to the outer wall — no leftover space on either side.

**b. Tighten the rounded corner so it never extends past room geometry.** After rooms are placed in `buildPlate`, derive `cornerRadius` from the smallest corner-room dimension instead of the plate min-side:
```ts
const cornerRadius = Math.min(8, smallestCornerRoomMinSide / 2);
```

**c. Reserve a real stair cell on upper floors at the same spot as the ground floor.** Today the alignment pass *moves* the upper-floor stair rect to the ground-stair coordinates — but that rect overlaps whatever room the upper-floor layout already placed there, so the stair is invisible. Fix in two parts:
- In `planFloor`, when an upper floor includes `stairs`, place it in the same `side` + `order` slot the ground-floor stair occupies (carry the ground stair's slot through `generateVariations`).
- After layout, **subtract the stair rect from the overlapping room** on that floor (shrink that room's depth so the stair sits in a clean cell), instead of just stamping coordinates.
- Result: stairs appear at the same `(x, y, w, h)` on every floor, with surrounding rooms reflowed to make room.

**d. No second front door on upper floors.** `entranceDoor` is already only set when `isGroundFloor`. Confirm and also skip pushing the entrance door into `openings` on upper floors (already correct — keep).

### 2. `src/components/model-viewer-3d.tsx` — porch/arch/door only on ground floor, stairs visible on every floor below the top

- The front porch + columns + door panel + arch block already keys off `groundPlate?.entranceDoor` and runs **once** outside the per-floor loop — already correct, leave it.
- Staircase loop currently runs `if (plate.floor < topFloor)` and looks up `plate.rooms.find(r => r.type === "stairs")`. After the generator fix above, every non-top floor will have a stair cell at the same x/z, so the existing tread-extrusion code will produce a continuous shaft going up. No 3D code change needed beyond verifying.
- One small addition: render a **simple landing slab** (flat rectangle) at the top of the staircase on each upper floor where the stairs arrive, so the 3D shows where you step off.

### 3. No changes to hallway logic
Hallway rendering in 2D and 3D is preserved exactly. The hallway rect stays at the same coordinates on every floor (it's already computed deterministically per floor). Upper floors keep the hallway so people can walk from the stair landing into rooms.

### Files changed
- `src/lib/model-generator.ts` — rooms fill `sideWidth`, `cornerRadius` derived from rooms, upper-floor stair carved into the layout (not stamped over a room).
- `src/components/model-viewer-3d.tsx` — add landing slab at top of staircase on upper floors.

### Out of scope
2D plan code, design types, wizard, route pages — no changes there.

