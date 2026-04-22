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
};

/** Build an SVG path for a rectangle with rounded corners + optional NE chamfer. */
function platePath(p: FloorPlate, scale: number, ox: number, oy: number): string {
  const x = ox + p.x * scale;
  const y = oy + p.y * scale;
  const w = p.w * scale;
  const h = p.h * scale;
  const r = Math.min(p.cornerRadius * scale, w / 2, h / 2);
  // Standard rounded-rect path
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

export function FloorPlan2D({ variation, floor, size = 360 }: Props) {
  const plate = variation.plates.find((p) => p.floor === floor);
  if (!plate) return null;

  const plotW = variation.plotWidthFt;
  const plotD = variation.plotDepthFt;
  const padding = 16;
  const scale = (size - padding * 2) / Math.max(plotW, plotD);
  const ox = padding;
  const oy = padding;

  // Entrance position on the plate perimeter
  const a = (variation.entranceAngleDeg * Math.PI) / 180;
  const cx = ox + (plate.x + plate.w / 2) * scale;
  const cy = oy + (plate.y + plate.h / 2) * scale;
  const reach = Math.min(plate.w, plate.h) * scale * 0.55;
  const entX = cx + Math.sin(a) * reach;
  const entY = cy - Math.cos(a) * reach;

  const plateD = platePath(plate, scale, ox, oy);

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

      {/* Floor plate footprint with rounded corners */}
      <path
        d={plateD}
        fill="hsl(var(--card))"
        stroke="hsl(var(--foreground))"
        strokeWidth="2.5"
      />

      {/* Rooms — clipped to the rounded plate so corner rooms follow the curve */}
      <g clipPath={`url(#plate-clip-${floor})`}>
        {plate.rooms.map((r, i) => {
          const rx = ox + r.x * scale;
          const ry = oy + r.y * scale;
          const rw = r.w * scale;
          const rh = r.h * scale;
          const cxR = rx + rw / 2;
          const cyR = ry + rh / 2;
          return (
            <g key={i}>
              <rect
                x={rx} y={ry} width={rw} height={rh}
                fill={ROOM_COLOR[r.type] ?? "#e2e8f0"}
                stroke="#1e293b" strokeWidth="0.8"
              />
              {/* Stair tread lines */}
              {r.type === "stairs" && Array.from({ length: 8 }).map((_, k) => (
                <line
                  key={k}
                  x1={rx + 2}
                  x2={rx + rw - 2}
                  y1={ry + ((k + 1) * rh) / 9}
                  y2={ry + ((k + 1) * rh) / 9}
                  stroke="#475569"
                  strokeWidth="0.6"
                />
              ))}
              <text x={cxR} y={cyR - 2} textAnchor="middle" fontSize="9"
                fill="#1e293b" fontWeight="600">{r.label}</text>
              <text x={cxR} y={cyR + 9} textAnchor="middle" fontSize="7" fill="#475569">
                {Math.round(r.w)}′ × {Math.round(r.h)}′
              </text>
            </g>
          );
        })}
      </g>

      {/* Re-stroke the plate outline above the clipped rooms for a clean curve */}
      <path
        d={plateD}
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeWidth="2.5"
      />


      {/* Doors and windows */}
      {plate.openings.map((o, i) => (
        <line key={i}
          x1={ox + o.x1 * scale} y1={oy + o.y1 * scale}
          x2={ox + o.x2 * scale} y2={oy + o.y2 * scale}
          stroke={o.kind === "door" ? "hsl(var(--primary))" : "#60a5fa"}
          strokeWidth={o.kind === "door" ? 2.5 : 2}
          strokeLinecap="round"
        />
      ))}

      {/* Entrance marker */}
      <circle cx={entX} cy={entY} r="6" fill="hsl(var(--primary))" />
      <text x={entX} y={entY - 9} textAnchor="middle" fontSize="9"
        fill="hsl(var(--primary))" fontWeight="700">Entry</text>

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
