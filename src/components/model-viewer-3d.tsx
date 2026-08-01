import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Sky } from "@react-three/drei";
import { useEffect, useMemo, useState, useRef, Suspense, type ReactElement } from "react";
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
  variant?: "default" | "tour";
  timeOfDay?: "day" | "night";
  autoRotate?: boolean;
  showFurniture?: boolean;
}

function paletteFor(variation: Variation) {
  const dna = variation.dna;
  const facade = dna?.facade.toLowerCase() ?? "";
  const wall = dna?.palette.wall ?? variation.paletteAccent ?? "#c98a4b";
  const trim = dna?.palette.trim ?? "#fbf6ec";
  const accent = dna?.palette.accent ?? variation.paletteAccent ?? "#c98a4b";
  // Force a dark roof palette — user asked for dark roofs on every design.
  const DARK_ROOFS = ["#2a2622", "#1f1d1c", "#3a2a20", "#242a2e", "#1c1c1c", "#2f241a"];
  const roof = DARK_ROOFS[(variation.seed || 0) % DARK_ROOFS.length];
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

/** Where the (optional) balcony + its sliding door sit. Shared by walls and features
 *  so the wall actually gets a hole where the sliding doors are. */
const BALCONY_WIDE: Record<string, number> = {
  "cantilever-front": 1.15,
  "side-veranda": 0.9,
  "stepped-terrace": 0.75,
  "tower-wing": 0.65,
  "jaali-court": 0.9,
  "split-block": 0.75,
  "pergola-terrace": 0.9,
  "butterfly-pavilion": 0.85,
  "folded-butterfly": 0.85,
  "mono-slope-courtyard": 0.85,
  "terrace-pavilion": 0.85,
  "courtyard-cut": 0.8,
};

function balconySpec(variation: Variation) {
  const front = entranceWall(variation);
  const level = variation.plates.length > 1 ? 1 : 0;
  const plate = variation.plates[level];
  if (!plate) return null;
  const isNS = front === "N" || front === "S";
  const wide = BALCONY_WIDE[variation.massingStyle ?? "pergola-terrace"] ?? 0.8;
  const wallLenFt = isNS ? plate.w : plate.h;
  const spanFt = Math.min(wallLenFt * 0.7, 22) * wide;
  const doorSpanFt = Math.max(6, Math.min(spanFt * 0.6, 8.8));
  return { front, level, plate, isNS, spanFt, depthFt: 5.5, doorSpanFt, centerFt: wallLenFt / 2 };
}

/** Outer perimeter wall built per side, with door/window cutouts and windows on top. */
function PerimeterWalls({ plate, variation, timeOfDay = "day", showBalcony = true }: { plate: FloorPlate; variation: Variation; timeOfDay?: "day" | "night"; showBalcony?: boolean }) {

  const t = WALL_THICKNESS * FT_TO_M;
  const h = FLOOR_HEIGHT * FT_TO_M;
  const winTop = 7 * FT_TO_M;
  const winBot = 3 * FT_TO_M;
  const doorH = 7 * FT_TO_M;

  const palette = paletteFor(variation);
  const base = new THREE.Color(palette.wall);
  const cream = new THREE.Color("#f6efe2");
  // Whitewash: pull every facade toward warm off-white so the row of designs
  // reads as light+wooden, per user preference.
  const wall = base.clone().lerp(cream, palette.material === "timber" || palette.material === "brick" ? 0.35 : 0.55);
  const WALL_COLOR = `#${wall.getHexString()}`;
  const TRIM_COLOR = "#f4ecdd";
  // Window frame/muntin picks up the variation's accent so windows read as colored, not white.
  const FRAME_COLOR = new THREE.Color(palette.accent).lerp(new THREE.Color(palette.trim), 0.25).getStyle();
  const DOOR_COLOR = "#5a3a22";   // walnut
  // Window tint — leans strongly into the variation accent so every model has a distinct glass hue.
  const GLASS_TINT = new THREE.Color(palette.accent).lerp(new THREE.Color("#a8c8e2"), 0.35).getHexString();

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

  // Balcony sliding-door opening — a real hole in the perimeter wall.
  const bal = showBalcony ? balconySpec(variation) : null;
  const balOnThisFloor = bal && bal.plate.floor === plate.floor ? bal : null;

  const buildSide = (
    side: "N" | "S" | "E" | "W",
    length: number,
    fixedCoord: number,
  ) => {
    const cuts = byWall[side].map(c => ({ a: c.a, b: c.b }));
    const balGap =
      balOnThisFloor && balOnThisFloor.front === side
        ? {
            a: Math.max(0.5, balOnThisFloor.centerFt - balOnThisFloor.doorSpanFt / 2),
            b: Math.min(length - 0.5, balOnThisFloor.centerFt + balOnThisFloor.doorSpanFt / 2),
          }
        : null;
    if (balGap && balGap.b - balGap.a > 1) cuts.push(balGap);
    const solid = subtractOpenings(0, length, cuts);
    if (balGap && balGap.b - balGap.a > 1) {
      // Lintel above the sliding doors so the wall reads as continuous.
      const gapLen = (balGap.b - balGap.a) * FT_TO_M;
      const gapMid = ((balGap.a + balGap.b) / 2) * FT_TO_M;
      const lintelH = h - 7 * FT_TO_M;
      const lx = side === "N" || side === "S" ? gapMid - (plate.w / 2) * FT_TO_M : (fixedCoord - plate.w / 2) * FT_TO_M;
      const lz = side === "E" || side === "W" ? gapMid - (plate.h / 2) * FT_TO_M : (fixedCoord - plate.h / 2) * FT_TO_M;
      if (lintelH > 0.05) {
        segments.push(
          <mesh key={`bl${key++}`} position={[lx, 7 * FT_TO_M + lintelH / 2, lz]} castShadow receiveShadow>
            <boxGeometry args={side === "N" || side === "S" ? [gapLen, lintelH, t] : [t, lintelH, gapLen]} />
            <meshStandardMaterial color={WALL_COLOR} roughness={0.85} />
          </mesh>,
        );
      }
    }

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
            <meshStandardMaterial color={FRAME_COLOR} roughness={0.55} metalness={0.08} />
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
            <meshStandardMaterial color={FRAME_COLOR} roughness={0.55} metalness={0.08} />
          </mesh>,
        );
        const glassArgs: [number, number, number] = side === "N" || side === "S" ? [segLen * 0.9, (winTop - winBot) * 0.95, t * 0.2] : [t * 0.2, (winTop - winBot) * 0.95, segLen * 0.9];
        segments.push(
          <mesh key={`g${key++}`} position={[lx, (winTop + winBot) / 2, lz]}>
            <boxGeometry args={glassArgs} />
            <meshPhysicalMaterial
              color={timeOfDay === "night" ? "#f6c46b" : `#${GLASS_TINT}`}
              emissive={timeOfDay === "night" ? "#f6a93a" : "#000000"}
              emissiveIntensity={timeOfDay === "night" ? 0.55 : 0}
              transmission={0.45}
              opacity={timeOfDay === "night" ? 0.85 : 0.7}
              transparent
              roughness={0.08}
              thickness={0.05}
              metalness={0.15}
            />
          </mesh>,
        );
        // muntin — colored horizontal + vertical dividers so windows read as framed panels
        const muntinArgs: [number, number, number] = side === "N" || side === "S" ? [segLen * 0.9, 0.08, t * 0.4] : [t * 0.4, 0.08, segLen * 0.9];
        segments.push(
          <mesh key={`m${key++}`} position={[lx, (winTop + winBot) / 2, lz]}>
            <boxGeometry args={muntinArgs} />
            <meshStandardMaterial color={FRAME_COLOR} roughness={0.5} metalness={0.15} />
          </mesh>,
        );
        // vertical muntin
        const vArgs: [number, number, number] = side === "N" || side === "S" ? [0.08, (winTop - winBot) * 0.95, t * 0.4] : [t * 0.4, (winTop - winBot) * 0.95, 0.08];
        segments.push(
          <mesh key={`mv${key++}`} position={[lx, (winTop + winBot) / 2, lz]}>
            <boxGeometry args={vArgs} />
            <meshStandardMaterial color={FRAME_COLOR} roughness={0.5} metalness={0.15} />
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
  plate, baseY, variation, planMode, kitchenOpen, plotW, plotD, timeOfDay, showFurniture, showBalcony = true,
}: { plate: FloorPlate; baseY: number; variation: Variation; planMode: string; kitchenOpen: boolean; plotW: number; plotD: number; timeOfDay: "day" | "night"; showFurniture: boolean; showBalcony?: boolean }) {

  const toScene = makeToScene(plotW, plotD);
  const cx = plate.x + plate.w / 2;
  const cz = plate.y + plate.h / 2;
  const [sx, sz] = toScene(cx, cz);
  const slabShape = useMemo(() => {
    const shape = new THREE.Shape();
    const w = plate.w * FT_TO_M;
    const d = plate.h * FT_TO_M;
    const x0 = -w / 2;
    const z0 = -d / 2;
    const c = Math.min((plate.chamfer || 0) * FT_TO_M, w * 0.35, d * 0.35);
    if (c > 0.05) {
      const corner = plate.chamferCorner ?? "NE";
      const pts: [number, number][] = corner === "NE"
        ? [[x0, z0], [x0 + w - c, z0], [x0 + w, z0 + c], [x0 + w, z0 + d], [x0, z0 + d]]
        : corner === "NW"
          ? [[x0 + c, z0], [x0 + w, z0], [x0 + w, z0 + d], [x0, z0 + d], [x0, z0 + c]]
          : corner === "SE"
            ? [[x0, z0], [x0 + w, z0], [x0 + w, z0 + d - c], [x0 + w - c, z0 + d], [x0, z0 + d]]
            : [[x0, z0], [x0 + w, z0], [x0 + w, z0 + d], [x0 + c, z0 + d], [x0, z0 + d - c]];
      shape.moveTo(pts[0][0], pts[0][1]);
      pts.slice(1).forEach(([x, z]) => shape.lineTo(x, z));
      shape.closePath();
    } else {
      const r = Math.min((plate.cornerRadius || 0) * FT_TO_M, w * 0.18, d * 0.18);
      if (r > 0.08) {
        shape.moveTo(x0 + r, z0);
        shape.lineTo(x0 + w - r, z0);
        shape.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + r);
        shape.lineTo(x0 + w, z0 + d - r);
        shape.quadraticCurveTo(x0 + w, z0 + d, x0 + w - r, z0 + d);
        shape.lineTo(x0 + r, z0 + d);
        shape.quadraticCurveTo(x0, z0 + d, x0, z0 + d - r);
        shape.lineTo(x0, z0 + r);
        shape.quadraticCurveTo(x0, z0, x0 + r, z0);
        shape.closePath();
      } else {
        shape.moveTo(x0, z0);
        shape.lineTo(x0 + w, z0);
        shape.lineTo(x0 + w, z0 + d);
        shape.lineTo(x0, z0 + d);
        shape.closePath();
      }
    }
    return shape;
  }, [plate.chamfer, plate.chamferCorner, plate.cornerRadius, plate.h, plate.w]);
  const curvedCorners = useMemo(() => {
    const r = Math.min((plate.cornerRadius || 0) * FT_TO_M, plate.w * FT_TO_M * 0.18, plate.h * FT_TO_M * 0.18);
    if (r <= 0.08 || plate.chamfer > 0.05) return [];
    const w = plate.w * FT_TO_M;
    const d = plate.h * FT_TO_M;
    return [
      { x: -w / 2 + r, z: -d / 2 + r, q: 0 },
      { x: w / 2 - r, z: -d / 2 + r, q: 1 },
      { x: w / 2 - r, z: d / 2 - r, q: 2 },
      { x: -w / 2 + r, z: d / 2 - r, q: 3 },
    ];
  }, [plate.chamfer, plate.cornerRadius, plate.h, plate.w]);
  return (
    <group position={[sx, baseY, sz]}>
      {/* plinth/foundation extending down to ground */}
      {baseY < 0.01 && (
        <mesh position={[0, -0.6, 0]} receiveShadow castShadow>
          <boxGeometry args={[plate.w * FT_TO_M + 0.4, 1.2, plate.h * FT_TO_M + 0.4]} />
          <meshStandardMaterial color="#bdb3a4" roughness={0.95} />
        </mesh>
      )}
      <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <extrudeGeometry args={[slabShape, { depth: 0.1, bevelEnabled: false }]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.9} />
      </mesh>
      <PerimeterWalls plate={plate} variation={variation} timeOfDay={timeOfDay} showBalcony={showBalcony} />
      {curvedCorners.map((c, i) => (
        <group key={`curve-${i}`} position={[c.x, (FLOOR_HEIGHT * FT_TO_M) / 2, c.z]}>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[Math.max(0.12, plate.cornerRadius * FT_TO_M * 0.82), Math.max(0.12, plate.cornerRadius * FT_TO_M * 0.82), FLOOR_HEIGHT * FT_TO_M, 24, 1, false, c.q * Math.PI / 2, Math.PI / 2]} />
            <meshStandardMaterial color="#f6efe2" roughness={0.86} />
          </mesh>
        </group>
      ))}
      {plate.rooms.map((r, i) => (
        <RoomBlock key={i} room={r} plate={plate} planMode={planMode} kitchenOpen={kitchenOpen} timeOfDay={timeOfDay} showFurniture={showFurniture} />
      ))}
    </group>
  );
}

