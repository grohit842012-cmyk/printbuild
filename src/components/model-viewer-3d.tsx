import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Sky } from "@react-three/drei";
import { useEffect, useMemo, useState, Suspense, type ReactElement } from "react";
import * as THREE from "three";
import type { Variation, FloorPlate, RoomRect, Opening } from "@/lib/design-types";

const FLOOR_HEIGHT = 10; // ft
const WALL_THICKNESS = 0.45;
const FT_TO_M = 0.3048;

const ROOM_COLORS: Record<string, string> = {
  living: "#f5e9d4",
  kitchen: "#f1c9a5",
  bedroom: "#dbe5d2",
  master_bedroom: "#c5d3b8",
  bath: "#cfe1ec",
  pooja: "#f3d9a4",
  study: "#e3dccb",
  dining: "#e8c9a8",
  courtyard: "#bdd9b6",
  stairs: "#d6c2a4",
  lift: "#a3a8b0",
  utility: "#d8d1be",
  parking: "#e8b46a",
};

const PUBLIC_OPEN = new Set(["living", "dining", "kitchen", "courtyard"]);

interface Props {
  variation: Variation;
  planMode?: "open" | "closed";
  kitchenOpen?: boolean;
}

function paletteFor(variation: Variation) {
  const dna = variation.dna;
  const facade = dna?.facade.toLowerCase() ?? "";
  const wall = dna?.palette.wall ?? variation.paletteAccent ?? "#c98a4b";
  const trim = dna?.palette.trim ?? "#fbf6ec";
  const accent = dna?.palette.accent ?? variation.paletteAccent ?? "#c98a4b";
  const roof = dna?.palette.roof ?? (variation.roofType === "sloped" ? "#a83e1a" : "#3a3a38");
  const material = facade.includes("brick")
    ? "brick"
    : facade.includes("timber") || facade.includes("teak")
      ? "timber"
      : facade.includes("jaali") || facade.includes("terracotta")
        ? "jaali"
        : facade.includes("glass")
          ? "glass"
          : facade.includes("stone") || facade.includes("granite") || facade.includes("limestone")
            ? "stone"
            : facade.includes("corten")
              ? "corten"
              : "render";
  return { wall, trim, accent, roof, material };
}

function isOpen(type: string, planMode: string, kitchenOpen: boolean) {
  if (planMode !== "open") return false;
  if (type === "kitchen") return kitchenOpen;
  return PUBLIC_OPEN.has(type);
}

/** Convert plot-local coords (ft) to scene coords (m) centered on plot. */
function makeToScene(plotW: number, plotD: number) {
  const cx = plotW / 2;
  const cy = plotD / 2;
  return (xFt: number, yFt: number): [number, number] => [
    (xFt - cx) * FT_TO_M,
    (yFt - cy) * FT_TO_M,
  ];
}

/* -------------------- Wall segments with door/window cutouts -------------------- */

interface Seg { a: number; b: number } // along the wall in ft

function subtractOpenings(wallStart: number, wallEnd: number, cuts: Seg[]): Seg[] {
  let segs: Seg[] = [{ a: wallStart, b: wallEnd }];
  for (const c of cuts) {
    const next: Seg[] = [];
    for (const s of segs) {
      if (c.b <= s.a || c.a >= s.b) { next.push(s); continue; }
      if (c.a > s.a) next.push({ a: s.a, b: Math.max(s.a, c.a) });
      if (c.b < s.b) next.push({ a: Math.min(s.b, c.b), b: s.b });
    }
    segs = next.filter(s => s.b - s.a > 0.05);
  }
  return segs;
}

