import type { ReactElement } from "react";
import type { FloorPlate, Variation } from "@/lib/design-types";

interface Props {
  variation: Variation;
  floor: number;
  size?: number;
}

const ROOM_COLOR: Record<string, string> = {
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

/** Build an SVG path for a rectangle with rounded corners + optional NE chamfer. */
function platePath(p: FloorPlate, scale: number, ox: number, oy: number): string {
  const x = ox + p.x * scale;
  const y = oy + p.y * scale;
  const w = p.w * scale;
  const h = p.h * scale;
  const r = Math.min(p.cornerRadius * scale, w / 2, h / 2);
  return [
    `M ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `L ${x + r} ${y + h}`,
    `Q ${x} ${y + h} ${x} ${y + h - r}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    "Z",
  ].join(" ");
}

/** Door swing arc (quarter circle) anchored at the hinge. */
function swingArcPath(
  hingeX: number,
  hingeY: number,
  radius: number,
  startAngle: number, // degrees
): string {
  const sx = hingeX + Math.cos((startAngle * Math.PI) / 180) * radius;
  const sy = hingeY + Math.sin((startAngle * Math.PI) / 180) * radius;
  const ex = hingeX + Math.cos(((startAngle + 90) * Math.PI) / 180) * radius;
  const ey = hingeY + Math.sin(((startAngle + 90) * Math.PI) / 180) * radius;
  return `M ${hingeX} ${hingeY} L ${sx} ${sy} A ${radius} ${radius} 0 0 1 ${ex} ${ey} Z`;
}

export function FloorPlan2D({ variation, floor, size = 360 }: Props) {
  const plate = variation.plates.find((p) => p.floor === floor);
  if (!plate) return null;

  const plotW = variation.plotWidthFt;
  const plotD = variation.plotDepthFt;
  const padding = 16;
  const scale = (size - padding * 2) / Math.max(plotW, plotD);
  const ox = padding;
  const oy = padding;

  const plateD = platePath(plate, scale, ox, oy);

  // Entrance marker is only shown when the floor actually has an exterior door.
  let entX: number;
  let entY: number;
  let entLabelDx = 0;
  let entLabelDy = -9;
  if (plate.entranceDoor) {
    entX = ox + ((plate.entranceDoor.x1 + plate.entranceDoor.x2) / 2) * scale;
    entY = oy + ((plate.entranceDoor.y1 + plate.entranceDoor.y2) / 2) * scale;
  } else {
    entX = 0;
    entY = 0;
  }
  void entLabelDx;
  void entLabelDy;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto">
      <defs>
        <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M 16 0 L 0 0 0 16" fill="none" stroke="hsl(var(--border) / 0.5)" strokeWidth="0.5" />
        </pattern>
        <clipPath id={`plate-clip-${floor}`}>
          <path d={plateD} />
        </clipPath>
      </defs>
      <rect width={size} height={size} fill="url(#grid)" />

      {/* Plot boundary (dashed) */}
      <rect
        x={ox} y={oy}
        width={plotW * scale} height={plotD * scale}
        fill="none" stroke="#94a3b8" strokeDasharray="4 3" strokeWidth="1"
      />

      {/* Parking — only on the ground floor */}
      {floor === 1 && variation.parking && (() => {
        const p = variation.parking;
        const px = ox + p.x * scale;
        const py = oy + p.y * scale;
        const pw = p.w * scale;
        const ph = p.h * scale;
        const stripes = [];
        for (let b = 1; b < p.bays; b++) {
          stripes.push(
            <line
              key={b}
              x1={px + (pw / p.bays) * b}
              x2={px + (pw / p.bays) * b}
              y1={py + 4}
              y2={py + ph - 4}
              stroke="#64748b"
              strokeDasharray="3 2"
              strokeWidth="0.8"
            />,
          );
        }
        return (
          <g>
            <rect
              x={px} y={py} width={pw} height={ph}
              fill={p.covered ? "#cbd5e1" : "#e2e8f0"}
              stroke="#475569" strokeWidth="1"
              strokeDasharray={p.covered ? undefined : "4 2"}
            />
            {stripes}
            <text
              x={px + pw / 2}
              y={py + ph / 2 + 3}
              textAnchor="middle"
              fontSize="9"
              fontWeight="600"
              fill="#334155"
            >
              {p.covered ? "Carport" : "Parking"}
            </text>
          </g>
        );
      })()}

      {/* Floor plate footprint */}
      <path
        d={plateD}
        fill="hsl(var(--card))"
        stroke="hsl(var(--foreground))"
        strokeWidth="2.5"
      />

      {/* Hallway corridor — drawn before rooms so room walls overlay */}
      <g clipPath={`url(#plate-clip-${floor})`}>
        {plate.hallway && (
          <rect
            x={ox + plate.hallway.x * scale}
            y={oy + plate.hallway.y * scale}
            width={plate.hallway.w * scale}
            height={plate.hallway.h * scale}
            fill="#eef2f7"
            stroke="#cbd5e1"
            strokeWidth="0.8"
            strokeDasharray="2 2"
          />
        )}

        {/* Rooms — corner rooms get rounded outer corners matching the plate */}
        {plate.rooms.map((r, i) => {
          const rx = ox + r.x * scale;
          const ry = oy + r.y * scale;
          const rw = r.w * scale;
          const rh = r.h * scale;
          const cxR = rx + rw / 2;
          const cyR = ry + rh / 2;
          // Determine which corners of this room sit on the plate's outer corners
          const tol = 0.6;
          const isW = Math.abs(r.x - plate.x) < tol;
          const isE = Math.abs(r.x + r.w - (plate.x + plate.w)) < tol;
          const isN = Math.abs(r.y - plate.y) < tol;
          const isS = Math.abs(r.y + r.h - (plate.y + plate.h)) < tol;
          const cr = Math.min(plate.cornerRadius * scale, rw / 3, rh / 3);
          const rTL = isW && isN ? cr : 0;
          const rTR = isE && isN ? cr : 0;
          const rBR = isE && isS ? cr : 0;
          const rBL = isW && isS ? cr : 0;
          const roomD =
            cr > 0 && (rTL || rTR || rBR || rBL)
              ? [
                  `M ${rx + rTL} ${ry}`,
                  `L ${rx + rw - rTR} ${ry}`,
                  rTR ? `Q ${rx + rw} ${ry} ${rx + rw} ${ry + rTR}` : `L ${rx + rw} ${ry}`,
                  `L ${rx + rw} ${ry + rh - rBR}`,
                  rBR ? `Q ${rx + rw} ${ry + rh} ${rx + rw - rBR} ${ry + rh}` : `L ${rx + rw} ${ry + rh}`,
                  `L ${rx + rBL} ${ry + rh}`,
                  rBL ? `Q ${rx} ${ry + rh} ${rx} ${ry + rh - rBL}` : `L ${rx} ${ry + rh}`,
                  `L ${rx} ${ry + rTL}`,
                  rTL ? `Q ${rx} ${ry} ${rx + rTL} ${ry}` : `L ${rx} ${ry}`,
                  "Z",
                ].join(" ")
              : null;
          return (
            <g key={i}>
              {roomD ? (
                <path d={roomD} fill={ROOM_COLOR[r.type] ?? "#e2e8f0"} stroke="#1e293b" strokeWidth="0.8" />
              ) : (
                <rect
                  x={rx} y={ry} width={rw} height={rh}
                  fill={ROOM_COLOR[r.type] ?? "#e2e8f0"}
                  stroke="#1e293b" strokeWidth="0.8"
                />
              )}
              {r.type === "stairs" && (() => {
                const treads = 8;
                const els: ReactElement[] = [];
                for (let k = 0; k < treads; k++) {
                  els.push(
                    <line
                      key={k}
                      x1={rx + 2}
                      x2={rx + rw - 2}
                      y1={ry + ((k + 1) * rh) / (treads + 1)}
                      y2={ry + ((k + 1) * rh) / (treads + 1)}
                      stroke="#475569"
                      strokeWidth="0.6"
                    />,
                  );
                }
                // Diagonal arrow indicating up direction
                els.push(
                  <line
                    key="arrow"
                    x1={rx + rw / 2}
                    x2={rx + rw / 2}
                    y1={ry + rh - 4}
                    y2={ry + 4}
                    stroke="#1e293b"
                    strokeWidth="1"
                    markerEnd="url(#stair-arrow)"
                  />,
                );
                return <g>{els}</g>;
              })()}
              {r.type === "lift" && (
                <text x={cxR} y={cyR + 16} textAnchor="middle" fontSize="7" fill="#475569">
                  LIFT
                </text>
              )}
              {r.type === "parking" && (() => {
                // Bay striping inside the parking room
                const bays = 1;
                const stripes: ReactElement[] = [];
                for (let b = 1; b < bays; b++) {
                  stripes.push(
                    <line
                      key={b}
                      x1={rx + (rw / bays) * b}
                      x2={rx + (rw / bays) * b}
                      y1={ry + 3}
                      y2={ry + rh - 3}
                      stroke="#64748b"
                      strokeDasharray="3 2"
                      strokeWidth="0.8"
                    />,
                  );
                }
                return <g>{stripes}</g>;
              })()}
              <text x={cxR} y={cyR - 2} textAnchor="middle" fontSize="9"
                fill="#1e293b" fontWeight="600">{r.label}</text>
              <text x={cxR} y={cyR + 9} textAnchor="middle" fontSize="7" fill="#475569">
                {Math.round(r.w)}′ × {Math.round(r.h)}′
              </text>
            </g>
          );
        })}

        {/* Per-room door swing arcs (skip stair openings) */}
        {plate.rooms.map((r, i) => {
          if (!r.doorWall || r.doorMid == null) return null;
          const arcR = Math.min(r.w, r.h) * 0.18 * scale;
          let hx = 0;
          let hy = 0;
          let start = 0;
          if (r.doorWall === "E") {
            hx = ox + (r.x + r.w) * scale;
            hy = oy + (r.y + r.doorMid - 1.5) * scale;
            start = 90; // sweeps from south wall into room (toward west)
          } else if (r.doorWall === "W") {
            hx = ox + r.x * scale;
            hy = oy + (r.y + r.doorMid - 1.5) * scale;
            start = -90; // toward east
          } else if (r.doorWall === "N") {
            hx = ox + (r.x + r.doorMid - 1.5) * scale;
            hy = oy + r.y * scale;
            start = 0; // toward south
          } else if (r.doorWall === "S") {
            hx = ox + (r.x + r.doorMid - 1.5) * scale;
            hy = oy + (r.y + r.h) * scale;
            start = 180; // toward north
          }
          return (
            <path
              key={`arc-${i}`}
              d={swingArcPath(hx, hy, arcR, start)}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="0.8"
              opacity="0.55"
            />
          );
        })}
      </g>

      {/* Re-stroke the plate outline above */}
      <path
        d={plateD}
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeWidth="2.5"
      />

      {/* Doors and windows (lines on walls) */}
      {plate.openings.map((o, i) => (
        <line key={i}
          x1={ox + o.x1 * scale} y1={oy + o.y1 * scale}
          x2={ox + o.x2 * scale} y2={oy + o.y2 * scale}
          stroke={o.kind === "door" ? "hsl(var(--primary))" : "#60a5fa"}
          strokeWidth={o.kind === "door" ? 2.5 : 2}
          strokeLinecap="round"
        />
      ))}

      {/* Front door swing arc */}
      {plate.entranceDoor && (() => {
        const o = plate.entranceDoor;
        const midX = ox + ((o.x1 + o.x2) / 2) * scale;
        const midY = oy + ((o.y1 + o.y2) / 2) * scale;
        const arcR = 14;
        // Determine inward direction (into hallway / into building)
        let start = 0;
        if (Math.abs(o.y1 - o.y2) < 0.1) {
          // Horizontal door (N or S wall)
          start = o.y1 < plate.y + plate.h / 2 ? 0 : 180;
        } else {
          // Vertical door (E or W wall)
          start = o.x1 < plate.x + plate.w / 2 ? -90 : 90;
        }
        return (
          <path
            d={swingArcPath(midX, midY, arcR, start)}
            fill="hsl(var(--primary) / 0.12)"
            stroke="hsl(var(--primary))"
            strokeWidth="1.2"
          />
        );
      })()}

      {/* Entrance marker */}
      {plate.entranceDoor && (
        <>
          <circle cx={entX} cy={entY} r="6" fill="hsl(var(--primary))" />
          <text x={entX} y={entY - 9} textAnchor="middle" fontSize="9"
            fill="hsl(var(--primary))" fontWeight="700">Entry</text>
        </>
      )}

      {/* Compass */}
      <g transform={`translate(${size - 36}, 36)`}>
        <circle r="20" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1" />
        <text textAnchor="middle" y="-10" fontSize="9" fontWeight="700" fill="hsl(var(--foreground))">N</text>
        <text textAnchor="middle" y="15" fontSize="8" fill="hsl(var(--foreground))">S</text>
        <text textAnchor="middle" x="12" y="3" fontSize="8" fill="hsl(var(--foreground))">E</text>
        <text textAnchor="middle" x="-12" y="3" fontSize="8" fill="hsl(var(--foreground))">W</text>
        <polygon points="0,-7 -2,-2 2,-2" fill="hsl(var(--primary))" />
      </g>
    </svg>
  );
}
