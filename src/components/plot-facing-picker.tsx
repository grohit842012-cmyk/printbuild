import { useMemo } from "react";
import type { Direction } from "@/lib/design-types";

interface Props {
  widthFt: number;
  depthFt: number;
  /** Which side faces East. Clicking an edge sets East to that side. */
  facing: Direction;
  onChange: (d: Direction) => void;
}

type Side = "N" | "E" | "S" | "W";

// If East is on `eastSide`, derive the "facing" of each edge.
const COMPASS: Record<Side, Record<Side, Direction>> = {
  N: { N: "E", E: "S", S: "W", W: "N" }, // East = top edge
  E: { N: "N", E: "E", S: "S", W: "W" },
  S: { N: "W", E: "N", S: "E", W: "S" },
  W: { N: "S", E: "W", S: "N", W: "E" },
};

function inferEast(facing: Direction): Side {
  for (const east of ["N", "E", "S", "W"] as Side[]) {
    if (COMPASS[east].S === facing) return east;
  }
  return "E";
}

export function PlotFacingPicker({ widthFt, depthFt, facing, onChange }: Props) {
  const eastSide: Side = useMemo(() => inferEast(facing), [facing]);
  const W = 240;
  const H = 240;
  const pad = 40;
  const aspect = widthFt / depthFt;
  const bw = aspect >= 1 ? W - pad * 2 : (H - pad * 2) * aspect;
  const bh = aspect >= 1 ? (W - pad * 2) / aspect : H - pad * 2;
  const x = (W - bw) / 2;
  const y = (H - bh) / 2;

  const edgeFor = (s: Side): Direction => COMPASS[eastSide][s];

  // Clicking edge `s` sets eastSide = s; stored facing is the front-edge (S) direction.
  const clickEast = (s: Side) => onChange(COMPASS[s].S);

  const hit = 28; // tap target thickness in svg units

  const edges: { side: Side; hit: { x: number; y: number; w: number; h: number }; line: { x1: number; y1: number; x2: number; y2: number } }[] = [
    { side: "N", hit: { x: x - hit / 2, y: y - hit / 2, w: bw + hit, h: hit }, line: { x1: x, y1: y, x2: x + bw, y2: y } },
    { side: "E", hit: { x: x + bw - hit / 2, y: y - hit / 2, w: hit, h: bh + hit }, line: { x1: x + bw, y1: y, x2: x + bw, y2: y + bh } },
    { side: "S", hit: { x: x - hit / 2, y: y + bh - hit / 2, w: bw + hit, h: hit }, line: { x1: x, y1: y + bh, x2: x + bw, y2: y + bh } },
    { side: "W", hit: { x: x - hit / 2, y: y - hit / 2, w: hit, h: bh + hit }, line: { x1: x, y1: y, x2: x, y2: y + bh } },
  ];

  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <p className="text-xs text-muted-foreground mb-2">
        Tap the edge of your plot that faces <strong>East</strong> (sunrise side). The other directions will be set automatically.
      </p>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="max-w-[280px] mx-auto block touch-manipulation select-none">
        {/* Plot fill */}
        <rect x={x} y={y} width={bw} height={bh} fill="hsl(var(--secondary))" stroke="hsl(var(--border))" strokeWidth={1} pointerEvents="none" />

        {/* Edge tap zones + visible strokes */}
        {edges.map((e) => {
          const isEast = e.side === eastSide;
          return (
            <g key={e.side} style={{ cursor: "pointer" }} onClick={() => clickEast(e.side)} onTouchStart={() => clickEast(e.side)}>
              <rect {...e.hit} fill="transparent" />
              <line
                {...e.line}
                stroke={isEast ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
                strokeWidth={isEast ? 6 : 3}
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {/* Edge labels */}
        <text x={W / 2} y={y - 14} textAnchor="middle" fontSize="12" fontWeight="700" fill="hsl(var(--foreground))" pointerEvents="none">
          {edgeFor("N")}
        </text>
        <text x={x + bw + 16} y={H / 2 + 4} textAnchor="start" fontSize="12" fontWeight="700" fill="hsl(var(--foreground))" pointerEvents="none">
          {edgeFor("E")}
        </text>
        <text x={W / 2} y={y + bh + 22} textAnchor="middle" fontSize="12" fontWeight="700" fill="hsl(var(--foreground))" pointerEvents="none">
          {edgeFor("S")}
        </text>
        <text x={x - 16} y={H / 2 + 4} textAnchor="end" fontSize="12" fontWeight="700" fill="hsl(var(--foreground))" pointerEvents="none">
          {edgeFor("W")}
        </text>
        <text x={W / 2} y={H / 2 - 4} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))" pointerEvents="none">Your plot</text>
        <text x={W / 2} y={H / 2 + 10} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))" pointerEvents="none">{widthFt}′ × {depthFt}′</text>
      </svg>
      <p className="text-[11px] text-center text-muted-foreground mt-1">
        Front faces <strong>{edgeFor("S")}</strong> · East side highlighted
      </p>
    </div>
  );
}