/** Outer perimeter wall built per side, with door/window cutouts and windows on top. */
function PerimeterWalls({ plate, variation }: { plate: FloorPlate; variation: Variation }) {
  const t = WALL_THICKNESS * FT_TO_M;
  const h = FLOOR_HEIGHT * FT_TO_M;
  const winTop = 7 * FT_TO_M;
  const winBot = 3 * FT_TO_M;
  const doorH = 7 * FT_TO_M;

  const palette = paletteFor(variation);
  const base = new THREE.Color(palette.wall);
  const tint = new THREE.Color(palette.accent);
  const wall = base.clone().lerp(tint, palette.material === "render" ? 0.18 : 0.05);
  const WALL_COLOR = `#${wall.getHexString()}`;
  const TRIM_COLOR = palette.trim;
  const DOOR_COLOR = "#5a3a22";   // walnut

  const tol = 0.6;
  const byWall: Record<"N" | "E" | "S" | "W", { o: Opening; isDoor: boolean; a: number; b: number }[]> = {
    N: [], E: [], S: [], W: [],
  };
  for (const o of plate.openings) {
    const onN = Math.abs(o.y1 - plate.y) < tol && Math.abs(o.y2 - plate.y) < tol;
    const onS = Math.abs(o.y1 - (plate.y + plate.h)) < tol && Math.abs(o.y2 - (plate.y + plate.h)) < tol;
    const onW = Math.abs(o.x1 - plate.x) < tol && Math.abs(o.x2 - plate.x) < tol;
    const onE = Math.abs(o.x1 - (plate.x + plate.w)) < tol && Math.abs(o.x2 - (plate.x + plate.w)) < tol;
    if (!(onN || onS || onW || onE)) continue;
    const isDoor = o.kind === "door";
    // Doors only allowed on the exterior if it's the front entrance door (matched against plate.entranceDoor).
    if (isDoor && plate.entranceDoor) {
      const ed = plate.entranceDoor;
      const same = Math.abs(ed.x1 - o.x1) < 0.01 && Math.abs(ed.y1 - o.y1) < 0.01 && Math.abs(ed.x2 - o.x2) < 0.01 && Math.abs(ed.y2 - o.y2) < 0.01;
      if (!same) continue;
    } else if (isDoor) {
      continue;
    }
    if (onN) byWall.N.push({ o, isDoor, a: Math.min(o.x1, o.x2) - plate.x, b: Math.max(o.x1, o.x2) - plate.x });
    else if (onS) byWall.S.push({ o, isDoor, a: Math.min(o.x1, o.x2) - plate.x, b: Math.max(o.x1, o.x2) - plate.x });
    else if (onW) byWall.W.push({ o, isDoor, a: Math.min(o.y1, o.y2) - plate.y, b: Math.max(o.y1, o.y2) - plate.y });
    else byWall.E.push({ o, isDoor, a: Math.min(o.y1, o.y2) - plate.y, b: Math.max(o.y1, o.y2) - plate.y });
  }

  const segments: ReactElement[] = [];
  let key = 0;

  const buildSide = (
    side: "N" | "S" | "E" | "W",
    length: number,
    fixedCoord: number,
  ) => {
    const cuts = byWall[side].map(c => ({ a: c.a, b: c.b }));
    const solid = subtractOpenings(0, length, cuts);
    for (const s of solid) {
      const segLen = (s.b - s.a) * FT_TO_M;
      const segMid = ((s.a + s.b) / 2) * FT_TO_M;
      const lx = side === "N" || side === "S" ? segMid - (plate.w / 2) * FT_TO_M : (fixedCoord - plate.w / 2) * FT_TO_M;
      const lz = side === "E" || side === "W" ? segMid - (plate.h / 2) * FT_TO_M : (fixedCoord - plate.h / 2) * FT_TO_M;
      const args: [number, number, number] = side === "N" || side === "S"
        ? [segLen, h, t]
        : [t, h, segLen];
      segments.push(
        <mesh key={`w${key++}`} position={[lx, h / 2, lz]} castShadow receiveShadow>
          <boxGeometry args={args} />
          <meshStandardMaterial color={WALL_COLOR} roughness={palette.material === "glass" ? 0.18 : 0.85} metalness={palette.material === "corten" ? 0.35 : 0.02} />
        </mesh>,
      );
    }
    for (const c of byWall[side]) {
      const segLen = (c.b - c.a) * FT_TO_M;
      const segMid = ((c.a + c.b) / 2) * FT_TO_M;
      const lx = side === "N" || side === "S" ? segMid - (plate.w / 2) * FT_TO_M : (fixedCoord - plate.w / 2) * FT_TO_M;
      const lz = side === "E" || side === "W" ? segMid - (plate.h / 2) * FT_TO_M : (fixedCoord - plate.h / 2) * FT_TO_M;
      if (c.isDoor) {
        const lintelH = h - doorH;
        const lintelArgs: [number, number, number] = side === "N" || side === "S" ? [segLen, lintelH, t] : [t, lintelH, segLen];
        segments.push(
          <mesh key={`l${key++}`} position={[lx, doorH + lintelH / 2, lz]} castShadow receiveShadow>
            <boxGeometry args={lintelArgs} />
            <meshStandardMaterial color={WALL_COLOR} roughness={palette.material === "glass" ? 0.18 : 0.85} metalness={palette.material === "corten" ? 0.35 : 0.02} />
          </mesh>,
        );
        // door frame trim
        const frameArgs: [number, number, number] = side === "N" || side === "S" ? [segLen, 0.15, t * 1.05] : [t * 1.05, 0.15, segLen];
        segments.push(
          <mesh key={`df${key++}`} position={[lx, doorH + 0.02, lz]}>
            <boxGeometry args={frameArgs} />
            <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
          </mesh>,
        );
        const dArgs: [number, number, number] = side === "N" || side === "S" ? [segLen * 0.95, doorH * 0.98, t * 0.45] : [t * 0.45, doorH * 0.98, segLen * 0.95];
        segments.push(
          <mesh key={`d${key++}`} position={[lx, doorH / 2, lz]} castShadow>
            <boxGeometry args={dArgs} />
            <meshStandardMaterial color={DOOR_COLOR} roughness={0.45} metalness={0.05} />
          </mesh>,
        );
      } else {
        const sillH = winBot;
        const lintelH = h - winTop;
        const sillArgs: [number, number, number] = side === "N" || side === "S" ? [segLen, sillH, t] : [t, sillH, segLen];
        segments.push(
          <mesh key={`s${key++}`} position={[lx, sillH / 2, lz]} castShadow receiveShadow>
            <boxGeometry args={sillArgs} />
            <meshStandardMaterial color={WALL_COLOR} roughness={palette.material === "glass" ? 0.18 : 0.85} metalness={palette.material === "corten" ? 0.35 : 0.02} />
          </mesh>,
        );
        // sill band (trim)
        const sillTrimArgs: [number, number, number] = side === "N" || side === "S" ? [segLen * 1.05, 0.15, t * 1.1] : [t * 1.1, 0.15, segLen * 1.05];
        segments.push(
          <mesh key={`st${key++}`} position={[lx, sillH + 0.02, lz]}>
            <boxGeometry args={sillTrimArgs} />
            <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
          </mesh>,
        );
        const lintelArgs: [number, number, number] = side === "N" || side === "S" ? [segLen, lintelH, t] : [t, lintelH, segLen];
        segments.push(
          <mesh key={`li${key++}`} position={[lx, winTop + lintelH / 2, lz]} castShadow receiveShadow>
            <boxGeometry args={lintelArgs} />
            <meshStandardMaterial color={WALL_COLOR} roughness={palette.material === "glass" ? 0.18 : 0.85} metalness={palette.material === "corten" ? 0.35 : 0.02} />
          </mesh>,
        );
        // top trim under lintel
        segments.push(
          <mesh key={`lt${key++}`} position={[lx, winTop - 0.02, lz]}>
            <boxGeometry args={sillTrimArgs} />
            <meshStandardMaterial color={TRIM_COLOR} roughness={0.6} />
          </mesh>,
        );
        const glassArgs: [number, number, number] = side === "N" || side === "S" ? [segLen * 0.9, (winTop - winBot) * 0.95, t * 0.2] : [t * 0.2, (winTop - winBot) * 0.95, segLen * 0.9];
        segments.push(
          <mesh key={`g${key++}`} position={[lx, (winTop + winBot) / 2, lz]}>
            <boxGeometry args={glassArgs} />
            <meshPhysicalMaterial
              color="#bcdcf2"
              transmission={0.7}
              opacity={0.55}
              transparent
              roughness={0.05}
              thickness={0.05}
              metalness={0.2}
            />
          </mesh>,
        );
      }
    }
  };

  buildSide("N", plate.w, 0);
  buildSide("S", plate.w, plate.h);
  buildSide("W", plate.h, 0);
  buildSide("E", plate.h, plate.w);

  return <group>{segments}</group>;
}

