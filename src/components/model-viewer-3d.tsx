import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { FloorPlate, Opening, RoomRect, Variation } from "@/lib/design-types";

interface Props {
  variation: Variation;
  visibleFloors: Set<number>;
  className?: string;
}

const GROUND_FLOOR_HEIGHT = 11; // ft
const UPPER_FLOOR_HEIGHT = 10; // ft
const PLINTH_HEIGHT = 1.5; // ft
const ROOF_OVERHANG = 1.5; // ft
const WALL_THICK = 0.5; // ft (exterior + interior walls)
const WINDOW_SILL = 3; // ft
const WINDOW_HEAD = 7; // ft
const DOOR_HEIGHT = 7; // ft
const TOL = 0.4; // ft tolerance for adjacency tests

function floorBaseY(floorNum: number): number {
  // floor 1 base = plinth top
  let y = PLINTH_HEIGHT;
  for (let f = 1; f < floorNum; f++) {
    y += f === 1 ? GROUND_FLOOR_HEIGHT : UPPER_FLOOR_HEIGHT;
  }
  return y;
}

function floorHeight(floorNum: number): number {
  return floorNum === 1 ? GROUND_FLOOR_HEIGHT : UPPER_FLOOR_HEIGHT;
}

type WallSide = "N" | "E" | "S" | "W";

interface RoomFootprintBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function roomsBounds(rooms: RoomRect[]): RoomFootprintBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  return { minX, maxX, minY, maxY };
}

/** Classify and build a wall segment along one side of a room.
 *  Returns segments split around any openings on that wall. */
interface WallSegment {
  // Centerline endpoints in plate coords (x,z)
  x1: number; z1: number;
  x2: number; z2: number;
  // Bottom Y and top Y for this wall
  yBottom: number;
  yTop: number;
  thickness: number;
}

