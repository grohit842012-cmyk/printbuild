import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import { useEffect, useMemo, useState, Suspense } from "react";
import * as THREE from "three";
import type { Variation, FloorPlate, RoomRect } from "@/lib/design-types";

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
  parking: "#cbd5e1",
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

function FloorMesh({
  plate, baseY, accent, planMode, kitchenOpen,
}: { plate: FloorPlate; baseY: number; accent: string; planMode: string; kitchenOpen: boolean }) {
  const cx = plate.x + plate.w / 2;
  const cz = plate.y + plate.h / 2;
  return (
    <group position={[(cx - 30) * FT_TO_M, baseY, (cz - 30) * FT_TO_M]}>
      {/* Floor slab */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[plate.w * FT_TO_M, 0.1, plate.h * FT_TO_M]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.85} />
      </mesh>
      {/* Outer perimeter wall */}
      <mesh position={[0, (FLOOR_HEIGHT * FT_TO_M) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[plate.w * FT_TO_M, FLOOR_HEIGHT * FT_TO_M, plate.h * FT_TO_M]} />
        <meshStandardMaterial color={accent} roughness={0.7} transparent opacity={0.0} />
      </mesh>
      {/* Outer wall as four box walls */}
      <OuterWalls plate={plate} accent={accent} />
      {/* Rooms */}
      {plate.rooms.map((r, i) => (
        <RoomBlock key={i} room={r} plate={plate} planMode={planMode} kitchenOpen={kitchenOpen} />
      ))}
    </group>
  );
}

function OuterWalls({ plate, accent }: { plate: FloorPlate; accent: string }) {
  const w = plate.w * FT_TO_M;
  const d = plate.h * FT_TO_M;
  const h = FLOOR_HEIGHT * FT_TO_M;
  const t = WALL_THICKNESS * FT_TO_M;
  const mat = <meshStandardMaterial color={accent} roughness={0.65} metalness={0.05} />;
  return (
    <group>
      <mesh position={[0, h / 2, -d / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />
        {mat}
      </mesh>
      <mesh position={[0, h / 2, d / 2]} castShadow receiveShadow>
        <boxGeometry args={[w, h, t]} />
        {mat}
      </mesh>
      <mesh position={[-w / 2, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, h, d]} />
        {mat}
      </mesh>
      <mesh position={[w / 2, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, h, d]} />
        {mat}
      </mesh>
    </group>
  );
}

function RoomBlock({
  room, plate, planMode, kitchenOpen,
}: { room: RoomRect; plate: FloorPlate; planMode: string; kitchenOpen: boolean }) {
  // Local coords relative to plate center
  const localX = (room.x + room.w / 2) - (plate.x + plate.w / 2);
  const localZ = (room.y + room.h / 2) - (plate.y + plate.h / 2);
  const w = room.w * FT_TO_M;
  const d = room.h * FT_TO_M;
  const h = (FLOOR_HEIGHT - 0.5) * FT_TO_M;
  const color = ROOM_COLORS[room.type] ?? "#e2e8f0";
  const open = isOpen(room.type, planMode, kitchenOpen);

  return (
    <group position={[localX * FT_TO_M, 0, localZ * FT_TO_M]}>
      {/* Floor patch (color hint) */}
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <boxGeometry args={[w * 0.96, 0.02, d * 0.96]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {/* Interior walls — only if not "open" */}
      {!open && room.type !== "stairs" && room.type !== "lift" && (
        <RoomWalls w={w} d={d} h={h} />
      )}
      {/* Special: stairs — slanted plank */}
      {room.type === "stairs" && (
        <mesh position={[0, h / 4, 0]} rotation={[Math.PI / 7, 0, 0]} castShadow>
          <boxGeometry args={[w * 0.7, 0.08, d]} />
          <meshStandardMaterial color="#64748b" roughness={0.6} />
        </mesh>
      )}
      {/* Special: lift shaft */}
      {room.type === "lift" && (
        <mesh position={[0, h / 2, 0]} castShadow>
          <boxGeometry args={[w * 0.9, h, d * 0.9]} />
          <meshStandardMaterial color="#475569" roughness={0.5} metalness={0.3} />
        </mesh>
      )}
      {/* Parking — show car silhouette block */}
      {room.type === "parking" && (
        <mesh position={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[w * 0.5, 0.6, d * 0.35]} />
          <meshStandardMaterial color="#334155" roughness={0.4} />
        </mesh>
      )}
    </group>
  );
}

function RoomWalls({ w, d, h }: { w: number; d: number; h: number }) {
  const t = WALL_THICKNESS * 0.6 * FT_TO_M;
  const mat = <meshStandardMaterial color="#f1f5f9" roughness={0.85} />;
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
  const center: [number, number, number] = [(cx - 30) * FT_TO_M, topY, (cz - 30) * FT_TO_M];

  if (variation.roofType === "domed") {
    return (
      <mesh position={center} castShadow>
        <sphereGeometry args={[Math.min(w, d) / 2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={variation.paletteAccent} roughness={0.5} metalness={0.2} />
      </mesh>
    );
  }
  if (variation.roofType === "sloped") {
    return (
      <group position={center}>
        <mesh rotation={[0, Math.PI / 4, 0]} position={[0, w * 0.18, 0]} castShadow>
          <coneGeometry args={[Math.max(w, d) * 0.72, w * 0.45, 4]} />
          <meshStandardMaterial color="#7c2d12" roughness={0.7} />
        </mesh>
      </group>
    );
  }
  // flat
  return (
    <mesh position={[center[0], topY + 0.05, center[2]]} castShadow receiveShadow>
      <boxGeometry args={[w + 0.2, 0.2, d + 0.2]} />
      <meshStandardMaterial color="#334155" roughness={0.7} />
    </mesh>
  );
}

function Plot({ variation }: { variation: Variation }) {
  const w = variation.plotWidthFt * FT_TO_M;
  const d = variation.plotDepthFt * FT_TO_M;
  return (
    <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w + 4, d + 4]} />
      <meshStandardMaterial color="#1e293b" roughness={0.95} />
    </mesh>
  );
}

function ParkingArea({ variation }: { variation: Variation }) {
  if (!variation.parking) return null;
  const p = variation.parking;
  const cx = p.x + p.w / 2;
  const cz = p.y + p.h / 2;
  return (
    <group position={[(cx - 30) * FT_TO_M, 0.02, (cz - 30) * FT_TO_M]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[p.w * FT_TO_M, p.h * FT_TO_M]} />
        <meshStandardMaterial color="#475569" roughness={0.85} />
      </mesh>
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

  return (
    <div className="w-full aspect-[4/3] rounded-xl overflow-hidden bg-gradient-to-br from-slate-900 to-slate-700">
      <Canvas
        shadows
        camera={{ position: [camDist, camDist * 0.8, camDist], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[10, 14, 6]}
            intensity={1.2}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <Environment preset="city" />
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
          <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={camDist * 2} blur={2} />
          <OrbitControls
            enablePan={false}
            minDistance={camDist * 0.6}
            maxDistance={camDist * 2.5}
            maxPolarAngle={Math.PI / 2.05}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