function FloorMesh({
  plate, baseY, variation, planMode, kitchenOpen, plotW, plotD,
}: { plate: FloorPlate; baseY: number; variation: Variation; planMode: string; kitchenOpen: boolean; plotW: number; plotD: number }) {
  const toScene = makeToScene(plotW, plotD);
  const cx = plate.x + plate.w / 2;
  const cz = plate.y + plate.h / 2;
  const [sx, sz] = toScene(cx, cz);
  return (
    <group position={[sx, baseY, sz]}>
      {/* plinth/foundation extending down to ground */}
      {baseY < 0.01 && (
        <mesh position={[0, -0.6, 0]} receiveShadow castShadow>
          <boxGeometry args={[plate.w * FT_TO_M + 0.4, 1.2, plate.h * FT_TO_M + 0.4]} />
          <meshStandardMaterial color="#bdb3a4" roughness={0.95} />
        </mesh>
      )}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[plate.w * FT_TO_M, 0.1, plate.h * FT_TO_M]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.9} />
      </mesh>
      <PerimeterWalls plate={plate} variation={variation} />
      {plate.rooms.map((r, i) => (
        <RoomBlock key={i} room={r} plate={plate} planMode={planMode} kitchenOpen={kitchenOpen} />
      ))}
    </group>
  );
}