function buildWallBoxFromCenterline(
  seg: WallSegment,
  material: THREE.Material,
): THREE.Mesh {
  const dx = seg.x2 - seg.x1;
  const dz = seg.z2 - seg.z1;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  const height = seg.yTop - seg.yBottom;
  const geom = new THREE.BoxGeometry(length, height, seg.thickness);
  const m = new THREE.Mesh(geom, material);
  m.position.set(
    (seg.x1 + seg.x2) / 2,
    seg.yBottom + height / 2,
    (seg.z1 + seg.z2) / 2,
  );
  m.rotation.y = -angle;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Get the world-space endpoints (x1,z1)-(x2,z2) of a room wall side. */
function roomWallEndpoints(
  r: RoomRect,
  side: WallSide,
): { x1: number; z1: number; x2: number; z2: number } {
  if (side === "N") return { x1: r.x, z1: r.y, x2: r.x + r.w, z2: r.y };
  if (side === "S") return { x1: r.x, z1: r.y + r.h, x2: r.x + r.w, z2: r.y + r.h };
  if (side === "W") return { x1: r.x, z1: r.y, x2: r.x, z2: r.y + r.h };
  // E
  return { x1: r.x + r.w, z1: r.y, x2: r.x + r.w, z2: r.y + r.h };
}

/** Sorted endpoint key for de-duplicating shared walls between rooms. */
function wallKey(x1: number, z1: number, x2: number, z2: number): string {
  const a = `${x1.toFixed(2)},${z1.toFixed(2)}`;
  const b = `${x2.toFixed(2)},${z2.toFixed(2)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Find all openings that belong to a given room+side. */
function openingsForRoomSide(
  plate: FloorPlate,
  roomIndex: number,
  side: WallSide,
  r: RoomRect,
): Opening[] {
  const result: Opening[] = [];
  for (const o of plate.openings) {
    // Prefer the tagged path
    if (o.roomIndex === roomIndex && o.wall === side) {
      result.push(o);
      continue;
    }
    if (o.roomIndex != null && o.roomIndex !== roomIndex) continue;
    // Geometric fallback: opening endpoints lie on this wall line
    if (side === "N" && Math.abs(o.y1 - r.y) < TOL && Math.abs(o.y2 - r.y) < TOL) {
      if (o.x1 >= r.x - TOL && o.x2 <= r.x + r.w + TOL) result.push(o);
    } else if (side === "S" && Math.abs(o.y1 - (r.y + r.h)) < TOL && Math.abs(o.y2 - (r.y + r.h)) < TOL) {
      if (o.x1 >= r.x - TOL && o.x2 <= r.x + r.w + TOL) result.push(o);
    } else if (side === "W" && Math.abs(o.x1 - r.x) < TOL && Math.abs(o.x2 - r.x) < TOL) {
      if (o.y1 >= r.y - TOL && o.y2 <= r.y + r.h + TOL) result.push(o);
    } else if (side === "E" && Math.abs(o.x1 - (r.x + r.w)) < TOL && Math.abs(o.x2 - (r.x + r.w)) < TOL) {
      if (o.y1 >= r.y - TOL && o.y2 <= r.y + r.h + TOL) result.push(o);
    }
  }
  return result;
}

/** Add a wall along (x1,z1)-(x2,z2) split around openings. Builds bottom-strip
 *  for windows (sill below glass) + top-strip (lintel) + jamb columns between
 *  openings. */
function addWallWithOpenings(
  group: THREE.Group,
  x1: number, z1: number, x2: number, z2: number,
  yBase: number,
  wallH: number,
  thickness: number,
  openings: Opening[],
  wallMat: THREE.Material,
  frameMat: THREE.Material,
  glassMat: THREE.Material,
) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.1) return;
  const ux = dx / length;
  const uz = dz / length;

  // Project each opening onto this wall as [t0..t1] in [0..length]
  type Span = { t0: number; t1: number; kind: "door" | "window" };
  const spans: Span[] = [];
  for (const o of openings) {
    const omx = (o.x1 + o.x2) / 2;
    const omz = (o.y1 + o.y2) / 2;
    // Project center onto wall axis
    const tCenter = (omx - x1) * ux + (omz - z1) * uz;
    const half = o.width / 2;
    const t0 = Math.max(0, tCenter - half);
    const t1 = Math.min(length, tCenter + half);
    if (t1 - t0 < 0.2) continue;
    spans.push({ t0, t1, kind: o.kind });
  }
  spans.sort((a, b) => a.t0 - b.t0);

  // Build solid wall segments between openings (full height)
  let cursor = 0;
  for (const sp of spans) {
    if (sp.t0 > cursor + 0.05) {
      addWallSliver(group, x1, z1, ux, uz, cursor, sp.t0, yBase, yBase + wallH, thickness, wallMat);
    }
    if (sp.kind === "window") {
      // Sill below
      addWallSliver(group, x1, z1, ux, uz, sp.t0, sp.t1, yBase, yBase + WINDOW_SILL, thickness, wallMat);
      // Lintel above
      addWallSliver(group, x1, z1, ux, uz, sp.t0, sp.t1, yBase + WINDOW_HEAD, yBase + wallH, thickness, wallMat);
      // Glass pane in opening
      const cx = x1 + ux * (sp.t0 + sp.t1) / 2;
      const cz = z1 + uz * (sp.t0 + sp.t1) / 2;
      const w = sp.t1 - sp.t0;
      const h = WINDOW_HEAD - WINDOW_SILL;
      const angle = Math.atan2(uz, ux);
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, 0.18),
        glassMat,
      );
      glass.position.set(cx, yBase + WINDOW_SILL + h / 2, cz);
      glass.rotation.y = -angle;
      group.add(glass);
      // Frame: sill cap + lintel cap + jambs
      const sillCap = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.4, 0.3, thickness + 0.3),
        frameMat,
      );
      sillCap.position.set(cx, yBase + WINDOW_SILL - 0.05, cz);
      sillCap.rotation.y = -angle;
      sillCap.castShadow = true;
      group.add(sillCap);
      const lintelCap = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.4, 0.35, thickness + 0.3),
        frameMat,
      );
      lintelCap.position.set(cx, yBase + WINDOW_HEAD + 0.1, cz);
      lintelCap.rotation.y = -angle;
      lintelCap.castShadow = true;
      group.add(lintelCap);
    } else {
      // Door: lintel only above
      addWallSliver(group, x1, z1, ux, uz, sp.t0, sp.t1, yBase + DOOR_HEIGHT, yBase + wallH, thickness, wallMat);
      // Door frame on top
      const cx = x1 + ux * (sp.t0 + sp.t1) / 2;
      const cz = z1 + uz * (sp.t0 + sp.t1) / 2;
      const angle = Math.atan2(uz, ux);
      const w = sp.t1 - sp.t0;
      const lintelCap = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.4, 0.4, thickness + 0.3),
        frameMat,
      );
      lintelCap.position.set(cx, yBase + DOOR_HEIGHT + 0.1, cz);
      lintelCap.rotation.y = -angle;
      lintelCap.castShadow = true;
      group.add(lintelCap);
    }
    cursor = sp.t1;
  }
  if (cursor < length - 0.05) {
    addWallSliver(group, x1, z1, ux, uz, cursor, length, yBase, yBase + wallH, thickness, wallMat);
  }
}

function addWallSliver(
  group: THREE.Group,
  x1: number, z1: number,
  ux: number, uz: number,
  t0: number, t1: number,
  yBottom: number, yTop: number,
  thickness: number,
  mat: THREE.Material,
) {
  const len = t1 - t0;
  const h = yTop - yBottom;
  if (len < 0.05 || h < 0.05) return;
  const cx = x1 + ux * (t0 + t1) / 2;
  const cz = z1 + uz * (t0 + t1) / 2;
  const angle = Math.atan2(uz, ux);
  const geom = new THREE.BoxGeometry(len, h, thickness);
  const m = new THREE.Mesh(geom, mat);
  m.position.set(cx, yBottom + h / 2, cz);
  m.rotation.y = -angle;
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
}

/** Determine if a room side is on the building exterior (touches plate bbox). */
function isExterior(r: RoomRect, side: WallSide, b: RoomFootprintBounds): boolean {
  if (side === "N") return Math.abs(r.y - b.minY) < TOL;
  if (side === "S") return Math.abs(r.y + r.h - b.maxY) < TOL;
  if (side === "W") return Math.abs(r.x - b.minX) < TOL;
  return Math.abs(r.x + r.w - b.maxX) < TOL;
}

/** Determine if a room side touches the hallway rectangle. */
function touchesHallway(
  r: RoomRect,
  side: WallSide,
  hall: { x: number; y: number; w: number; h: number } | undefined,
): boolean {
  if (!hall) return false;
  if (side === "E") {
    return Math.abs(r.x + r.w - hall.x) < TOL &&
      !(r.y + r.h <= hall.y || r.y >= hall.y + hall.h);
  }
  if (side === "W") {
    return Math.abs(r.x - (hall.x + hall.w)) < TOL &&
      !(r.y + r.h <= hall.y || r.y >= hall.y + hall.h);
  }
  if (side === "S") {
    return Math.abs(r.y + r.h - hall.y) < TOL &&
      !(r.x + r.w <= hall.x || r.x >= hall.x + hall.w);
  }
  // N
  return Math.abs(r.y - (hall.y + hall.h)) < TOL &&
    !(r.x + r.w <= hall.x || r.x >= hall.x + hall.w);
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

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(160, 64),
      new THREE.MeshStandardMaterial({ color: "#9bb592", roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

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

  // Rebuild geometry from architectural plates — room-driven, not plate-shell.
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
    const wallMat = new THREE.MeshStandardMaterial({ color: "#f5efe2", roughness: 0.85 });
    const interiorMat = new THREE.MeshStandardMaterial({ color: "#ece2cc", roughness: 0.9 });
    const trimMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.55 });
    const slabMat = new THREE.MeshStandardMaterial({ color: "#cbd5e1", roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: "#a89b86", roughness: 0.95 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: "#9ec5e8", roughness: 0.15, metalness: 0.1,
      transparent: true, opacity: 0.55,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: "#3a3024", roughness: 0.7 });
    const stairMat = new THREE.MeshStandardMaterial({ color: "#9ca3af", roughness: 0.75 });
    const hallwayMat = new THREE.MeshStandardMaterial({ color: "#d6cbb1", roughness: 0.9 });

    // Center building on origin
    const cx = -variation.plotWidthFt / 2;
    const cy = -variation.plotDepthFt / 2;
    group.position.set(cx, 0, cy);

    const sortedPlates = [...variation.plates].sort((a, b) => a.floor - b.floor);
    const groundPlate = sortedPlates[0];
    const topFloor = sortedPlates[sortedPlates.length - 1].floor;

    // ------- Plinth: plate rectangle padded outward (single clean footprint) -------
    if (groundPlate) {
      const pad = 0.8;
      const plinthGeom = new THREE.BoxGeometry(
        groundPlate.w + pad * 2,
        PLINTH_HEIGHT,
        groundPlate.h + pad * 2,
      );
      const plinth = new THREE.Mesh(plinthGeom, stoneMat);
      plinth.position.set(
        groundPlate.x + groundPlate.w / 2,
        PLINTH_HEIGHT / 2,
        groundPlate.y + groundPlate.h / 2,
      );
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      group.add(plinth);
    }

    for (const plate of sortedPlates) {
      if (!visibleFloors.has(plate.floor)) continue;
      const yBase = floorBaseY(plate.floor);
      const fH = floorHeight(plate.floor);
      const wallH = fH * 0.92;

      const bounds = roomsBounds(plate.rooms);

      // ------- Floor slab: single plate rectangle (rooms fully tile this) -------
      const slabGeom = new THREE.BoxGeometry(plate.w, 0.5, plate.h);
      const slab = new THREE.Mesh(slabGeom, slabMat);
      slab.position.set(plate.x + plate.w / 2, yBase + 0.25, plate.y + plate.h / 2);
      slab.receiveShadow = true;
      group.add(slab);

      // ------- Hallway tile on top of slab -------
      if (plate.hallway) {
        const hwGeom = new THREE.BoxGeometry(plate.hallway.w, 0.15, plate.hallway.h);
        const hw = new THREE.Mesh(hwGeom, hallwayMat);
        hw.position.set(
          plate.hallway.x + plate.hallway.w / 2,
          yBase + 0.55,
          plate.hallway.y + plate.hallway.h / 2,
        );
        hw.receiveShadow = true;
        group.add(hw);
      }

      // ------- Per-room walls -------
      const drawnShared = new Set<string>();
      for (let ri = 0; ri < plate.rooms.length; ri++) {
        const r = plate.rooms[ri];
        const sides: WallSide[] = ["N", "E", "S", "W"];
        for (const side of sides) {
          const ep = roomWallEndpoints(r, side);
          const exterior = isExterior(r, side, bounds);
          const hallSide = touchesHallway(r, side, plate.hallway);

          // For shared room/room walls, dedupe by sorted endpoint key
          if (!exterior && !hallSide) {
            const key = wallKey(ep.x1, ep.z1, ep.x2, ep.z2);
            if (drawnShared.has(key)) continue;
            drawnShared.add(key);
          }

          const ops = openingsForRoomSide(plate, ri, side, r);
          const thickness = exterior ? WALL_THICK : WALL_THICK * 0.7;
          const mat = exterior ? wallMat : interiorMat;
          addWallWithOpenings(
            group,
            ep.x1, ep.z1, ep.x2, ep.z2,
            yBase, wallH, thickness,
            ops,
            mat, frameMat, glassMat,
          );
        }
      }

      // ------- Story trim band along exterior walls (single plate rectangle) -------
      const trimGeom = new THREE.BoxGeometry(plate.w + 0.3, 0.4, plate.h + 0.3);
      const trim = new THREE.Mesh(trimGeom, trimMat);
      trim.position.set(plate.x + plate.w / 2, yBase + wallH - 0.2, plate.y + plate.h / 2);
      trim.castShadow = true;
      group.add(trim);

      // ------- Staircase -------
      if (plate.floor < topFloor) {
        const stair = plate.rooms.find((r) => r.type === "stairs");
        if (stair) {
          const STEPS = 14;
          const runLen = Math.min(stair.h - 1, 8.5);
          const treadDepth = runLen / STEPS;
          const treadWidth = Math.min(stair.w - 1, 4.5);
          const riser = fH / STEPS;
          const hallCenterX = plate.hallway ? plate.hallway.x + plate.hallway.w / 2 : stair.x + stair.w / 2;
          const stairCenterX = Math.max(stair.x + treadWidth / 2, Math.min(stair.x + stair.w - treadWidth / 2, hallCenterX));
          for (let s = 0; s < STEPS; s++) {
            const tread = new THREE.Mesh(
              new THREE.BoxGeometry(treadWidth, riser, treadDepth),
              stairMat,
            );
            tread.position.set(
              stairCenterX,
              yBase + (s + 0.5) * riser,
              stair.y + 0.5 + (s + 0.5) * treadDepth,
            );
            tread.castShadow = true;
            tread.receiveShadow = true;
            group.add(tread);
          }
          // Landing slab at top of stairs
          const landing = new THREE.Mesh(
            new THREE.BoxGeometry(treadWidth + 0.8, 0.3, 1.2),
            stairMat,
          );
          landing.position.set(
            stairCenterX,
            yBase + fH - 0.15,
            stair.y + runLen + 0.1,
          );
          landing.castShadow = true;
          landing.receiveShadow = true;
          group.add(landing);
        }
      }

      // ------- Roof on top floor: single plate rectangle padded for overhang -------
      if (plate.floor === topFloor) {
        const roofY = yBase + fH;
        const overhang = ROOF_OVERHANG;
        const roofCenterX = plate.x + plate.w / 2;
        const roofCenterZ = plate.y + plate.h / 2;
        const roofW = plate.w + overhang * 2;
        const roofH = plate.h + overhang * 2;
        if (variation.roofType === "domed") {
          const slabG = new THREE.BoxGeometry(roofW, 0.6, roofH);
          const overSlab = new THREE.Mesh(slabG, roofMat);
          overSlab.position.set(roofCenterX, roofY + 0.3, roofCenterZ);
          overSlab.castShadow = true;
          group.add(overSlab);
          const bw = plate.w;
          const bh = plate.h;
          const r = Math.min(bw, bh) * 0.5;
          const dome = new THREE.Mesh(
            new THREE.SphereGeometry(r, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
            roofMat,
          );
          dome.scale.set(bw / (2 * r), 0.55, bh / (2 * r));
          dome.position.set(roofCenterX, roofY + 0.5, roofCenterZ);
          dome.castShadow = true;
          group.add(dome);
        } else if (variation.roofType === "sloped") {
          const slabG = new THREE.BoxGeometry(roofW, 0.5, roofH);
          const base = new THREE.Mesh(slabG, roofMat);
          base.position.set(roofCenterX, roofY + 0.25, roofCenterZ);
          base.castShadow = true;
          group.add(base);
          const bw = plate.w;
          const bh = plate.h;
          const peakH = Math.min(bw, bh) * 0.25;
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(Math.min(bw, bh) * 0.55, peakH, 4),
            roofMat,
          );
          cone.position.set(roofCenterX, roofY + peakH / 2 + 0.5, roofCenterZ);
          cone.rotation.y = Math.PI / 4;
          cone.scale.set(bw / Math.min(bw, bh), 1, bh / Math.min(bw, bh));
          cone.castShadow = true;
          group.add(cone);
        } else {
          const flatG = new THREE.BoxGeometry(roofW, 0.7, roofH);
          const flat = new THREE.Mesh(flatG, roofMat);
          flat.position.set(roofCenterX, roofY + 0.35, roofCenterZ);
          flat.castShadow = true;
          group.add(flat);
        }
      }
    }

    // ------- Front porch + columns + door + arch at the entrance -------
    const entDoor = groundPlate?.entranceDoor;
    if (entDoor && groundPlate) {
      const exMid = (entDoor.x1 + entDoor.x2) / 2;
      const ezMid = (entDoor.y1 + entDoor.y2) / 2;
      const gBounds = roomsBounds(groundPlate.rooms);
      const cxB = (gBounds.minX + gBounds.maxX) / 2;
      const czB = (gBounds.minY + gBounds.maxY) / 2;
      const outX = exMid - cxB;
      const outZ = ezMid - czB;
      const isHorizontalWall = Math.abs(entDoor.y1 - entDoor.y2) < 0.1;
      const angle = isHorizontalWall ? 0 : Math.PI / 2;
      const outNorm = isHorizontalWall ? Math.sign(outZ) : Math.sign(outX);

      const porchDepth = 6;
      const porchWidth = 10;
      const px = exMid + (isHorizontalWall ? 0 : outNorm * porchDepth / 2);
      const pz = ezMid + (isHorizontalWall ? outNorm * porchDepth / 2 : 0);

      const porch = new THREE.Mesh(
        new THREE.BoxGeometry(
          isHorizontalWall ? porchWidth : porchDepth,
          0.4,
          isHorizontalWall ? porchDepth : porchWidth,
        ),
        new THREE.MeshStandardMaterial({ color: "#b8a78a", roughness: 0.85 }),
      );
      porch.position.set(px, PLINTH_HEIGHT + 0.2, pz);
      porch.receiveShadow = true;
      porch.castShadow = true;
      group.add(porch);

      const step = new THREE.Mesh(
        new THREE.BoxGeometry(
          isHorizontalWall ? porchWidth + 2 : 2.5,
          0.35,
          isHorizontalWall ? 2.5 : porchWidth + 2,
        ),
        stoneMat,
      );
      step.position.set(
        exMid + (isHorizontalWall ? 0 : outNorm * (porchDepth + 1.1)),
        0.9,
        ezMid + (isHorizontalWall ? outNorm * (porchDepth + 1.1) : 0),
      );
      step.receiveShadow = true;
      step.castShadow = true;
      group.add(step);

      const colMat = new THREE.MeshStandardMaterial({ color: "#f1ede4", roughness: 0.8 });
      const colH = DOOR_HEIGHT + 1.5;
      for (const off of [-3.5, 3.5]) {
        const col = new THREE.Mesh(
          new THREE.CylinderGeometry(0.4, 0.4, colH, 16),
          colMat,
        );
        const cxC = isHorizontalWall ? exMid + off : px;
        const czC = isHorizontalWall ? pz + outNorm * (porchDepth / 2 - 0.4) : ezMid + off;
        const cxF = isHorizontalWall ? cxC : px + outNorm * (porchDepth / 2 - 0.4);
        col.position.set(cxF, PLINTH_HEIGHT + 0.4 + colH / 2, czC);
        col.castShadow = true;
        group.add(col);
      }

      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(
          isHorizontalWall ? porchWidth + 1.4 : porchDepth + 0.8,
          0.45,
          isHorizontalWall ? porchDepth + 0.8 : porchWidth + 1.4,
        ),
        roofMat,
      );
      canopy.position.set(px, PLINTH_HEIGHT + DOOR_HEIGHT + 1.6, pz);
      canopy.castShadow = true;
      group.add(canopy);

      // Door panel — flush in the wall plane
      const dw = Math.hypot(entDoor.x2 - entDoor.x1, entDoor.y2 - entDoor.y1);
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(dw, DOOR_HEIGHT, 0.25),
        new THREE.MeshStandardMaterial({ color: "#5a3d28", roughness: 0.6 }),
      );
      door.position.set(exMid, PLINTH_HEIGHT + DOOR_HEIGHT / 2, ezMid);
      door.rotation.y = angle;
      door.castShadow = true;
      group.add(door);

      const doorFrame = new THREE.Mesh(
        new THREE.BoxGeometry(dw + 0.9, DOOR_HEIGHT + 0.8, 0.35),
        frameMat,
      );
      doorFrame.position.set(exMid, PLINTH_HEIGHT + DOOR_HEIGHT / 2 + 0.1, ezMid);
      doorFrame.rotation.y = angle;
      doorFrame.castShadow = true;
      group.add(doorFrame);

      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(2.5, 0.4, 10, 24, Math.PI),
        new THREE.MeshStandardMaterial({ color: variation.paletteAccent, roughness: 0.5 }),
      );
      arch.position.set(exMid, PLINTH_HEIGHT + DOOR_HEIGHT + 0.4, ezMid);
      arch.rotation.y = angle;
      group.add(arch);
    }
  }, [variation, visibleFloors]);

  return <div ref={mountRef} className={className ?? "w-full h-full"} />;
}
