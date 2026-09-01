import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/** Axis-aligned wall box in world metres (XZ footprint). */
export interface Collider { x1: number; z1: number; x2: number; z2: number }

/**
 * A climbable switchback staircase, described in world metres. `t` runs 0→1
 * from the bottom step to the top landing; the two flights sit either side of
 * the short axis and run in opposite directions.
 */
export interface Ramp {
  x1: number; z1: number; x2: number; z2: number;
  alongZ: boolean;
  /** +1 or -1: direction the first flight climbs along the long axis. */
  dir: 1 | -1;
  /** Which side of the short axis the first flight sits on. */
  side1: 1 | -1;
  yBottom: number;
  yTop: number;
  /** Floor the staircase starts on. */
  floor: number;
}

/** Shared movement input, written by keyboard and the on-screen joystick. */
export interface MoveInput { x: number; y: number }

const SPEED = 1.9; // m/s — comfortable walking pace
const RADIUS = 0.3;

function blocked(colliders: Collider[], x: number, z: number) {
  for (const c of colliders) {
    if (x > c.x1 - RADIUS && x < c.x2 + RADIUS && z > c.z1 - RADIUS && z < c.z2 + RADIUS) return true;
  }
  return false;
}

/** Height on the staircase at (x,z), or null when the point is off the stair. */
function rampHeight(r: Ramp, x: number, z: number): number | null {
  if (x < r.x1 || x > r.x2 || z < r.z1 || z > r.z2) return null;
  const cx = (r.x1 + r.x2) / 2;
  const cz = (r.z1 + r.z2) / 2;
  const along = r.alongZ ? z - cz : x - cx;
  const side = r.alongZ ? x - cx : z - cz;
  const L = r.alongZ ? r.z2 - r.z1 : r.x2 - r.x1;
  const p = THREE.MathUtils.clamp((along * r.dir + L / 2) / L, 0, 1);
  const onFirst = Math.sign(side || r.side1) === r.side1;
  const t = onFirst ? p * 0.5 : 0.5 + (1 - p) * 0.5;
  return r.yBottom + THREE.MathUtils.clamp(t, 0, 1) * (r.yTop - r.yBottom);
}

/**
 * First-person walk-through rig: drag (or pointer-lock) to look, WASD/arrows or
 * the on-screen joystick to move, with wall collision so you cannot walk through
 * the house. Staircases are climbable — walk onto one and you rise to the floor
 * above, with that floor's walls taking over as collision.
 */