function RoomBlock({
  room, plate, planMode, kitchenOpen,
}: { room: RoomRect; plate: FloorPlate; planMode: string; kitchenOpen: boolean }) {
  const localX = (room.x + room.w / 2) - (plate.x + plate.w / 2);
  const localZ = (room.y + room.h / 2) - (plate.y + plate.h / 2);
  const w = room.w * FT_TO_M;
  const d = room.h * FT_TO_M;
  const h = (FLOOR_HEIGHT - 0.5) * FT_TO_M;
  const color = ROOM_COLORS[room.type] ?? "#e2e8f0";
  const open = isOpen(room.type, planMode, kitchenOpen);

  return (
    <group position={[localX * FT_TO_M, 0, localZ * FT_TO_M]}>
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <boxGeometry args={[w * 0.96, 0.02, d * 0.96]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {!open && room.type !== "stairs" && room.type !== "lift" && room.type !== "parking" && (
        <RoomWalls w={w} d={d} h={h} room={room} />
      )}
      {room.type === "stairs" && (() => {
        // Switchback (U-shape) staircase: two flights running in OPPOSITE directions
        // with a mid-landing. Realistic riser 0.18m / tread 0.27m.
        const riser = 0.18;
        const tread = 0.27;
        const totalRise = h + 0.05;
        const nSteps = Math.max(4, Math.ceil(totalRise / riser));
        const stepsF1 = Math.ceil(nSteps / 2);
        const stepsF2 = nSteps - stepsF1;
        const alongZ = d >= w;
        // Run length per flight (along the long axis), leaving room for the landing at the far end.
        const longDim = alongZ ? d : w;
        const shortDim = alongZ ? w : d;
        const landingDepth = Math.max(tread * 2.2, 0.9);
        const flightRun = Math.max(tread * 2, longDim * 0.9 - landingDepth);
        const treadAdj = flightRun / Math.max(stepsF1, stepsF2); // shrink tread if cramped
        const stepWidth = shortDim * 0.45;
        const sideOff = stepWidth / 2 + 0.04; // half-width gap between the two flights
        const treadGeom: [number, number, number] = alongZ
          ? [stepWidth, 0.04, treadAdj]
          : [treadAdj, 0.04, stepWidth];
        // Flight 1: starts at near end (-long/2), climbs toward landing at +long/2 end.
        // Flight 2: starts at landing, goes BACK in opposite direction (+long/2 → -long/2).
        const renderFlight = (
          sideSign: 1 | -1,
          dir: 1 | -1,
          baseY: number,
          count: number,
        ) =>
          Array.from({ length: count }).map((_, k) => {
            const stepY = baseY + (k + 1) * riser;
            // start position along long axis
            const startAlong = dir === 1 ? -longDim / 2 + 0.05 : longDim / 2 - 0.05;
            const along = startAlong + dir * (k + 0.5) * treadAdj;
            const sideX = sideSign * sideOff;
            const px = alongZ ? sideX : along;
            const pz = alongZ ? along : sideX;
            return (
              <group key={`f-${sideSign}-${k}`}>
                {/* riser (vertical face on the back of each step) */}
                <mesh position={[
                  alongZ ? px : px - dir * treadAdj / 2,
                  stepY - riser / 2,
                  alongZ ? pz - dir * treadAdj / 2 : pz,
                ]}>
                  <boxGeometry args={alongZ ? [stepWidth, riser, 0.04] : [0.04, riser, stepWidth]} />
                  <meshStandardMaterial color="#e2d6c2" roughness={0.85} />
                </mesh>
                {/* tread */}
                <mesh position={[px, stepY, pz]} castShadow receiveShadow>
                  <boxGeometry args={treadGeom} />
                  <meshStandardMaterial color="#7a5a3a" roughness={0.55} />
                </mesh>
              </group>
            );
          });
        const flight1TopY = stepsF1 * riser;
        // Landing sits at the +long end, between the two flights.
        const landingPos: [number, number, number] = alongZ
          ? [0, flight1TopY + 0.02, longDim / 2 - landingDepth / 2 - 0.02]
          : [longDim / 2 - landingDepth / 2 - 0.02, flight1TopY + 0.02, 0];
        const landingSize: [number, number, number] = alongZ
          ? [stepWidth * 2 + sideOff * 0.5, 0.06, landingDepth]
          : [landingDepth, 0.06, stepWidth * 2 + sideOff * 0.5];
        return (
          <group>
            {/* Flight 1 — runs forward (+) on left side */}
            {renderFlight(-1, 1, 0, stepsF1)}
            {/* Mid-landing at far end */}
            <mesh position={landingPos} castShadow receiveShadow>
              <boxGeometry args={landingSize} />
              <meshStandardMaterial color="#8a6a44" roughness={0.6} />
            </mesh>
            {/* Flight 2 — runs OPPOSITE direction (-) on right side, starting from landing */}
            {renderFlight(1, -1, flight1TopY, stepsF2)}
          </group>
        );
      })()}
      {/* Lift cab is rendered as a single full-height shaft by <LiftShaft/>
          at the top level — nothing per-floor here. */}
      {room.type === "parking" && (
        <group>
          <mesh position={[0, 0.02, 0]} receiveShadow>
            <boxGeometry args={[w * 0.98, 0.04, d * 0.98]} />
            <meshStandardMaterial color="#f7c873" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[w * 0.55, 0.7, d * 0.4]} />
            <meshStandardMaterial color="#1e3a6e" roughness={0.4} metalness={0.3} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function RoomWalls({ w, d, h, room }: { w: number; d: number; h: number; room: RoomRect }) {
  const t = WALL_THICKNESS * 0.5 * FT_TO_M;
  const doorH = 7 * FT_TO_M;
  const doorW = 3 * FT_TO_M;
  const mat = <meshStandardMaterial color="#f8fafc" roughness={0.85} />;

  // Compute door gap center along the wall (local coords, wall centered at 0)
  // doorMid is in feet from the room's origin along the door wall
  const wall = room.doorWall;
  const midFt = room.doorMid ?? 0;
  // For N/S walls the door runs along x (room width = w in scene-m)
  // For E/W walls the door runs along z (room depth = d in scene-m)
  const wallAlongX = wall === "N" || wall === "S";
  const wallLenScene = wallAlongX ? w : d;
  // midFt is measured from room.x (for N/S) or room.y (for E/W), origin at one end
  // Local axis goes from -wallLenScene/2 to +wallLenScene/2
  const midLocal = midFt * FT_TO_M - wallLenScene / 2;
  const half = doorW / 2;
  const lo = Math.max(-wallLenScene / 2, midLocal - half);
  const hi = Math.min(wallLenScene / 2, midLocal + half);

  // Render a wall as up to two segments (before + after door gap), plus a lintel above the door.
  const renderWall = (
    isN: boolean, isS: boolean, isE: boolean, isW: boolean,
    key: string,
  ) => {
    const hasDoor =
      (isN && wall === "N") || (isS && wall === "S") ||
      (isE && wall === "E") || (isW && wall === "W");
    const alongX = isN || isS;
    const wallZ = isN ? -d / 2 : isS ? d / 2 : 0;
    const wallX = isW ? -w / 2 : isE ? w / 2 : 0;
    const fullLen = alongX ? w : d;

    if (!hasDoor) {
      return (
        <mesh key={key} position={[wallX, h / 2, wallZ]} castShadow receiveShadow>
          <boxGeometry args={alongX ? [fullLen, h, t] : [t, h, fullLen]} />
          {mat}
        </mesh>
      );
    }

    const segments: ReactElement[] = [];
    // Segment 1: from -L/2 to lo
    const seg1Len = lo - (-fullLen / 2);
    if (seg1Len > 0.02) {
      const seg1Center = (-fullLen / 2 + lo) / 2;
      segments.push(
        <mesh key={`${key}-a`} position={[alongX ? seg1Center : wallX, h / 2, alongX ? wallZ : seg1Center]} castShadow receiveShadow>
          <boxGeometry args={alongX ? [seg1Len, h, t] : [t, h, seg1Len]} />
          {mat}
        </mesh>,
      );
    }
    // Segment 2: from hi to L/2
    const seg2Len = fullLen / 2 - hi;
    if (seg2Len > 0.02) {
      const seg2Center = (hi + fullLen / 2) / 2;
      segments.push(
        <mesh key={`${key}-b`} position={[alongX ? seg2Center : wallX, h / 2, alongX ? wallZ : seg2Center]} castShadow receiveShadow>
          <boxGeometry args={alongX ? [seg2Len, h, t] : [t, h, seg2Len]} />
          {mat}
        </mesh>,
      );
    }
    // Lintel above the door
    const lintelLen = hi - lo;
    if (lintelLen > 0.02) {
      const lintelCenter = (lo + hi) / 2;
      const lintelH = h - doorH;
      segments.push(
        <mesh key={`${key}-l`} position={[alongX ? lintelCenter : wallX, doorH + lintelH / 2, alongX ? wallZ : lintelCenter]} castShadow receiveShadow>
          <boxGeometry args={alongX ? [lintelLen, lintelH, t] : [t, lintelH, lintelLen]} />
          {mat}
        </mesh>,
      );
    }
    return <group key={key}>{segments}</group>;
  };

  return (
    <group>
      {renderWall(true, false, false, false, "N")}
      {renderWall(false, true, false, false, "S")}
      {renderWall(false, false, false, true, "W")}
      {renderWall(false, false, true, false, "E")}
    </group>
  );
}

function Roof({ variation, topY }: { variation: Variation; topY: number }) {
  const top = variation.plates[variation.plates.length - 1];
  const cx = top.x + top.w / 2;
  const cz = top.y + top.h / 2;
  const w = top.w * FT_TO_M;
  const d = top.h * FT_TO_M;
  const toScene = makeToScene(variation.plotWidthFt, variation.plotDepthFt);
  const [sx, sz] = toScene(cx, cz);
  const center: [number, number, number] = [sx, topY, sz];
  const TRIM = "#fbfaf6";

  // Domed roof option removed — only flat/sloped remain.
  if (variation.roofType === "sloped") {
    const ridgeH = Math.min(w, d) * 0.35;
    // Hipped roof using a 4-sided pyramid sized to the building footprint
    return (
      <group position={center}>
        {/* eaves slab */}
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.6, 0.1, d + 0.6]} />
          <meshStandardMaterial color={TRIM} roughness={0.7} />
        </mesh>
        {/* terracotta hipped roof */}
        <mesh position={[0, 0.1 + ridgeH / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[Math.max(w, d) * 0.62, ridgeH, 4]} />
          <meshStandardMaterial color="#a83e1a" roughness={0.65} />
        </mesh>
      </group>
    );
  }
  // flat — slab + parapet (in cream trim) + optional mumty (stair room) for multi-floor
  const topStair = top.rooms.find((r) => r.type === "stairs");
  const hasMumty = variation.plates.length > 1 && !!topStair;
  return (
    <group position={center}>
      <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.4, 0.2, d + 0.4]} />
        <meshStandardMaterial color="#cdb89a" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.5, -d / 2 - 0.1]} castShadow>
        <boxGeometry args={[w + 0.6, 0.7, 0.25]} />
        <meshStandardMaterial color={TRIM} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.5, d / 2 + 0.1]} castShadow>
        <boxGeometry args={[w + 0.6, 0.7, 0.25]} />
        <meshStandardMaterial color={TRIM} roughness={0.7} />
      </mesh>
      <mesh position={[-w / 2 - 0.1, 0.5, 0]} castShadow>
        <boxGeometry args={[0.25, 0.7, d + 0.6]} />
        <meshStandardMaterial color={TRIM} roughness={0.7} />
      </mesh>
      <mesh position={[w / 2 + 0.1, 0.5, 0]} castShadow>
        <boxGeometry args={[0.25, 0.7, d + 0.6]} />
        <meshStandardMaterial color={TRIM} roughness={0.7} />
      </mesh>
      {hasMumty && topStair && (() => {
        // Small "stair room" sitting on top of the flat roof, directly above the stair shaft.
        // Door faces the side with the most open terrace (largest clearance to the plate edge).
        const mw = (topStair.w + 1) * FT_TO_M;
        const md = (topStair.h + 1) * FT_TO_M;
        const mh = 8 * FT_TO_M;
        const stairCx = topStair.x + topStair.w / 2;
        const stairCz = topStair.y + topStair.h / 2;
        const topCx = top.x + top.w / 2;
        const topCz = top.y + top.h / 2;
        const mx = (stairCx - topCx) * FT_TO_M;
        const mz = (stairCz - topCz) * FT_TO_M;
        const wallT = WALL_THICKNESS * FT_TO_M;
        const doorW = 3 * FT_TO_M;
        const doorH = 6.5 * FT_TO_M;
        const wallMat = <meshStandardMaterial color="#e6cfa8" roughness={0.85} />;
        const trimMat = <meshStandardMaterial color={TRIM} roughness={0.7} />;

        // Pick door side: maximum clearance from stair shaft to top-plate edge.
        const distW = stairCx - topStair.w / 2 - top.x;
        const distE = top.x + top.w - (stairCx + topStair.w / 2);
        const distN = stairCz - topStair.h / 2 - top.y; // plot N = -y → -z in scene
        const distS = top.y + top.h - (stairCz + topStair.h / 2);
        const sides = [
          { side: "S", d: distS },
          { side: "N", d: distN },
          { side: "E", d: distE },
          { side: "W", d: distW },
        ] as const;
        const door = sides.reduce((a, b) => (b.d > a.d ? b : a)).side;

        // Helper: a wall with a centered door cutout on the named side.
        const wallWithDoor = (side: "N" | "S" | "E" | "W") => {
          const isNS = side === "N" || side === "S";
          const fullLen = isNS ? mw : md;
          const segLen = (fullLen - doorW) / 2;
          const lintelH = mh - doorH;
          const z = side === "S" ? md / 2 : side === "N" ? -md / 2 : 0;
          const x = side === "E" ? mw / 2 : side === "W" ? -mw / 2 : 0;
          const a1 = -fullLen / 2 + segLen / 2;
          const a2 = fullLen / 2 - segLen / 2;
          return (
            <>
              {/* two flanking segments */}
              <mesh position={isNS ? [a1, mh / 2, z] : [x, mh / 2, a1]} castShadow receiveShadow>
                <boxGeometry args={isNS ? [segLen, mh, wallT] : [wallT, mh, segLen]} />{wallMat}
              </mesh>
              <mesh position={isNS ? [a2, mh / 2, z] : [x, mh / 2, a2]} castShadow receiveShadow>
                <boxGeometry args={isNS ? [segLen, mh, wallT] : [wallT, mh, segLen]} />{wallMat}
              </mesh>
              {/* lintel */}
              <mesh position={isNS ? [0, doorH + lintelH / 2, z] : [x, doorH + lintelH / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={isNS ? [doorW, lintelH, wallT] : [wallT, lintelH, doorW]} />{wallMat}
              </mesh>
            </>
          );
        };

        // Solid wall on a side (no door).
        const solidWall = (side: "N" | "S" | "E" | "W") => {
          const isNS = side === "N" || side === "S";
          const z = side === "S" ? md / 2 : side === "N" ? -md / 2 : 0;
          const x = side === "E" ? mw / 2 : side === "W" ? -mw / 2 : 0;
          return (
            <mesh position={isNS ? [0, mh / 2, z] : [x, mh / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={isNS ? [mw, mh, wallT] : [wallT, mh, md]} />{wallMat}
            </mesh>
          );
        };

        const allSides: ("N" | "S" | "E" | "W")[] = ["N", "S", "E", "W"];
        return (
          <group position={[mx, 0.2, mz]}>
            {allSides.map((s) =>
              s === door
                ? <group key={s}>{wallWithDoor(s)}</group>
                : <group key={s}>{solidWall(s)}</group>
            )}
            {/* Flat roof slab on top of the mumty */}
            <mesh position={[0, mh + 0.1, 0]} castShadow receiveShadow>
              <boxGeometry args={[mw + 0.3, 0.2, md + 0.3]} />{trimMat}
            </mesh>
          </group>
        );
      })()}
    </group>
  );
}

function LiftShaft({ variation }: { variation: Variation }) {
  // Find the lift on the ground floor — it's aligned across all floors.
  const ground = variation.plates[0];
  const lift = ground.rooms.find((r) => r.type === "lift");
  if (!lift) return null;
  const toScene = makeToScene(variation.plotWidthFt, variation.plotDepthFt);
  const cx = lift.x + lift.w / 2;
  const cz = lift.y + lift.h / 2;
  const [sx, sz] = toScene(cx, cz);

  const cabW = lift.w * FT_TO_M;
  const cabD = lift.h * FT_TO_M;
  const floors = variation.plates.length;
  const cabH = floors * FLOOR_HEIGHT * FT_TO_M;
  // 1.5 ft mechanism band above the top floor housing the motor + counterweight.
  const mechH = 1.5 * FT_TO_M;
  const wallT = 0.08; // thin glazed wall

  const doorH = 7 * FT_TO_M;
  const doorW = Math.min(3 * FT_TO_M, Math.min(cabW, cabD) * 0.7);
  // Door faces hallway → same side as the room's doorWall in plate coords.
  // Plate +y is south = +z in scene; -y is north = -z; +x = +x.
  const wall = lift.doorWall ?? "E";
  const isNS = wall === "N" || wall === "S";
  const doorAxisLen = isNS ? cabW : cabD;
  const segLen = (doorAxisLen - doorW) / 2;

  // Frame + glass material
  const frame = <meshStandardMaterial color="#1f2937" roughness={0.4} metalness={0.6} />;
  const glass = (
    <meshPhysicalMaterial
      color="#bcdcf2"
      transmission={0.85}
      opacity={0.35}
      transparent
      roughness={0.05}
      thickness={0.05}
      metalness={0.2}
    />
  );

  // Render one shaft side: solid glass if no door on that wall, or two
  // glass segments flanking a door opening with a frame lintel.
  const renderSide = (side: "N" | "S" | "E" | "W") => {
    const along = side === "N" || side === "S";
    const fullLen = along ? cabW : cabD;
    const pos = side === "S" ? cabD / 2 : side === "N" ? -cabD / 2
      : side === "E" ? cabW / 2 : -cabW / 2;
    const rotY = along ? 0 : Math.PI / 2;
    const hasDoor = side === wall;
    if (!hasDoor) {
      // Solid glass pane (per-floor; we tile vertically so each floor reads as glazed)
      return (
        <group key={side} position={along ? [0, cabH / 2, pos] : [pos, cabH / 2, 0]} rotation={[0, rotY, 0]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[fullLen, cabH, wallT]} />
            {glass}
          </mesh>
        </group>
      );
    }
    // Per-floor: glass segments flanking the door + lintel above each floor's door.
    return (
      <group key={side} position={along ? [0, 0, pos] : [pos, 0, 0]} rotation={[0, rotY, 0]}>
        {Array.from({ length: floors }).map((_, fi) => {
          const baseY = fi * FLOOR_HEIGHT * FT_TO_M;
          const lintelH = FLOOR_HEIGHT * FT_TO_M - doorH;
          return (
            <group key={fi} position={[0, baseY, 0]}>
              {segLen > 0.02 && (
                <>
                  <mesh position={[-fullLen / 2 + segLen / 2, FLOOR_HEIGHT * FT_TO_M / 2, 0]} castShadow receiveShadow>
                    <boxGeometry args={[segLen, FLOOR_HEIGHT * FT_TO_M, wallT]} />
                    {glass}
                  </mesh>
                  <mesh position={[fullLen / 2 - segLen / 2, FLOOR_HEIGHT * FT_TO_M / 2, 0]} castShadow receiveShadow>
                    <boxGeometry args={[segLen, FLOOR_HEIGHT * FT_TO_M, wallT]} />
                    {glass}
                  </mesh>
                </>
              )}
              {/* lintel above door */}
              <mesh position={[0, doorH + lintelH / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[doorW + 0.18, lintelH, wallT]} />
                {frame}
              </mesh>
              {/* polished door frame surround (slightly proud) */}
              <mesh position={[-doorW / 2 - 0.04, doorH / 2, wallT * 0.6]} castShadow>
                <boxGeometry args={[0.08, doorH, wallT * 1.2]} />
                <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.85} />
              </mesh>
              <mesh position={[doorW / 2 + 0.04, doorH / 2, wallT * 0.6]} castShadow>
                <boxGeometry args={[0.08, doorH, wallT * 1.2]} />
                <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.85} />
              </mesh>
              <mesh position={[0, doorH + 0.04, wallT * 0.6]} castShadow>
                <boxGeometry args={[doorW + 0.16, 0.08, wallT * 1.2]} />
                <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.85} />
              </mesh>
              {/* two brushed-steel sliding door leaves with a thin centre seam */}
              <mesh position={[-doorW / 4 - 0.005, doorH / 2, wallT * 0.55]} castShadow receiveShadow>
                <boxGeometry args={[doorW / 2 - 0.01, doorH - 0.04, wallT * 0.45]} />
                <meshStandardMaterial color="#9aa3ad" roughness={0.35} metalness={0.85} />
              </mesh>
              <mesh position={[doorW / 4 + 0.005, doorH / 2, wallT * 0.55]} castShadow receiveShadow>
                <boxGeometry args={[doorW / 2 - 0.01, doorH - 0.04, wallT * 0.45]} />
                <meshStandardMaterial color="#9aa3ad" roughness={0.35} metalness={0.85} />
              </mesh>
              {/* threshold strip at floor */}
              <mesh position={[0, 0.02, wallT * 0.6]} castShadow>
                <boxGeometry args={[doorW + 0.1, 0.04, wallT * 1.3]} />
                <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.7} />
              </mesh>
              {/* call panel beside the door + tiny indicator light */}
              <mesh position={[doorW / 2 + 0.18, doorH * 0.55, wallT * 0.7]} castShadow>
                <boxGeometry args={[0.12, 0.32, 0.02]} />
                <meshStandardMaterial color="#1f2937" roughness={0.35} metalness={0.6} />
              </mesh>
              <mesh position={[doorW / 2 + 0.18, doorH * 0.7, wallT * 0.72]}>
                <boxGeometry args={[0.05, 0.05, 0.015]} />
                <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.8} />
              </mesh>
              {/* floor indicator above lintel */}
              <mesh position={[0, doorH + lintelH * 0.6, wallT * 0.7]}>
                <boxGeometry args={[0.45, 0.12, 0.02]} />
                <meshStandardMaterial color="#0b1220" roughness={0.4} />
              </mesh>
            </group>
          );
        })}
      </group>
    );
  };

  return (
    <group position={[sx, 0, sz]}>
      {/* Shaft floor */}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[cabW, 0.04, cabD]} />
        <meshStandardMaterial color="#475569" roughness={0.6} />
      </mesh>
      {renderSide("N")}
      {renderSide("S")}
      {renderSide("E")}
      {renderSide("W")}
      {/* Corner frame posts */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sxn, szn], i) => (
        <mesh key={i} position={[sxn * (cabW / 2), cabH / 2, szn * (cabD / 2)]} castShadow>
          <boxGeometry args={[0.12, cabH, 0.12]} />
          {frame}
        </mesh>
      ))}
      {/* Mechanism housing on top — solid box, slightly larger than cab. */}
      <mesh position={[0, cabH + mechH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[cabW + 0.25, mechH, cabD + 0.25]} />
        <meshStandardMaterial color="#3f4654" roughness={0.7} metalness={0.4} />
      </mesh>
    </group>
  );
}

