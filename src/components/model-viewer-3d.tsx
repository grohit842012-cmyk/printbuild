import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Variation } from "@/lib/design-types";

interface Props {
  variation: Variation;
  visibleFloors: Set<number>;
  className?: string;
}

/** Three.js viewer that builds curved-wall lofted geometry from a variation. */
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
    scene.background = new THREE.Color("#f5efe2");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 1000);
    camera.position.set(8, 7, 10);
    camera.lookAt(0, 1.5, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(8, 14, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -10;
    dir.shadow.camera.right = 10;
    dir.shadow.camera.top = 10;
    dir.shadow.camera.bottom = -10;
    scene.add(dir);

    // Ground plate
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(7, 64),
      new THREE.MeshStandardMaterial({ color: "#e6dcc6", roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Compass marker
    const compass = new THREE.Mesh(
      new THREE.RingGeometry(6.2, 6.5, 64),
      new THREE.MeshBasicMaterial({ color: "#b8693a" }),
    );
    compass.rotation.x = -Math.PI / 2;
    compass.position.y = 0.01;
    scene.add(compass);

    // North marker (small cone)
    const north = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: "#b8693a" }),
    );
    north.position.set(0, 0.25, -6.5);
    north.rotation.x = Math.PI;
    scene.add(north);

    // Building group
    const buildingGroup = new THREE.Group();
    scene.add(buildingGroup);
    buildingGroupRef.current = buildingGroup;

    // Animation loop with simple orbit
    let raf = 0;
    let theta = 0;
    let userInteracting = false;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let angle = Math.atan2(camera.position.x, camera.position.z);
    let elev = Math.asin(camera.position.y / camera.position.length());
    let dist = camera.position.length();

    function animate() {
      if (!userInteracting) theta += 0.0015;
      else theta = angle;
      const r = dist * Math.cos(elev);
      camera.position.set(Math.sin(theta) * r, dist * Math.sin(elev), Math.cos(theta) * r);
      camera.lookAt(0, 1.2, 0);
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

    // Pointer drag to rotate
    function onDown(e: PointerEvent) {
      userInteracting = true;
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
      angle = theta;
    }
    function onMove(e: PointerEvent) {
      if (!userInteracting) return;
      const dx = e.clientX - pointerDownX;
      const dy = e.clientY - pointerDownY;
      angle = theta - dx * 0.005;
      elev = Math.max(0.1, Math.min(1.3, elev + dy * 0.003));
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
    }
    function onUp() { userInteracting = false; }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      dist = Math.max(5, Math.min(25, dist + e.deltaY * 0.01));
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

  // Rebuild building geometry when variation or visible floors change
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
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: "#efe4cc",
      roughness: 0.85,
      metalness: 0.05,
    });
    const slabMaterial = new THREE.MeshStandardMaterial({
      color: "#d9cdb3",
      roughness: 0.9,
    });
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: accent,
      roughness: 0.7,
    });

    const PLOT_SIZE = 9; // world units
    const FLOOR_HEIGHT = 1.6;

    for (const outline of variation.floorOutlines) {
      if (!visibleFloors.has(outline.floor)) continue;
      const yBase = (outline.floor - 1) * FLOOR_HEIGHT;

      // Build wall as ExtrudeGeometry from closed shape (with curved bezier-smoothed points)
      const shape = new THREE.Shape();
      const pts = outline.points.map((p) => ({
        x: (p.x - 0.5) * PLOT_SIZE,
        y: (p.y - 0.5) * PLOT_SIZE,
      }));
      shape.moveTo(pts[0].x, pts[0].y);
      // Smooth via Catmull-Rom-like approximation
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const c = pts[(i + 2) % pts.length];
        const cp1x = (a.x + b.x) / 2;
        const cp1y = (a.y + b.y) / 2;
        const cp2x = b.x;
        const cp2y = b.y;
        const endx = (b.x + c.x) / 2;
        const endy = (b.y + c.y) / 2;
        shape.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endx, endy);
      }
      shape.closePath();

      // Inner hole for hollow walls
      const innerScale = 0.92;
      const hole = new THREE.Path();
      hole.moveTo(pts[0].x * innerScale, pts[0].y * innerScale);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const c = pts[(i + 2) % pts.length];
        const cp1x = ((a.x + b.x) / 2) * innerScale;
        const cp1y = ((a.y + b.y) / 2) * innerScale;
        const cp2x = b.x * innerScale;
        const cp2y = b.y * innerScale;
        const endx = ((b.x + c.x) / 2) * innerScale;
        const endy = ((b.y + c.y) / 2) * innerScale;
        hole.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endx, endy);
      }
      hole.closePath();
      shape.holes.push(hole);

      const wallGeom = new THREE.ExtrudeGeometry(shape, {
        depth: FLOOR_HEIGHT * 0.92,
        bevelEnabled: false,
        steps: 1,
      });
      wallGeom.rotateX(-Math.PI / 2);
      const walls = new THREE.Mesh(wallGeom, wallMaterial);
      walls.position.y = yBase;
      walls.castShadow = true;
      walls.receiveShadow = true;
      group.add(walls);

      // Floor slab
      const slabShape = new THREE.Shape();
      slabShape.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const c = pts[(i + 2) % pts.length];
        slabShape.bezierCurveTo(
          (a.x + b.x) / 2, (a.y + b.y) / 2,
          b.x, b.y,
          (b.x + c.x) / 2, (b.y + c.y) / 2,
        );
      }
      slabShape.closePath();
      const slabGeom = new THREE.ExtrudeGeometry(slabShape, { depth: 0.08, bevelEnabled: false });
      slabGeom.rotateX(-Math.PI / 2);
      const slab = new THREE.Mesh(slabGeom, slabMaterial);
      slab.position.y = yBase;
      slab.receiveShadow = true;
      group.add(slab);

      // Roof on top floor
      if (outline.floor === Math.max(...variation.floorOutlines.map((o) => o.floor))) {
        const roofY = yBase + FLOOR_HEIGHT;
        if (variation.roofType === "domed") {
          const roof = new THREE.Mesh(
            new THREE.SphereGeometry(PLOT_SIZE * 0.42, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
            roofMaterial,
          );
          roof.position.y = roofY;
          roof.castShadow = true;
          group.add(roof);
        } else if (variation.roofType === "sloped") {
          const roof = new THREE.Mesh(
            new THREE.ConeGeometry(PLOT_SIZE * 0.5, PLOT_SIZE * 0.25, 32),
            roofMaterial,
          );
          roof.position.y = roofY + PLOT_SIZE * 0.125;
          roof.castShadow = true;
          group.add(roof);
        } else {
          const roof = new THREE.Mesh(slabGeom.clone(), roofMaterial);
          roof.position.y = roofY;
          roof.castShadow = true;
          group.add(roof);
        }
      }
    }

    // Entrance marker (small arch)
    const angle = (variation.entranceAngleDeg * Math.PI) / 180;
    const ent = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.08, 8, 24, Math.PI),
      new THREE.MeshStandardMaterial({ color: accent }),
    );
    ent.position.set(Math.sin(angle) * (PLOT_SIZE * 0.42), 0.45, Math.cos(angle) * (PLOT_SIZE * 0.42));
    ent.rotation.y = -angle;
    group.add(ent);
  }, [variation, visibleFloors]);

  return <div ref={mountRef} className={className ?? "w-full h-full"} />;
}