function TerraceBridges({ lower, upper, baseY, variation }: { lower: FloorPlate; upper: FloorPlate; baseY: number; variation: Variation }) {
  const palette = paletteFor(variation);
  const toScene = makeToScene(variation.plotWidthFt, variation.plotDepthFt);
  const areas: { x: number; y: number; w: number; h: number; rail?: "N" | "S" | "E" | "W" }[] = [];
  const lx1 = lower.x;
  const ly1 = lower.y;
  const lx2 = lower.x + lower.w;
  const ly2 = lower.y + lower.h;
  const ux1 = upper.x;
  const uy1 = upper.y;
  const ux2 = upper.x + upper.w;
  const uy2 = upper.y + upper.h;
  const overlapX = Math.max(0, Math.min(lx2, ux2) - Math.max(lx1, ux1));
  const overlapY = Math.max(0, Math.min(ly2, uy2) - Math.max(ly1, uy1));
  if (uy1 > ly1 + 1 && overlapX > 4) areas.push({ x: Math.max(lx1, ux1), y: ly1, w: overlapX, h: uy1 - ly1, rail: "N" });
  if (uy2 < ly2 - 1 && overlapX > 4) areas.push({ x: Math.max(lx1, ux1), y: uy2, w: overlapX, h: ly2 - uy2, rail: "S" });
  if (ux1 > lx1 + 1 && overlapY > 4) areas.push({ x: lx1, y: Math.max(ly1, uy1), w: ux1 - lx1, h: overlapY, rail: "W" });
  if (ux2 < lx2 - 1 && overlapY > 4) areas.push({ x: ux2, y: Math.max(ly1, uy1), w: lx2 - ux2, h: overlapY, rail: "E" });
  return (
    <group>
      {areas.filter((a) => a.w > 2 && a.h > 2).map((a, i) => {
        const [sx, sz] = toScene(a.x + a.w / 2, a.y + a.h / 2);
        const w = a.w * FT_TO_M;
        const d = a.h * FT_TO_M;
        const railZ = a.rail === "N" ? -d / 2 : a.rail === "S" ? d / 2 : 0;
        const railX = a.rail === "W" ? -w / 2 : a.rail === "E" ? w / 2 : 0;
        const isNS = a.rail === "N" || a.rail === "S";
        return (
          <group key={i} position={[sx, baseY + 0.08, sz]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[w, 0.16, d]} />
              <meshStandardMaterial color="#eee5d7" roughness={0.82} />
            </mesh>
            {a.rail && (
              <mesh position={[railX, 0.58, railZ]} castShadow receiveShadow>
                <boxGeometry args={isNS ? [w * 0.92, 0.82, 0.07] : [0.07, 0.82, d * 0.92]} />
                <meshPhysicalMaterial color={palette.accent} transmission={0.45} opacity={0.48} transparent roughness={0.18} metalness={0.18} />
              </mesh>
            )}
            {i % 2 === 0 && Math.min(w, d) > 1.2 && (
              <group position={[-w * 0.25, 0.22, d * 0.18]} scale={0.72}>
                <mesh position={[0, 0.18, 0]} castShadow><cylinderGeometry args={[0.18, 0.13, 0.32, 12]} /><meshStandardMaterial color="#9a5638" roughness={0.85} /></mesh>
                <mesh position={[0, 0.46, 0]} castShadow><sphereGeometry args={[0.28, 9, 7]} /><meshStandardMaterial color="#4e7b3f" roughness={0.95} /></mesh>
              </group>
            )}
          </group>
        );
      })}
    </group>
  );
}

