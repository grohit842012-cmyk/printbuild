import type { Variation } from "@/lib/design-types";

interface Props {
  variation: Variation;
  floor: number;
  size?: number;
}

const ROOM_COLOR: Record<string, string> = {
  living: "#d4a373",
  kitchen: "#e0a96d",
  bedroom: "#c2c5aa",
  master_bedroom: "#a4ac86",
  bath: "#9eb7c8",
  pooja: "#dab785",
  study: "#bcb38d",
  dining: "#d8b4a0",
  courtyard: "#b8d8b6",
};

export function FloorPlan2D({ variation, floor, size = 360 }: Props) {
  const outline = variation.floorOutlines.find((o) => o.floor === floor);
  if (!outline) return null;
  const rooms = variation.rooms.filter((r) => r.floor === floor);
  const w = size;

  // Build smooth path
  const pts = outline.points;
  let d = `M ${pts[0].x * w},${pts[0].y * w}`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = pts[(i + 2) % pts.length];
    const cp1x = ((a.x + b.x) / 2) * w;
    const cp1y = ((a.y + b.y) / 2) * w;
    const cp2x = b.x * w;
    const cp2y = b.y * w;
    const endx = ((b.x + c.x) / 2) * w;
    const endy = ((b.y + c.y) / 2) * w;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${endx},${endy}`;
  }
  d += " Z";

  const entAngle = (variation.entranceAngleDeg * Math.PI) / 180;
  const entX = w / 2 + Math.sin(entAngle) * w * 0.42;
  const entY = w / 2 - Math.cos(entAngle) * w * 0.42;

  return (
    <svg viewBox={`0 0 ${w} ${w}`} className="w-full h-auto">
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e8dcc4" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width={w} height={w} fill="url(#grid)" />
      {/* Wall outline */}
      <path d={d} fill="#f5efe2" stroke="#3a2e22" strokeWidth="3" strokeLinejoin="round" />
      {/* Rooms */}
      {rooms.map((r, i) => (
        <g key={i} transform={`translate(${r.cx * w},${r.cy * w}) rotate(${r.rotationDeg})`}>
          <ellipse
            rx={r.rx * w}
            ry={r.ry * w}
            fill={ROOM_COLOR[r.type] ?? "#cccccc"}
            opacity="0.65"
            stroke="#3a2e22"
            strokeWidth="0.8"
          />
          <text textAnchor="middle" fontSize="9" fill="#3a2e22" dominantBaseline="middle">
            {r.type.replace("_", " ")}
          </text>
        </g>
      ))}
      {/* Entrance */}
      <circle cx={entX} cy={entY} r="6" fill="#b8693a" />
      <text x={entX} y={entY - 10} textAnchor="middle" fontSize="9" fill="#b8693a" fontWeight="600">
        Entry
      </text>
      {/* Compass */}
      <g transform={`translate(${w - 38}, 38)`}>
        <circle r="22" fill="white" stroke="#3a2e22" strokeWidth="1" />
        <text textAnchor="middle" y="-12" fontSize="10" fill="#3a2e22" fontWeight="700">N</text>
        <text textAnchor="middle" y="18" fontSize="9" fill="#3a2e22">S</text>
        <text textAnchor="middle" x="14" y="3" fontSize="9" fill="#3a2e22">E</text>
        <text textAnchor="middle" x="-14" y="3" fontSize="9" fill="#3a2e22">W</text>
        <line x1="0" y1="-8" x2="0" y2="8" stroke="#b8693a" strokeWidth="1" />
        <polygon points="0,-9 -3,-3 3,-3" fill="#b8693a" />
      </g>
    </svg>
  );
}