export function FirstPersonRig({
  colliders,
  floorColliders,
  ramps = [],
  baseYs = [0],
  start,
  eyeY,
  eyeHeight = 1.65,
  startFloor = 0,
  move,
  bounds,
  onFloorChange,
}: {
  colliders: Collider[];
  /** Per-floor wall colliders; falls back to `colliders` when absent. */
  floorColliders?: Collider[][];
  ramps?: Ramp[];
  baseYs?: number[];
  start: [number, number];
  eyeY: number;
  eyeHeight?: number;
  startFloor?: number;
  move: React.MutableRefObject<MoveInput>;
  bounds: { x1: number; z1: number; x2: number; z2: number };
  onFloorChange?: (floor: number) => void;
}) {
  const { camera, gl } = useThree();
  const yaw = useRef(0);
  const pitch = useRef(0);
  const pos = useRef(new THREE.Vector3(start[0], eyeY, start[1]));
  const floorRef = useRef(startFloor);
  const keys = useRef<Record<string, boolean>>({});
  const dragging = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const startKey = useMemo(() => `${start[0].toFixed(2)},${start[1].toFixed(2)},${eyeY.toFixed(2)}`, [start, eyeY]);

  useEffect(() => {
    pos.current.set(start[0], eyeY, start[1]);
    floorRef.current = startFloor;
    camera.position.copy(pos.current);
    camera.rotation.order = "YXZ";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey]);


  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => {
      dragging.current = true;
      last.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture?.(e.pointerId);
    };
    const up = (e: PointerEvent) => {
      dragging.current = false;
      last.current = null;
      el.releasePointerCapture?.(e.pointerId);
    };
    const mv = (e: PointerEvent) => {
      if (!dragging.current || !last.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      yaw.current -= dx * 0.0042;
      pitch.current = Math.max(-1.15, Math.min(1.0, pitch.current - dy * 0.0035));
    };
    const kd = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = true; };
    const ku = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointermove", mv);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("pointermove", mv);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, [gl]);

  useFrame((_, dt) => {
    const k = keys.current;
    let fwd = (k["w"] || k["arrowup"] ? 1 : 0) - (k["s"] || k["arrowdown"] ? 1 : 0);
    let strafe = (k["d"] || k["arrowright"] ? 1 : 0) - (k["a"] || k["arrowleft"] ? 1 : 0);
    fwd += -move.current.y;
    strafe += move.current.x;
    const len = Math.hypot(fwd, strafe);
    if (len > 1) { fwd /= len; strafe /= len; }

    const step = SPEED * Math.min(dt, 0.05) * (k["shift"] ? 1.7 : 1);
    const sin = Math.sin(yaw.current);
    const cos = Math.cos(yaw.current);
    const dx = (-sin * fwd + cos * strafe) * step;
    const dz = (-cos * fwd - sin * strafe) * step;

    const p = pos.current;
    const fi = floorRef.current;
    // Stair the walker is standing on right now (either the flight up from this
    // floor, or the one coming up from the floor below).
    const currentRamp = ramps.find(
      (r) => (r.floor === fi || r.floor === fi - 1) && rampHeight(r, p.x, p.z) !== null,
    );
    const walls = currentRamp
      ? []
      : (floorColliders?.[fi] ?? colliders);

    const nx = THREE.MathUtils.clamp(p.x + dx, bounds.x1, bounds.x2);
    if (!blocked(walls, nx, p.z)) p.x = nx;
    const nz = THREE.MathUtils.clamp(p.z + dz, bounds.z1, bounds.z2);
    if (!blocked(walls, p.x, nz)) p.z = nz;

    const onRamp = ramps
      .map((r) => ({ r, y: rampHeight(r, p.x, p.z) }))
      .filter((h) => h.y !== null && Math.abs((h.y as number) + eyeHeight - p.y) < 1.4)
      .sort((a, b) => Math.abs((a.y as number) - p.y) - Math.abs((b.y as number) - p.y))[0];

    if (onRamp) {
      const y = onRamp.y as number;
      p.y = y + eyeHeight;
      const mid = (onRamp.r.yBottom + onRamp.r.yTop) / 2;
      floorRef.current = y >= mid ? onRamp.r.floor + 1 : onRamp.r.floor;
    } else {
      // Snap to the nearest floor slab we are standing over.
      let best = 0;
      let bestD = Infinity;
      baseYs.forEach((b, i) => {
        const d = Math.abs(b + eyeHeight - p.y);
        if (d < bestD) { bestD = d; best = i; }
      });
      floorRef.current = best;
      p.y = baseYs[best] + eyeHeight;
    }
    if (onFloorChange && floorRef.current !== fi) onFloorChange(floorRef.current);

    camera.position.lerp(p, 0.45);
    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");

  });

  return null;
}

/** Thumb joystick overlay for touch devices (also works with a mouse). */
export function TouchJoystick({ move }: { move: React.MutableRefObject<MoveInput> }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef(false);

  const set = (x: number, y: number) => {
    move.current = { x, y };
    if (knob.current) knob.current.style.transform = `translate(${x * 26}px, ${y * 26}px)`;
  };

  const handle = (e: React.PointerEvent) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let x = (e.clientX - cx) / (r.width / 2);
    let y = (e.clientY - cy) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    set(x, y);
  };

  return (
    <div
      ref={base}
      className="absolute bottom-4 left-4 z-20 h-24 w-24 rounded-full border border-border bg-background/60 backdrop-blur touch-none select-none"
      onPointerDown={(e) => { active.current = true; e.currentTarget.setPointerCapture(e.pointerId); handle(e); }}
      onPointerMove={(e) => { if (active.current) handle(e); }}
      onPointerUp={(e) => { active.current = false; e.currentTarget.releasePointerCapture(e.pointerId); set(0, 0); }}
      onPointerCancel={() => { active.current = false; set(0, 0); }}
      aria-label="Movement joystick"
    >
      <div ref={knob} className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/80 shadow-lg" />
    </div>
  );
}