function RoomBlock({
  room, plate, planMode, kitchenOpen, timeOfDay, showFurniture,
}: { room: RoomRect; plate: FloorPlate; planMode: string; kitchenOpen: boolean; timeOfDay: "day" | "night"; showFurniture: boolean }) {
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
      {showFurniture && <Furniture room={room} w={w} d={d} />}
      {timeOfDay === "night" && !["stairs", "lift", "parking", "bath"].includes(room.type) && (
        <>
          <pointLight position={[0, 2.25, 0]} intensity={0.55} color="#ffd08a" distance={4.5} />
          <mesh position={[0, 2.7, 0]}>
            <sphereGeometry args={[0.08, 10, 8]} />
            <meshStandardMaterial color="#ffd08a" emissive="#ffd08a" emissiveIntensity={1.3} />
          </mesh>
        </>
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

function Furniture({ room, w, d }: { room: RoomRect; w: number; d: number }) {
  if (["stairs", "lift", "parking", "courtyard", "utility"].includes(room.type)) return null;
  const wood = <meshStandardMaterial color="#7b5637" roughness={0.72} />;
  const fabric = <meshStandardMaterial color={room.type === "bedroom" || room.type === "master_bedroom" ? "#e9dfcf" : "#b7c0a5"} roughness={0.85} />;
  const stone = <meshStandardMaterial color="#eee7dc" roughness={0.75} />;
  const metal = <meshStandardMaterial color="#94a3b8" roughness={0.4} metalness={0.55} />;
  const safeW = Math.max(1.2, w * 0.82);
  const safeD = Math.max(1.2, d * 0.82);

  if (room.type === "living") {
    return (
      <group>
        <mesh position={[-safeW * 0.22, 0.22, safeD * 0.12]} castShadow receiveShadow><boxGeometry args={[safeW * 0.42, 0.38, safeD * 0.14]} />{fabric}</mesh>
        <mesh position={[-safeW * 0.22, 0.55, safeD * 0.22]} castShadow><boxGeometry args={[safeW * 0.42, 0.58, 0.08]} />{fabric}</mesh>
        <mesh position={[safeW * 0.12, 0.18, -safeD * 0.08]} castShadow receiveShadow><boxGeometry args={[safeW * 0.28, 0.12, safeD * 0.18]} />{wood}</mesh>
        <mesh position={[safeW * 0.36, 0.42, -safeD * 0.3]} castShadow><boxGeometry args={[safeW * 0.22, 0.35, 0.06]} />{metal}</mesh>
      </group>
    );
  }
  if (room.type === "bedroom" || room.type === "master_bedroom") {
    return (
      <group>
        <mesh position={[0, 0.2, safeD * 0.1]} castShadow receiveShadow><boxGeometry args={[safeW * 0.52, 0.25, safeD * 0.48]} />{wood}</mesh>
        <mesh position={[0, 0.38, safeD * 0.1]} castShadow><boxGeometry args={[safeW * 0.48, 0.16, safeD * 0.42]} />{fabric}</mesh>
        <mesh position={[0, 0.58, safeD * 0.35]} castShadow><boxGeometry args={[safeW * 0.5, 0.42, 0.08]} />{wood}</mesh>
        {[-1, 1].map((s) => <mesh key={s} position={[s * safeW * 0.36, 0.22, safeD * 0.22]} castShadow><boxGeometry args={[0.28, 0.28, 0.28]} />{wood}</mesh>)}
      </group>
    );
  }
  if (room.type === "kitchen") {
    return (
      <group>
        <mesh position={[-safeW * 0.3, 0.42, -safeD * 0.33]} castShadow receiveShadow><boxGeometry args={[safeW * 0.58, 0.8, 0.36]} />{wood}</mesh>
        <mesh position={[safeW * 0.34, 0.42, 0]} castShadow receiveShadow><boxGeometry args={[0.36, 0.8, safeD * 0.62]} />{wood}</mesh>
        <mesh position={[-safeW * 0.05, 0.86, -safeD * 0.33]} castShadow><boxGeometry args={[safeW * 0.18, 0.06, 0.28]} />{metal}</mesh>
      </group>
    );
  }
  if (room.type === "dining") {
    return (
      <group>
        <mesh position={[0, 0.42, 0]} castShadow receiveShadow><boxGeometry args={[safeW * 0.46, 0.1, safeD * 0.32]} />{wood}</mesh>
        {[[0, 1], [0, -1], [1, 0], [-1, 0]].map(([x, z], i) => <mesh key={i} position={[x * safeW * 0.32, 0.24, z * safeD * 0.24]} castShadow><boxGeometry args={[0.28, 0.3, 0.28]} />{fabric}</mesh>)}
      </group>
    );
  }
  if (room.type === "study") {
    return (
      <group>
        <mesh position={[0, 0.42, -safeD * 0.28]} castShadow receiveShadow><boxGeometry args={[safeW * 0.5, 0.1, safeD * 0.18]} />{wood}</mesh>
        <mesh position={[0, 0.25, -safeD * 0.05]} castShadow><boxGeometry args={[0.32, 0.36, 0.32]} />{fabric}</mesh>
        <mesh position={[safeW * 0.28, 0.55, safeD * 0.2]} castShadow><boxGeometry args={[0.12, 0.9, safeD * 0.36]} />{wood}</mesh>
      </group>
    );
  }
  if (room.type === "pooja") {
    return <mesh position={[0, 0.45, -safeD * 0.28]} castShadow receiveShadow><boxGeometry args={[safeW * 0.52, 0.8, 0.2]} />{wood}</mesh>;
  }
  if (room.type === "bath") {
    return (
      <group>
        <mesh position={[-safeW * 0.25, 0.25, -safeD * 0.2]} castShadow receiveShadow><boxGeometry args={[0.42, 0.28, 0.55]} />{stone}</mesh>
        <mesh position={[safeW * 0.22, 0.38, safeD * 0.2]} castShadow><cylinderGeometry args={[0.18, 0.18, 0.5, 16]} />{stone}</mesh>
      </group>
    );
  }
  return null;
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

function entranceWall(variation: Variation): "N" | "E" | "S" | "W" {
  const dir = variation.entranceDirection;
  if (dir === "N" || dir === "NE" || dir === "NW") return "N";
  if (dir === "S" || dir === "SE" || dir === "SW") return "S";
  return dir === "W" ? "W" : "E";
}

function sidePosition(
  variation: Variation,
  plate: FloorPlate,
  side: "N" | "E" | "S" | "W",
  offsetFt: number,
  widthFt: number,
  depthFt: number,
): { pos: [number, number, number]; size: [number, number, number] } {
  const toScene = makeToScene(variation.plotWidthFt, variation.plotDepthFt);
  const cx = side === "E" ? plate.x + plate.w + offsetFt : side === "W" ? plate.x - offsetFt : plate.x + plate.w / 2;
  const cy = side === "S" ? plate.y + plate.h + offsetFt : side === "N" ? plate.y - offsetFt : plate.y + plate.h / 2;
  const [sx, sz] = toScene(cx, cy);
  const isNS = side === "N" || side === "S";
  return {
    pos: [sx, 0, sz],
    size: [
      (isNS ? widthFt : depthFt) * FT_TO_M,
      1,
      (isNS ? depthFt : widthFt) * FT_TO_M,
    ],
  };
}

function ElevationFeatures({ variation, topY }: { variation: Variation; topY: number }) {
  const top = variation.plates[variation.plates.length - 1];
  const palette = paletteFor(variation);
  const massing = variation.massingStyle ?? "pergola-terrace";
  const front = entranceWall(variation);
  const railMat = <meshPhysicalMaterial color="#bcdcf2" transmission={0.6} opacity={0.45} transparent roughness={0.08} metalness={0.2} />;
  const trimMat = <meshStandardMaterial color={palette.trim} roughness={0.7} />;
  const accentMat = <meshStandardMaterial color={palette.accent} roughness={0.72} metalness={palette.material === "corten" ? 0.35 : 0.03} />;
  const timberMat = <meshStandardMaterial color={palette.material === "timber" ? palette.wall : "#7a5a3a"} roughness={0.65} />;
  const y1 = FLOOR_HEIGHT * FT_TO_M;
  const roofCenter = makeToScene(variation.plotWidthFt, variation.plotDepthFt)(top.x + top.w / 2, top.y + top.h / 2);

  const balcony = (wide = 1) => {
    const isNS = front === "N" || front === "S";
    // Attach to the plate of the floor the balcony belongs to, so stepped /
    // cantilevered massings line up with the actual wall instead of the ground box.
    const level = variation.plates.length > 1 ? 1 : 0;
    const plate = variation.plates[level];
    const baseY = level * FLOOR_HEIGHT * FT_TO_M;

    const depthFt = 5.5;
    const spanFt = Math.min((isNS ? plate.w : plate.h) * 0.7, 22) * wide;
    // offset = depth/2 → the slab's inner edge sits exactly on the wall plane.
    const feat = sidePosition(variation, plate, front, depthFt / 2, spanFt, depthFt);
    const spanM = spanFt * FT_TO_M;
    const depthM = depthFt * FT_TO_M;

    // Unit vector pointing OUT of the house (scene space).
    const outX = front === "E" ? 1 : front === "W" ? -1 : 0;
    const outZ = front === "S" ? 1 : front === "N" ? -1 : 0;

    const doorSpan = Math.min(spanM * 0.6, 2.7);
    const doorH = 7 * FT_TO_M;
    const slabTop = 0.09;
    const railH = 1.0;
    // Wall plane = inner edge of the slab.
    const wallPos: [number, number, number] = [-outX * (depthM / 2), slabTop, -outZ * (depthM / 2)];
    // Lateral axis of the balcony (along the wall).
    const lat = (t: number): [number, number, number] => (isNS ? [t, 0, 0] : [0, 0, t]);
    const add = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
      [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

    return (
      <group position={[feat.pos[0], baseY + 0.02, feat.pos[2]]}>
        {/* Slab */}
        <mesh castShadow receiveShadow position={[0, 0.02, 0]}>
          <boxGeometry args={[isNS ? spanM : depthM, 0.16, isNS ? depthM : spanM]} />
          {trimMat}
        </mesh>
        {/* Railing — outer edge */}
        <mesh position={[outX * (depthM / 2 - 0.05), slabTop + railH / 2, outZ * (depthM / 2 - 0.05)]} castShadow>
          <boxGeometry args={[isNS ? spanM : 0.08, railH, isNS ? 0.08 : spanM]} />
          {railMat}
        </mesh>
        {/* Railing — the two side returns */}
        {[-1, 1].map((s) => (
          <mesh key={`side${s}`} position={add(lat(s * (spanM / 2 - 0.04)), [0, slabTop + railH / 2, 0])} castShadow>
            <boxGeometry args={[isNS ? 0.08 : depthM, railH, isNS ? depthM : 0.08]} />
            {railMat}
          </mesh>
        ))}
        {/* Handrail cap */}
        <mesh position={[outX * (depthM / 2 - 0.05), slabTop + railH + 0.03, outZ * (depthM / 2 - 0.05)]}>
          <boxGeometry args={[isNS ? spanM : 0.12, 0.06, isNS ? 0.12 : spanM]} />
          {accentMat}
        </mesh>

        {/* Sliding-glass door set, flush on the wall behind the balcony */}
        <group position={wallPos}>
          {/* dark recess so it reads as a real opening, not a sticker */}
          <mesh position={[-outX * 0.09, doorH / 2, -outZ * 0.09]}>
            <boxGeometry args={isNS ? [doorSpan, doorH, 0.14] : [0.14, doorH, doorSpan]} />
            <meshStandardMaterial color="#1c1a17" roughness={0.95} />
          </mesh>
          {/* outer frame */}
          <mesh position={[outX * 0.03, doorH / 2, outZ * 0.03]}>
            <boxGeometry args={isNS ? [doorSpan + 0.14, doorH + 0.12, 0.07] : [0.07, doorH + 0.12, doorSpan + 0.14]} />
            <meshStandardMaterial color={palette.accent} roughness={0.5} metalness={0.18} />
          </mesh>
          {/* two glass leaves on offset tracks */}
          {[-1, 1].map((s) => (
            <mesh
              key={s}
              position={add(lat(s * doorSpan * 0.25), [outX * (0.05 + s * 0.015), doorH / 2, outZ * (0.05 + s * 0.015)])}
            >
              <boxGeometry args={isNS ? [doorSpan / 2 - 0.04, doorH * 0.95, 0.035] : [0.035, doorH * 0.95, doorSpan / 2 - 0.04]} />
              <meshPhysicalMaterial color="#a8c4d8" transmission={0.72} opacity={0.5} transparent roughness={0.05} thickness={0.05} metalness={0.15} />
            </mesh>
          ))}
          {/* leaf stiles */}
          {[-1, 1].map((s) => (
            <mesh key={`st${s}`} position={add(lat(s * doorSpan * 0.5), [outX * 0.06, doorH / 2, outZ * 0.06])}>
              <boxGeometry args={isNS ? [0.06, doorH * 0.95, 0.05] : [0.05, doorH * 0.95, 0.06]} />
              <meshStandardMaterial color={palette.accent} roughness={0.45} metalness={0.2} />
            </mesh>
          ))}
          {/* centre meeting stile + handles */}
          {[-1, 1].map((s) => (
            <mesh key={`h${s}`} position={add(lat(s * 0.06), [outX * 0.08, doorH * 0.45, outZ * 0.08])}>
              <boxGeometry args={isNS ? [0.035, 0.7, 0.035] : [0.035, 0.7, 0.035]} />
              <meshStandardMaterial color="#c9c4bb" metalness={0.75} roughness={0.28} />
            </mesh>
          ))}
          {/* threshold / sill flush with the slab */}
          <mesh position={[outX * 0.05, 0.02, outZ * 0.05]}>
            <boxGeometry args={isNS ? [doorSpan + 0.14, 0.05, 0.16] : [0.16, 0.05, doorSpan + 0.14]} />
            {accentMat}
          </mesh>
        </group>
      </group>
    );
  };


  // Vertical fins / jaali placed on a SIDE wall of the UPPER floor only —
  // never the entrance side, never full-height (was blocking the door).
  const screen = (count: number) => {
    if (variation.plates.length < 2) return null;
    // pick a side wall perpendicular to entrance
    const side = (front === "N" || front === "S" ? "E" : "S") as "N" | "E" | "S" | "W";
    const upper = variation.plates[variation.plates.length - 1];
    const span = side === "N" || side === "S" ? upper.w : upper.h;
    const feat = sidePosition(variation, upper, side, 0.4, Math.min(span * 0.55, 14), 4);
    const height = 8.5 * FT_TO_M;
    const isNS = side === "N" || side === "S";
    const sign = side === "N" || side === "W" ? -1 : 1;
    return (
      <group position={[feat.pos[0], y1 + height / 2, feat.pos[2]]}>
        {Array.from({ length: count }).map((_, k) => {
          const t = count === 1 ? 0 : k / (count - 1) - 0.5;
          return (
            <mesh key={k} position={isNS ? [t * feat.size[0], 0, sign * 0.08] : [sign * 0.08, 0, t * feat.size[2]]} castShadow>
              <boxGeometry args={isNS ? [0.09, height, 0.16] : [0.16, height, 0.09]} />
              {accentMat}
            </mesh>
          );
        })}
      </group>
    );
  };

  const pergola = (level = topY + 0.55) => (
    <group position={[roofCenter[0], level, roofCenter[1]]}>
      {Array.from({ length: 6 }).map((_, k) => (
        <mesh key={k} position={[(-0.5 + k / 5) * top.w * FT_TO_M * 0.62, 0, 0]} castShadow>
          <boxGeometry args={[0.12, 0.16, top.h * FT_TO_M * 0.68]} />
          {timberMat}
        </mesh>
      ))}
      {[-1, 1].map((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}-${sz}`} position={[sx * top.w * FT_TO_M * 0.32, -0.65, sz * top.h * FT_TO_M * 0.32]} castShadow>
          <boxGeometry args={[0.18, 1.3, 0.18]} />
          {timberMat}
        </mesh>
      )))}
    </group>
  );

  const woodBand = () => {
    const side = (front === "N" || front === "S" ? "E" : "N") as "N" | "E" | "S" | "W";
    const plate = variation.plates[Math.min(variation.plates.length - 1, 1)];
    const span = side === "N" || side === "S" ? plate.w : plate.h;
    const feat = sidePosition(variation, plate, side, 0.28, Math.min(span * 0.72, 20), 0.35);
    const isNS = side === "N" || side === "S";
    const sign = side === "N" || side === "W" ? -1 : 1;
    return (
      <group position={[feat.pos[0], (plate.floor - 1) * FLOOR_HEIGHT * FT_TO_M + 1.65, feat.pos[2]]}>
        {Array.from({ length: 5 }).map((_, k) => (
          <mesh
            key={k}
            position={isNS ? [0, k * 0.28, sign * 0.08] : [sign * 0.08, k * 0.28, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={isNS ? [feat.size[0], 0.09, 0.12] : [0.12, 0.09, feat.size[2]]} />
            <meshStandardMaterial color={k % 2 ? "#8a633f" : "#6f4d32"} roughness={0.62} />
          </mesh>
        ))}
      </group>
    );
  };

  // Decorations must NEVER cover the front entrance on the ground floor.
  // We only allow front-side balconies (upper level) and side-wall screens.
  // Full-height screens on the entrance side are disallowed — they were
  // burying doors and windows.
  switch (massing) {
    case "cantilever-front":
      return <>{balcony(1.15)}{woodBand()}</>;
    case "side-veranda":
      return <>{balcony(0.9)}</>;
    case "stepped-terrace":
      return <>{balcony(0.75)}</>;
    case "tower-wing":
      return <>{balcony(0.65)}</>;
    case "jaali-court":
      // Screens only if the front feature can sit as an upper balcony, not full-height.
      return <>{balcony(0.9)}{variation.plates.length > 1 ? screen(6) : null}</>;
    case "split-block":
      return <>{balcony(0.75)}</>;
    case "pergola-terrace":
      return <>{balcony(0.9)}</>;
    case "butterfly-pavilion":
    case "folded-butterfly":
    case "mono-slope-courtyard":
    case "terrace-pavilion":
      return <>{balcony(0.85)}{woodBand()}</>;
    case "courtyard-cut":
      return <>{balcony(0.8)}{woodBand()}</>;
    default:
      return <>{balcony(0.8)}</>;
  }
}

function RoofPots({ w, d, seed }: { w: number; d: number; seed: number }) {
  const rand = (i: number) => {
    const x = Math.sin(seed * 9301 + i * 49297) * 233280;
    return x - Math.floor(x);
  };
  const pots: { x: number; z: number; kind: 0 | 1 | 2; s: number }[] = [];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const edge = i % 4;
    const t = 0.15 + rand(i * 5 + 1) * 0.7;
    let x = 0, z = 0;
    const inset = 0.6;
    if (edge === 0) { x = -w / 2 + inset; z = -d / 2 + t * d; }
    else if (edge === 1) { x = w / 2 - inset; z = -d / 2 + t * d; }
    else if (edge === 2) { z = -d / 2 + inset; x = -w / 2 + t * w; }
    else { z = d / 2 - inset; x = -w / 2 + t * w; }
    pots.push({ x, z, kind: Math.floor(rand(i * 7) * 3) as 0 | 1 | 2, s: 0.8 + rand(i * 3) * 0.5 });
  }
  return (
    <group position={[0, 0.2, 0]}>
      {pots.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]} scale={p.s}>
          {/* terracotta pot */}
          <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.22, 0.16, 0.36, 12]} />
            <meshStandardMaterial color="#a05a3a" roughness={0.85} />
          </mesh>
          {/* soil */}
          <mesh position={[0, 0.36, 0]} receiveShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.02, 12]} />
            <meshStandardMaterial color="#3a2a1a" roughness={1} />
          </mesh>
          {/* foliage — layered irregular blobs */}
          {p.kind === 0 ? (
            <>
              <mesh position={[0, 0.62, 0]} castShadow>
                <sphereGeometry args={[0.28, 10, 8]} />
                <meshStandardMaterial color="#4a7a3a" roughness={0.9} />
              </mesh>
              <mesh position={[0.14, 0.58, 0.06]} castShadow>
                <sphereGeometry args={[0.18, 8, 6]} />
                <meshStandardMaterial color="#578a45" roughness={0.9} />
              </mesh>
            </>
          ) : p.kind === 1 ? (
            <>
              <mesh position={[0, 0.75, 0]} castShadow>
                <coneGeometry args={[0.22, 0.9, 8]} />
                <meshStandardMaterial color="#3f6b3a" roughness={0.9} />
              </mesh>
            </>
          ) : (
            <>
              {[[-0.1, 0.55, 0], [0.12, 0.62, 0.05], [0, 0.5, -0.1]].map(([x, y, z], k) => (
                <mesh key={k} position={[x, y, z]} castShadow>
                  <sphereGeometry args={[0.16, 8, 6]} />
                  <meshStandardMaterial color="#688a4a" roughness={0.9} />
                </mesh>
              ))}
            </>
          )}
        </group>
      ))}
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
  const palette = paletteFor(variation);
  const TRIM = palette.trim;
  const massing = variation.massingStyle ?? "pergola-terrace";

  if (massing === "gabled-house") {
    const ridgeH = Math.min(w, d) * 0.32;
    return (
      <group position={center}>
        <mesh position={[0, 0.08 + ridgeH / 2, -d * 0.18]} rotation={[0.38, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.75, 0.16, d * 0.62]} />
          <meshStandardMaterial color={palette.roof} roughness={0.65} />
        </mesh>
        <mesh position={[0, 0.08 + ridgeH / 2, d * 0.18]} rotation={[-0.38, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.75, 0.16, d * 0.62]} />
          <meshStandardMaterial color={palette.roof} roughness={0.65} />
        </mesh>
      </group>
    );
  }

  if (massing === "folded-butterfly") {
    const lift = Math.min(w, d) * 0.24;
    return (
      <group position={center}>
        <mesh position={[0, lift * 0.38, 0]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.5, lift * 0.76, d + 0.5]} />
          <meshStandardMaterial color={palette.trim} roughness={0.76} />
        </mesh>
        <mesh position={[0, lift * 0.74, 0]} castShadow receiveShadow>
          <boxGeometry args={[w * 0.22, lift * 0.28, d + 0.7]} />
          <meshPhysicalMaterial color="#d7e5ea" transmission={0.35} opacity={0.78} transparent roughness={0.18} metalness={0.08} />
        </mesh>
        <mesh position={[-w * 0.28, lift * 0.92, 0]} rotation={[0, 0, -0.3]} castShadow receiveShadow>
          <boxGeometry args={[w * 0.62, 0.18, d + 0.85]} />
          <meshStandardMaterial color={palette.roof} roughness={0.68} />
        </mesh>
        <mesh position={[w * 0.28, lift * 0.92, 0]} rotation={[0, 0, 0.3]} castShadow receiveShadow>
          <boxGeometry args={[w * 0.62, 0.18, d + 0.85]} />
          <meshStandardMaterial color={palette.roof} roughness={0.68} />
        </mesh>
        <mesh position={[0, lift * 0.62, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.24, 0.2, d + 0.95]} />
          <meshStandardMaterial color={TRIM} roughness={0.55} />
        </mesh>
      </group>
    );
  }

  if (massing === "mono-slope-courtyard") {
    const lift = Math.min(w, d) * 0.26;
    return (
      <group position={center}>
        <mesh position={[0, lift * 0.32, 0]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.5, lift * 0.62, d + 0.5]} />
          <meshStandardMaterial color={palette.trim} roughness={0.78} />
        </mesh>
        <mesh position={[0, lift * 0.72, 0]} rotation={[0, 0, 0.2]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.9, 0.2, d + 0.8]} />
          <meshStandardMaterial color={palette.roof} roughness={0.68} />
        </mesh>
        <mesh position={[-w * 0.42, lift * 0.52, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.24, lift * 0.7, d + 0.55]} />
          <meshStandardMaterial color={TRIM} roughness={0.7} />
        </mesh>
      </group>
    );
  }

  if (massing === "terrace-pavilion") {
    return (
      <group position={center}>
        <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.45, 0.2, d + 0.45]} />
          <meshStandardMaterial color={palette.roof} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.55, -d / 2 - 0.1]} castShadow><boxGeometry args={[w + 0.65, 0.78, 0.25]} /><meshStandardMaterial color={TRIM} roughness={0.7} /></mesh>
        <mesh position={[0, 0.55, d / 2 + 0.1]} castShadow><boxGeometry args={[w + 0.65, 0.78, 0.25]} /><meshStandardMaterial color={TRIM} roughness={0.7} /></mesh>
        <mesh position={[-w / 2 - 0.1, 0.55, 0]} castShadow><boxGeometry args={[0.25, 0.78, d + 0.65]} /><meshStandardMaterial color={TRIM} roughness={0.7} /></mesh>
        <mesh position={[w / 2 + 0.1, 0.55, 0]} castShadow><boxGeometry args={[0.25, 0.78, d + 0.65]} /><meshStandardMaterial color={TRIM} roughness={0.7} /></mesh>
        <RoofPots w={w} d={d} seed={variation.seed || 1} />
      </group>
    );
  }

  if (massing === "butterfly-pavilion") {
    const lift = Math.min(w, d) * 0.22;
    // Solid parapet wall closes the gap between the top floor and the V so
    // you never see interior from outside. Gable-end walls seal the ±X sides.
    return (
      <group position={center}>
        {/* Parapet band that fully wraps the top-floor perimeter */}
        <mesh position={[0, lift * 0.42, -d / 2 - 0.1]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.6, lift * 0.85, 0.3]} />
          <meshStandardMaterial color={palette.trim} roughness={0.75} />
        </mesh>
        <mesh position={[0, lift * 0.42, d / 2 + 0.1]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.6, lift * 0.85, 0.3]} />
          <meshStandardMaterial color={palette.trim} roughness={0.75} />
        </mesh>
        {/* Gable end walls on the low sides of the V — solid, closes the sky gap */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (w / 2 + 0.1), lift * 0.55, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.3, lift * 1.05, d + 0.6]} />
            <meshStandardMaterial color={palette.trim} roughness={0.75} />
          </mesh>
        ))}
        {/* Solid raised wall mass below the butterfly V; only a slim light strip remains glass. */}
        <mesh position={[0, lift * 0.48, 0]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.62, lift * 0.7, d + 0.62]} />
          <meshStandardMaterial color={palette.trim} roughness={0.78} />
        </mesh>
        <mesh position={[0, lift * 0.86, 0]} castShadow receiveShadow>
          <boxGeometry args={[w * 0.22, lift * 0.16, d + 0.68]} />
          <meshPhysicalMaterial color="#dfeaf2" transmission={0.35} opacity={0.76} transparent roughness={0.18} metalness={0.08} />
        </mesh>
        {/* The two roof slabs of the butterfly V */}
        <mesh position={[-w * 0.24, lift / 2 + lift * 0.35, 0]} rotation={[0, 0, -0.22]} castShadow receiveShadow>
          <boxGeometry args={[w * 0.56, 0.18, d + 0.7]} />
          <meshStandardMaterial color={palette.roof} roughness={0.68} />
        </mesh>
        <mesh position={[w * 0.24, lift / 2 + lift * 0.35, 0]} rotation={[0, 0, 0.22]} castShadow receiveShadow>
          <boxGeometry args={[w * 0.56, 0.18, d + 0.7]} />
          <meshStandardMaterial color={palette.roof} roughness={0.68} />
        </mesh>
        {/* Central ridge trim */}
        <mesh position={[0, lift * 0.35 + 0.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.22, 0.18, d + 0.9]} />
          <meshStandardMaterial color={TRIM} roughness={0.55} />
        </mesh>
      </group>
    );
  }

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
          <meshStandardMaterial color={palette.roof} roughness={0.65} />
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
        <meshStandardMaterial color={palette.roof} roughness={0.8} />
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
      {/* Potted greenery on the flat roof terrace */}
      <RoofPots w={w} d={d} seed={variation.seed || 1} />

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
        // Clamp mumty inside the top-plate perimeter so it never pokes out.
        const rawMx = (stairCx - topCx) * FT_TO_M;
        const rawMz = (stairCz - topCz) * FT_TO_M;
        const maxMx = Math.max(0, (top.w * FT_TO_M - mw) / 2 - 0.2);
        const maxMz = Math.max(0, (top.h * FT_TO_M - md) / 2 - 0.2);
        const mx = Math.min(maxMx, Math.max(-maxMx, rawMx));
        const mz = Math.min(maxMz, Math.max(-maxMz, rawMz));
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
  // Deterministic tree placement around the plot edge
  const trees: { x: number; z: number; scale: number; kind: number }[] = [];
  const seed = variation.seed || 1;
  const rand = (i: number) => {
    const x = Math.sin(seed * 9301 + i * 49297) * 233280;
    return x - Math.floor(x);
  };
  const half = { w: w / 2 + 1.2, d: d / 2 + 1.2 };
  const outer = { w: w / 2 + 5, d: d / 2 + 5 };
  for (let i = 0; i < 14; i++) {
    const side = i % 4;
    const t = rand(i * 3 + 1);
    const jitter = rand(i * 3 + 2) * 1.6;
    let x = 0, z = 0;
    if (side === 0) { x = -outer.w + jitter; z = -half.d + t * d; }
    else if (side === 1) { x = outer.w - jitter; z = -half.d + t * d; }
    else if (side === 2) { z = -outer.d + jitter; x = -half.w + t * w; }
    else { z = outer.d - jitter; x = -half.w + t * w; }
    trees.push({ x, z, scale: 0.9 + rand(i * 3 + 3) * 0.8, kind: Math.floor(rand(i) * 3) });
  }
  return (
    <group>
      {/* Lawn */}
      <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w + 14, d + 14]} />
        <meshStandardMaterial color="#7ca25a" roughness={0.95} />
      </mesh>
      {/* Driveway hint */}
      <mesh position={[0, -0.09, d / 2 + 1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w * 0.6, 2]} />
        <meshStandardMaterial color="#8b8478" roughness={0.85} />
      </mesh>
      {/* Ground shrubs / hedge dabs for realism */}
      {Array.from({ length: 22 }).map((_, i) => {
        const a = rand(i * 11 + 100) * Math.PI * 2;
        const r = (Math.max(w, d) / 2) + 0.6 + rand(i * 13) * 3.5;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const s = 0.4 + rand(i * 17) * 0.5;
        const green = ["#4a6b32", "#5d7a3f", "#3f5e2c", "#6b8a48"][i % 4];
        return (
          <mesh key={`sh${i}`} position={[x, 0.18 * s, z]} scale={[s, s * 0.7, s]} castShadow receiveShadow>
            <sphereGeometry args={[0.55, 8, 6]} />
            <meshStandardMaterial color={green} roughness={1} />
          </mesh>
        );
      })}
      {/* Perimeter trees — sway gently in the breeze */}
      {trees.map((t, i) => {
        const canopyColors = ["#3f6238", "#4a7a3a", "#587a3f", "#3a5f30", "#6b8a48"];
        const cc = canopyColors[t.kind % canopyColors.length];
        const cc2 = canopyColors[(t.kind + 2) % canopyColors.length];
        const blobs = 4 + Math.floor(rand(i * 19) * 3);
        const phase = rand(i * 29) * Math.PI * 2;
        const yaw = rand(i * 23) * Math.PI;
        return (
          <SwayingTree
            key={i}
            position={[t.x, 0, t.z]}
            scale={t.scale}
            yaw={yaw}
            phase={phase}
            cc={cc}
            cc2={cc2}
            blobs={blobs}
            seed={i}
            rand={rand}
          />
        );
      })}
    </group>
  );
}

function SwayingTree({
  position, scale, yaw, phase, cc, cc2, blobs, seed, rand,
}: {
  position: [number, number, number];
  scale: number;
  yaw: number;
  phase: number;
  cc: string;
  cc2: string;
  blobs: number;
  seed: number;
  rand: (i: number) => number;
}) {
  const canopyRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!canopyRef.current) return;
    const t = clock.getElapsedTime();
    canopyRef.current.rotation.z = Math.sin(t * 1.2 + phase) * 0.06;
    canopyRef.current.rotation.x = Math.cos(t * 0.9 + phase * 0.7) * 0.04;
    canopyRef.current.position.y = Math.sin(t * 1.6 + phase) * 0.05;
  });
  return (
    <group position={position} scale={scale} rotation={[0, yaw, 0]}>
      {/* Trunk (static) */}
      <mesh position={[0, 1.0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.09, 0.18, 2.0, 8]} />
        <meshStandardMaterial color="#4a3220" roughness={0.95} />
      </mesh>
      <mesh position={[0.15, 1.8, 0.05]} rotation={[0, 0, -0.4]} castShadow>
        <cylinderGeometry args={[0.04, 0.07, 0.9, 6]} />
        <meshStandardMaterial color="#4a3220" roughness={0.95} />
      </mesh>
      {/* Animated canopy */}
      <group ref={canopyRef} position={[0, 2.0, 0]}>
        {Array.from({ length: blobs }).map((_, k) => {
          const ang = (k / blobs) * Math.PI * 2 + rand(seed * 31 + k) * 0.6;
          const rad = 0.35 + rand(seed * 37 + k) * 0.55;
          const yj = rand(seed * 41 + k) * 0.9;
          const rr = 0.5 + rand(seed * 43 + k) * 0.5;
          return (
            <mesh key={k} position={[Math.cos(ang) * rad, yj, Math.sin(ang) * rad]} castShadow receiveShadow>
              <sphereGeometry args={[rr, 10, 8]} />
              <meshStandardMaterial color={k % 2 === 0 ? cc : cc2} roughness={0.95} />
            </mesh>
          );
        })}
        <mesh position={[0, 0.9, 0]} castShadow>
          <sphereGeometry args={[0.55, 10, 8]} />
          <meshStandardMaterial color={cc} roughness={0.95} />
        </mesh>
      </group>
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

export function ModelViewer3D({
  variation,
  planMode = "closed",
  kitchenOpen = false,
  timeOfDay = "day",
  autoRotate = false,
  showFurniture = true,
}: Props) {
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
          gl.toneMappingExposure = 1.15;
        }}
      >
        <Suspense fallback={null}>
          {/* Bright daylight sky */}
          <Sky
            distance={450000}
            sunPosition={[-0.6, 0.9, 0.4]}
            inclination={0.15}
            azimuth={0.25}
            turbidity={4}
            rayleigh={1.5}
            mieCoefficient={0.006}
            mieDirectionalG={0.8}
          />
          <fog attach="fog" args={["#dfe8ee", camDist * 3, camDist * 8]} />
          <ambientLight intensity={0.7} color="#ffffff" />
          {/* Sun */}
          <directionalLight
            position={[-camDist * 0.8, camDist * 1.4, camDist * 0.6]}
            intensity={1.4}
            color="#fff5e0"
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-camDist}
            shadow-camera-right={camDist}
            shadow-camera-top={camDist}
            shadow-camera-bottom={-camDist}
          />
          {/* Cool fill from opposite side */}
          <directionalLight position={[camDist, camDist * 0.7, -camDist * 0.6]} intensity={0.55} color="#e8f0ff" />
          <Environment preset="park" />

          <Plot variation={variation} />
          <ParkingArea variation={variation} />
          {visibleFloor === "all" && variation.plates.slice(1).map((upper, idx) => (
            <TerraceBridges
              key={`terrace-${upper.floor}`}
              lower={variation.plates[idx]}
              upper={upper}
              baseY={baseYs[idx + 1] - 0.08}
              variation={variation}
            />
          ))}
          {variation.plates
            .map((plate, i) => ({ plate, i }))
            .filter(({ plate }) => visibleFloor === "all" || plate.floor === visibleFloor)
            .map(({ plate, i }) => (
              <FloorMesh
                key={plate.floor}
                plate={plate}
                baseY={baseYs[i]}
                variation={variation}
                planMode={planMode}
                kitchenOpen={kitchenOpen}
                plotW={variation.plotWidthFt}
                plotD={variation.plotDepthFt}
                timeOfDay={timeOfDay}
                showFurniture={showFurniture}
              />
            ))}
          {visibleFloor === "all" && <Roof variation={variation} topY={topY} />}
          {visibleFloor === "all" && <ElevationFeatures variation={variation} topY={topY} />}
          {visibleFloor === "all" && <LiftShaft variation={variation} />}
          <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={camDist * 2.5} blur={2.4} far={camDist} />
          <OrbitControls
            enablePan={false}
            autoRotate={autoRotate}
            autoRotateSpeed={0.45}
            minDistance={camDist * 0.6}
            maxDistance={camDist * 2.8}
            maxPolarAngle={Math.PI / 2.05}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