function Plot({ variation }: { variation: Variation }) {
  const w = variation.plotWidthFt * FT_TO_M;
  const d = variation.plotDepthFt * FT_TO_M;
  return (
    <group>
      {/* Lawn */}
      <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w + 6, d + 6]} />
        <meshStandardMaterial color="#3f6b3a" roughness={0.95} />
      </mesh>
      {/* Driveway hint */}
      <mesh position={[0, -0.09, d / 2 + 1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w * 0.6, 2]} />
        <meshStandardMaterial color="#52525b" roughness={0.85} />
      </mesh>
    </group>
  );
}

function ParkingArea({ variation }: { variation: Variation }) {
  if (!variation.parking) return null;
  const p = variation.parking;
  const toScene = makeToScene(variation.plotWidthFt, variation.plotDepthFt);

  return (
    <group>
      {p.bays > 0 && (() => {
        const cx = p.x + p.w / 2;
        const cz = p.y + p.h / 2;
        const [sx, sz] = toScene(cx, cz);
        return (
          <group position={[sx, 0.02, sz]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[p.w * FT_TO_M, p.h * FT_TO_M]} />
              <meshStandardMaterial color="#f7c873" roughness={0.85} />
            </mesh>
            {Array.from({ length: Math.max(1, p.bays - 1) }).map((_, i) => (
              <mesh key={i} position={[((i + 1) / p.bays - 0.5) * p.w * FT_TO_M, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.1, p.h * FT_TO_M * 0.9]} />
                <meshStandardMaterial color="#fff" />
              </mesh>
            ))}
            <mesh position={[0, 0.4, 0]} castShadow>
              <boxGeometry args={[p.w * FT_TO_M * 0.45, 0.6, p.h * FT_TO_M * 0.3]} />
              <meshStandardMaterial color="#1e3a6e" roughness={0.5} metalness={0.3} />
            </mesh>
          </group>
        );
      })()}
      {p.bikeBays && p.bikeBays.count > 0 && (() => {
        const b = p.bikeBays;
        const cx = b.x + b.w / 2;
        const cz = b.y + b.h / 2;
        const [sx, sz] = toScene(cx, cz);
        const alongX = b.w >= b.h;
        return (
          <group position={[sx, 0.02, sz]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[b.w * FT_TO_M, b.h * FT_TO_M]} />
              <meshStandardMaterial color="#d6b48a" roughness={0.9} />
            </mesh>
            {Array.from({ length: b.count }).map((_, i) => {
              const t = (i + 0.5) / b.count - 0.5;
              const ox = alongX ? t * b.w * FT_TO_M : 0;
              const oz = alongX ? 0 : t * b.h * FT_TO_M;
              return (
                <group key={i} position={[ox, 0, oz]} rotation={[0, alongX ? 0 : Math.PI / 2, 0]}>
                  {/* two wheels */}
                  <mesh position={[0, 0.3, -0.6]} rotation={[0, 0, Math.PI / 2]} castShadow>
                    <torusGeometry args={[0.3, 0.04, 8, 16]} />
                    <meshStandardMaterial color="#111" roughness={0.6} />
                  </mesh>
                  <mesh position={[0, 0.3, 0.6]} rotation={[0, 0, Math.PI / 2]} castShadow>
                    <torusGeometry args={[0.3, 0.04, 8, 16]} />
                    <meshStandardMaterial color="#111" roughness={0.6} />
                  </mesh>
                  {/* frame */}
                  <mesh position={[0, 0.45, 0]} castShadow>
                    <boxGeometry args={[0.08, 0.08, 1.2]} />
                    <meshStandardMaterial color="#b03a2e" roughness={0.45} metalness={0.4} />
                  </mesh>
                  {/* seat */}
                  <mesh position={[0, 0.7, 0.35]} castShadow>
                    <boxGeometry args={[0.1, 0.08, 0.25]} />
                    <meshStandardMaterial color="#1a1a1a" roughness={0.7} />
                  </mesh>
                  {/* handlebar */}
                  <mesh position={[0, 0.85, -0.55]} castShadow>
                    <boxGeometry args={[0.5, 0.05, 0.05]} />
                    <meshStandardMaterial color="#1a1a1a" roughness={0.7} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })()}
    </group>
  );
}

export function ModelViewer3D({ variation, planMode = "closed", kitchenOpen = false }: Props) {
  const [mounted, setMounted] = useState(false);
  const [visibleFloor, setVisibleFloor] = useState<"all" | number>("all");
  useEffect(() => setMounted(true), []);
  const baseYs = useMemo(
    () => variation.plates.map((_, i) => i * FLOOR_HEIGHT * FT_TO_M),
    [variation],
  );
  const topY = baseYs[baseYs.length - 1] + FLOOR_HEIGHT * FT_TO_M;
  const camDist = Math.max(variation.plotWidthFt, variation.plotDepthFt) * FT_TO_M * 1.4;

  if (!mounted) {
    return <div className="w-full aspect-[4/3] rounded-xl bg-gradient-to-br from-orange-200 via-rose-300 to-indigo-700 grid place-items-center text-xs text-white/80">Loading 3D model…</div>;
  }
  return (
    <div className="w-full aspect-[4/3] rounded-xl overflow-hidden relative">
      <div className="absolute top-2 left-2 z-10 flex gap-1 bg-background/85 backdrop-blur rounded-md p-1 border border-border">
        <button
          onClick={() => setVisibleFloor("all")}
          className={`text-xs px-2 py-1 rounded ${visibleFloor === "all" ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
        >All</button>
        {variation.plates.map((p) => (
          <button
            key={p.floor}
            onClick={() => setVisibleFloor(p.floor)}
            className={`text-xs px-2 py-1 rounded ${visibleFloor === p.floor ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
          >Floor {p.floor}</button>
        ))}
      </div>
      <Canvas
        shadows
        camera={{ position: [camDist, camDist * 0.8, camDist], fov: 45 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Suspense fallback={null}>
          {/* Sunset sky */}
          <Sky
            distance={450000}
            sunPosition={[-1, 0.18, 0.6]}
            inclination={0.49}
            azimuth={0.25}
            turbidity={8}
            rayleigh={3}
            mieCoefficient={0.012}
            mieDirectionalG={0.85}
          />
          <fog attach="fog" args={["#f6c79a", camDist * 2, camDist * 6]} />
          <ambientLight intensity={0.45} color="#ffd9b3" />
          {/* Warm sunset key light */}
          <directionalLight
            position={[-camDist * 1.2, camDist * 0.6, camDist * 0.8]}
            intensity={1.6}
            color="#ffb070"
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-camDist}
            shadow-camera-right={camDist}
            shadow-camera-top={camDist}
            shadow-camera-bottom={-camDist}
          />
          {/* Cool fill from opposite side */}
          <directionalLight position={[camDist, camDist * 0.7, -camDist * 0.6]} intensity={0.4} color="#9ec9ff" />
          <Environment preset="sunset" />
          <Plot variation={variation} />
          <ParkingArea variation={variation} />
          {variation.plates
            .map((plate, i) => ({ plate, i }))
            .filter(({ plate }) => visibleFloor === "all" || plate.floor === visibleFloor)
            .map(({ plate, i }) => (
              <FloorMesh
                key={plate.floor}
                plate={plate}
                baseY={baseYs[i]}
                accent={variation.paletteAccent}
                planMode={planMode}
                kitchenOpen={kitchenOpen}
                plotW={variation.plotWidthFt}
                plotD={variation.plotDepthFt}
              />
            ))}
          {visibleFloor === "all" && <Roof variation={variation} topY={topY} />}
          {visibleFloor === "all" && <LiftShaft variation={variation} />}
          <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={camDist * 2.5} blur={2.4} far={camDist} />
          <OrbitControls
            enablePan={false}
            minDistance={camDist * 0.6}
            maxDistance={camDist * 2.8}
            maxPolarAngle={Math.PI / 2.05}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
