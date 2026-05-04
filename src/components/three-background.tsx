import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

function FloatingBlueprint() {
  const grp = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!grp.current) return;
    const t = state.clock.elapsedTime;
    grp.current.rotation.x = -0.4 + Math.sin(t * 0.2) * 0.05;
    grp.current.rotation.z = Math.cos(t * 0.15) * 0.04;
    grp.current.position.y = Math.sin(t * 0.3) * 0.2;
  });

  // Floating wireframe houses
  const houses = useMemo(() => {
    const arr: { pos: [number, number, number]; size: [number, number, number]; speed: number }[] = [];
    for (let i = 0; i < 8; i++) {
      arr.push({
        pos: [(Math.random() - 0.5) * 18, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8 - 2],
        size: [1 + Math.random() * 1.5, 0.8 + Math.random(), 1 + Math.random() * 1.5],
        speed: 0.2 + Math.random() * 0.5,
      });
    }
    return arr;
  }, []);

  return (
    <group ref={grp}>
      {/* Blueprint grid plane */}
      <gridHelper args={[40, 40, "#3b6db8", "#1e3a6e"]} position={[0, -2, 0]} />
      <gridHelper args={[40, 40, "#3b6db8", "#1e3a6e"]} position={[0, -2, 0]} rotation={[0, Math.PI / 4, 0]} />
      {houses.map((h, i) => (
        <FloatingHouse key={i} {...h} />
      ))}
    </group>
  );
}

function FloatingHouse({ pos, size, speed }: { pos: [number, number, number]; size: [number, number, number]; speed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime * speed;
    ref.current.position.y = pos[1] + Math.sin(t) * 0.3;
    ref.current.rotation.y = t * 0.3;
  });
  return (
    <group ref={ref} position={pos}>
      <mesh>
        <boxGeometry args={size} />
        <meshBasicMaterial color="#4a7fc1" wireframe transparent opacity={0.4} />
      </mesh>
      <mesh position={[0, size[1] / 2 + 0.3, 0]}>
        <coneGeometry args={[Math.max(size[0], size[2]) * 0.75, 0.6, 4]} />
        <meshBasicMaterial color="#5b8fd1" wireframe transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

export function ThreeBackground() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none opacity-60">
      <Canvas camera={{ position: [0, 1, 8], fov: 60 }} dpr={[1, 1.5]}>
        <fog attach="fog" args={["hsl(220 40% 8%)", 6, 22]} />
        <color attach="background" args={["hsl(220 40% 8%)"]} />
        <ambientLight intensity={0.5} />
        <FloatingBlueprint />
      </Canvas>
    </div>
  );
}
