import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Sky } from "@react-three/drei";
import { useEffect, useMemo, useState, Suspense, type ReactElement } from "react";
import * as THREE from "three";
import type { Variation, FloorPlate, RoomRect, Opening } from "@/lib/design-types";

const FLOOR_HEIGHT = 10; // ft
const WALL_THICKNESS = 0.45;
const FT_TO_M = 0.3048;

const ROOM_COLORS: Record<string, string> = {
  living: "#cfe0f5",
  kitchen: "#f4d9b4",
  bedroom: "#dfe5d3",
  master_bedroom: "#cdd9bd",
  bath: "#bcd5e8",
  pooja: "#f0e2c2",
  study: "#e1dfd0",
  dining: "#ecd6c8",
  courtyard: "#c8e3c5",
  stairs: "#b8c5d6",
  lift: "#94a3b8",
  utility: "#dcd6c8",
  parking: "#f7c873",
};

const PUBLIC_OPEN = new Set(["living", "dining", "kitchen", "courtyard"]);

interface Props {
  variation: Variation;
  planMode?: "open" | "closed";
  kitchenOpen?: boolean;
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
function PerimeterWalls({ plate, accent }: { plate: FloorPlate; accent: string }) {
  const t = WALL_THICKNESS * FT_TO_M;
  const h = FLOOR_HEIGHT * FT_TO_M;
  const winTop = 7 * FT_TO_M;
  const winBot = 3 * FT_TO_M;
  const doorH = 7 * FT_TO_M;

  // Warm stucco wall + crisp white trim around openings (uses accent only for sill band).
  const WALL_COLOR = "#efe4d2";   // warm cream stucco
  const TRIM_COLOR = "#fbfaf6";   // soft white
  const DOOR_COLOR = "#5a3a22";   // wood
  void accent;

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
          <meshStandardMaterial color={WALL_COLOR} roughness={0.85} />
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
            <meshStandardMaterial color={WALL_COLOR} roughness={0.85} />
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
            <meshStandardMaterial color={WALL_COLOR} roughness={0.85} />
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
            <meshStandardMaterial color={WALL_COLOR} roughness={0.85} />
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
  plate, baseY, accent, planMode, kitchenOpen, plotW, plotD,
}: { plate: FloorPlate; baseY: number; accent: string; planMode: string; kitchenOpen: boolean; plotW: number; plotD: number }) {
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
      <PerimeterWalls plate={plate} accent={accent} />
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
        <RoomWalls w={w} d={d} h={h} />
      )}
      {room.type === "stairs" && (
        <group>
          {Array.from({ length: 9 }).map((_, k) => (
            <mesh key={k} position={[0, k * (h / 9) * 0.5 + 0.05, -d / 2 + (k + 0.5) * (d / 9)]} castShadow>
              <boxGeometry args={[w * 0.7, 0.18, d / 9]} />
              <meshStandardMaterial color="#94a3b8" roughness={0.7} />
            </mesh>
          ))}
        </group>
      )}
      {room.type === "lift" && (
        <mesh position={[0, h / 2, 0]} castShadow>
          <boxGeometry args={[w * 0.9, h, d * 0.9]} />
          <meshStandardMaterial color="#475569" roughness={0.4} metalness={0.4} />
        </mesh>
      )}
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

function RoomWalls({ w, d, h }: { w: number; d: number; h: number }) {
  const t = WALL_THICKNESS * 0.5 * FT_TO_M;
  const mat = <meshStandardMaterial color="#f8fafc" roughness={0.85} />;
  return (
    <group>
      <mesh position={[0, h / 2, -d / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />{mat}
      </mesh>
      <mesh position={[0, h / 2, d / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />{mat}
      </mesh>
      <mesh position={[-w / 2, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, h, d]} />{mat}
      </mesh>
      <mesh position={[w / 2, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, h, d]} />{mat}
      </mesh>
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

  if (variation.roofType === "domed") {
    const r = Math.min(w, d) * 0.42;
    return (
      <group position={center}>
        {/* roof slab */}
        <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
          <boxGeometry args={[w + 0.4, 0.2, d + 0.4]} />
          <meshStandardMaterial color={TRIM} roughness={0.8} />
        </mesh>
        {/* dome */}
        <mesh position={[0, 0.2, 0]} castShadow>
          <sphereGeometry args={[r, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#c98a4b" roughness={0.45} metalness={0.25} />
        </mesh>
        {/* finial */}
        <mesh position={[0, 0.2 + r + 0.1, 0]} castShadow>
          <coneGeometry args={[0.15, 0.5, 12]} />
          <meshStandardMaterial color="#a16234" metalness={0.4} roughness={0.4} />
        </mesh>
      </group>
    );
  }
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
  // flat — slab + parapet (in cream trim, not navy)
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
  const cx = p.x + p.w / 2;
  const cz = p.y + p.h / 2;
  const toScene = makeToScene(variation.plotWidthFt, variation.plotDepthFt);
  const [sx, sz] = toScene(cx, cz);
  return (
    <group position={[sx, 0.02, sz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[p.w * FT_TO_M, p.h * FT_TO_M]} />
        <meshStandardMaterial color="#f7c873" roughness={0.85} />
      </mesh>
      {/* Bay stripes */}
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
}

export function ModelViewer3D({ variation, planMode = "closed", kitchenOpen = false }: Props) {
  const [mounted, setMounted] = useState(false);
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
    <div className="w-full aspect-[4/3] rounded-xl overflow-hidden">
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
          {variation.plates.map((plate, i) => (
            <FloorMesh
              key={plate.floor}
              plate={plate}
              baseY={baseYs[i]}
              accent={variation.paletteAccent}
              planMode={planMode}
              kitchenOpen={kitchenOpen}
            />
          ))}
          <Roof variation={variation} topY={topY} />
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
