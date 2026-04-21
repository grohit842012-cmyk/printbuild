import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { FloorPlate, Variation } from "@/lib/design-types";

interface Props {
  variation: Variation;
  visibleFloors: Set<number>;
  className?: string;
}

const FLOOR_HEIGHT = 10; // ft
const WALL_THICK = 0.6; // ft
const WINDOW_SILL = 3; // ft
const WINDOW_HEAD = 7; // ft
const DOOR_HEIGHT = 7; // ft

/** Build a rounded-rectangle Shape (in world units = feet, then we scale) */
function plateShape(p: FloorPlate): THREE.Shape {
  const shape = new THREE.Shape();
  const r = Math.min(p.cornerRadius, p.w / 2, p.h / 2);
  const x = p.x;
  const y = p.y;
  const w = p.w;
  const h = p.h;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

export function ModelViewer3D({ variation, visibleFloors, className }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const buildingGroupRef = useRef<THREE.Group | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#dde8f4");
    scene.fog = new THREE.Fog("#dde8f4", 200, 380);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.5, 2000);
    camera.position.set(80, 70, 100);
    camera.lookAt(0, 8, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    scene.add(new THREE.HemisphereLight(0xeaf2ff, 0xb8a890, 0.65));
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const sun = new THREE.DirectionalLight(0xfff4d6, 1.25);
    sun.position.set(60, 130, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // Grass ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(160, 64),
      new THREE.MeshStandardMaterial({ color: "#9bb592", roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Stone plinth under building
    const plinth = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: "#c8b89a", roughness: 0.85 }),
    );
    plinth.rotation.x = -Math.PI / 2;
    plinth.position.y = 0.05;
    plinth.receiveShadow = true;
    scene.add(plinth);

    // North marker
    const north = new THREE.Mesh(
      new THREE.ConeGeometry(2, 5, 6),
      new THREE.MeshStandardMaterial({ color: "#3b6db8" }),
    );
    north.position.set(0, 2.5, -110);
    scene.add(north);

    const buildingGroup = new THREE.Group();
    scene.add(buildingGroup);
    buildingGroupRef.current = buildingGroup;

    let raf = 0;
    let theta = Math.PI * 0.25;
    let userInteracting = false;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let elev = 0.55;
    let dist = 145;

    function animate() {
      if (!userInteracting) theta += 0.0012;
      const r = dist * Math.cos(elev);
      camera.position.set(Math.sin(theta) * r, dist * Math.sin(elev), Math.cos(theta) * r);
      camera.lookAt(0, 8, 0);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    }
    animate();

    function onResize() {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener("resize", onResize);

    function onDown(e: PointerEvent) {
      userInteracting = true;
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
    }
    function onMove(e: PointerEvent) {
      if (!userInteracting) return;
      const dx = e.clientX - pointerDownX;
      const dy = e.clientY - pointerDownY;
      theta -= dx * 0.005;
      elev = Math.max(0.15, Math.min(1.35, elev + dy * 0.003));
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
    }
    function onUp() { userInteracting = false; }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      dist = Math.max(60, Math.min(280, dist + e.deltaY * 0.12));
    }
    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("wheel", onWheel);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // Rebuild geometry from architectural plates
  useEffect(() => {
    const group = buildingGroupRef.current;
    if (!group) return;
    while (group.children.length) {
      const c = group.children.pop();
      if (c) {
        if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
      }
    }

    const accent = variation.paletteAccent;
    const wallMat = new THREE.MeshStandardMaterial({ color: "#f1ede4", roughness: 0.85 });
    const slabMat = new THREE.MeshStandardMaterial({ color: "#cbd5e1", roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: "#9ec5e8", roughness: 0.15, metalness: 0.1,
      transparent: true, opacity: 0.55,
    });
    const interiorMat = new THREE.MeshStandardMaterial({ color: "#e7ddc8", roughness: 0.9 });
    const doorMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 });

    // Center the building
    const cx = -variation.plotWidthFt / 2;
    const cy = -variation.plotDepthFt / 2;
    group.position.set(cx, 0, cy);

    const sortedPlates = [...variation.plates].sort((a, b) => a.floor - b.floor);
    const topFloor = sortedPlates[sortedPlates.length - 1].floor;

    for (const plate of sortedPlates) {
      if (!visibleFloors.has(plate.floor)) continue;
      const yBase = (plate.floor - 1) * FLOOR_HEIGHT;

      // Outer shell (hollow rounded rect) — extruded from outline minus inset
      const outer = plateShape(plate);
      const innerInset = WALL_THICK;
      const inner = plateShape({
        ...plate,
        x: plate.x + innerInset,
        y: plate.y + innerInset,
        w: plate.w - innerInset * 2,
        h: plate.h - innerInset * 2,
        cornerRadius: Math.max(0, plate.cornerRadius - innerInset),
      });
      const innerPath = new THREE.Path(inner.getPoints(48));
      outer.holes = [innerPath];

      const wallGeom = new THREE.ExtrudeGeometry(outer, {
        depth: FLOOR_HEIGHT * 0.92,
        bevelEnabled: false,
        steps: 1,
        curveSegments: 16,
      });
      wallGeom.rotateX(-Math.PI / 2);
      wallGeom.translate(0, yBase, 0);
      const walls = new THREE.Mesh(wallGeom, wallMat);
      walls.castShadow = true;
      walls.receiveShadow = true;
      group.add(walls);

      // Floor slab
      const slabGeom = new THREE.ExtrudeGeometry(plateShape(plate), {
        depth: 0.5, bevelEnabled: false, curveSegments: 16,
      });
      slabGeom.rotateX(-Math.PI / 2);
      slabGeom.translate(0, yBase, 0);
      const slab = new THREE.Mesh(slabGeom, slabMat);
      slab.receiveShadow = true;
      group.add(slab);

      // Interior partition walls between rooms (simple thin boxes on shared edges)
      const tol = 0.6;
      const drawn = new Set<string>();
      for (let i = 0; i < plate.rooms.length; i++) {
        const a = plate.rooms[i];
        for (let j = i + 1; j < plate.rooms.length; j++) {
          const b = plate.rooms[j];
          // Vertical shared wall
          if (Math.abs(a.x + a.w - b.x) < tol || Math.abs(b.x + b.w - a.x) < tol) {
            const x = Math.abs(a.x + a.w - b.x) < tol ? a.x + a.w : a.x;
            const y0 = Math.max(a.y, b.y);
            const y1 = Math.min(a.y + a.h, b.y + b.h);
            if (y1 - y0 > 1) {
              const key = `v-${x.toFixed(1)}-${y0.toFixed(1)}-${y1.toFixed(1)}`;
              if (drawn.has(key)) continue;
              drawn.add(key);
              const len = y1 - y0;
              const geom = new THREE.BoxGeometry(WALL_THICK * 0.6, FLOOR_HEIGHT * 0.92, len);
              const m = new THREE.Mesh(geom, interiorMat);
              m.position.set(x, yBase + (FLOOR_HEIGHT * 0.92) / 2, (y0 + y1) / 2);
              m.castShadow = true;
              group.add(m);
            }
          }
          // Horizontal shared wall
          if (Math.abs(a.y + a.h - b.y) < tol || Math.abs(b.y + b.h - a.y) < tol) {
            const y = Math.abs(a.y + a.h - b.y) < tol ? a.y + a.h : a.y;
            const x0 = Math.max(a.x, b.x);
            const x1 = Math.min(a.x + a.w, b.x + b.w);
            if (x1 - x0 > 1) {
              const key = `h-${y.toFixed(1)}-${x0.toFixed(1)}-${x1.toFixed(1)}`;
              if (drawn.has(key)) continue;
              drawn.add(key);
              const len = x1 - x0;
              const geom = new THREE.BoxGeometry(len, FLOOR_HEIGHT * 0.92, WALL_THICK * 0.6);
              const m = new THREE.Mesh(geom, interiorMat);
              m.position.set((x0 + x1) / 2, yBase + (FLOOR_HEIGHT * 0.92) / 2, y);
              m.castShadow = true;
              group.add(m);
            }
          }
        }
      }

      // Windows + doors as thin glass / accent boxes on the wall
      for (const o of plate.openings) {
        const dx = o.x2 - o.x1;
        const dz = o.y2 - o.y1;
        const len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        const cxO = (o.x1 + o.x2) / 2;
        const cyO = (o.y1 + o.y2) / 2;
        const angle = Math.atan2(dz, dx);
        if (o.kind === "window") {
          const h = WINDOW_HEAD - WINDOW_SILL;
          const geom = new THREE.BoxGeometry(len, h, 0.3);
          const m = new THREE.Mesh(geom, glassMat);
          m.position.set(cxO, yBase + WINDOW_SILL + h / 2, cyO);
          m.rotation.y = -angle;
          group.add(m);
        } else {
          const geom = new THREE.BoxGeometry(len, DOOR_HEIGHT, 0.3);
          const m = new THREE.Mesh(geom, doorMat);
          m.position.set(cxO, yBase + DOOR_HEIGHT / 2, cyO);
          m.rotation.y = -angle;
          group.add(m);
        }
      }

      // Roof on top floor
      if (plate.floor === topFloor) {
        const roofY = yBase + FLOOR_HEIGHT;
        if (variation.roofType === "domed") {
          const r = Math.min(plate.w, plate.h) * 0.45;
          const dome = new THREE.Mesh(
            new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
            roofMat,
          );
          dome.position.set(plate.x + plate.w / 2, roofY, plate.y + plate.h / 2);
          dome.castShadow = true;
          group.add(dome);
        } else if (variation.roofType === "sloped") {
          const slope = new THREE.Mesh(
            new THREE.ConeGeometry(Math.min(plate.w, plate.h) * 0.62, FLOOR_HEIGHT * 0.6, 4),
            roofMat,
          );
          slope.position.set(plate.x + plate.w / 2, roofY + FLOOR_HEIGHT * 0.3, plate.y + plate.h / 2);
          slope.rotation.y = Math.PI / 4;
          slope.castShadow = true;
          group.add(slope);
        } else {
          const roofGeom = new THREE.ExtrudeGeometry(plateShape(plate), {
            depth: 0.6, bevelEnabled: false, curveSegments: 16,
          });
          roofGeom.rotateX(-Math.PI / 2);
          roofGeom.translate(0, roofY, 0);
          const flat = new THREE.Mesh(roofGeom, roofMat);
          flat.castShadow = true;
          group.add(flat);
        }
      }
    }

    // Entrance porch + columns + arch
    const a = (variation.entranceAngleDeg * Math.PI) / 180;
    const reach = Math.min(variation.plotWidthFt, variation.plotDepthFt) * 0.45;
    const px = variation.plotWidthFt / 2 + Math.sin(a) * reach;
    const pz = variation.plotDepthFt / 2 - Math.cos(a) * reach;

    const porch = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: "#b8a78a", roughness: 0.85 }),
    );
    porch.position.set(px, 0.25, pz);
    porch.rotation.y = -a;
    porch.receiveShadow = true;
    porch.castShadow = true;
    group.add(porch);

    const colMat = new THREE.MeshStandardMaterial({ color: "#f1ede4", roughness: 0.8 });
    for (const off of [-3, 3]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, DOOR_HEIGHT + 1, 16),
        colMat,
      );
      col.position.set(px + Math.cos(a) * off, (DOOR_HEIGHT + 1) / 2, pz + Math.sin(a) * off);
      col.castShadow = true;
      group.add(col);
    }

    const ent = new THREE.Mesh(
      new THREE.TorusGeometry(3, 0.5, 10, 24, Math.PI),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 }),
    );
    ent.position.set(px, 3, pz);
    ent.rotation.y = -a;
    group.add(ent);
  }, [variation, visibleFloors]);

  return <div ref={mountRef} className={className ?? "w-full h-full"} />;
}
