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
  // Find which Side, when set as East, gives the front-edge ("S" by convention) the requested facing.
  // We treat the "front" as the bottom edge (S) of the box for the user.
  for (const east of ["N", "E", "S", "W"] as Side[]) {
    if (COMPASS[east].S === facing) return east;
  }
  return "E";
}

export function PlotFacingPicker({ widthFt, depthFt, facing, onChange }: Props) {
  const eastSide: Side = useMemo(() => inferEast(facing), [facing]);
  const W = 220;
  const H = 220;
  const pad = 30;
  const aspect = widthFt / depthFt;
  const bw = aspect >= 1 ? W - pad * 2 : (H - pad * 2) * aspect;
  const bh = aspect >= 1 ? (W - pad * 2) / aspect : H - pad * 2;
  const x = (W - bw) / 2;
  const y = (H - bh) / 2;

  const edgeFor = (s: Side): Direction => COMPASS[eastSide][s];

  const click = (s: Side) => {
    // User clicks the edge they want labeled "East".
    onChange(COMPASS[s].S);
    // (We still store facing as front-edge direction for compat; eastSide derived from it.)
  };

  // Actually: the user wants to click which edge IS East. So clicking edge `s` sets eastSide = s.
  // Front-edge facing then becomes COMPASS[s].S.
  const clickEast = (s: Side) => onChange(COMPASS[s].S);

  const edgeProps = (s: Side) => {
    const isEast = s === eastSide;
    return {
      stroke: isEast ? "hsl(var(--primary))" : "hsl(var(--border))",
      strokeWidth: isEast ? 5 : 2,
      style: { cursor: "pointer" } as const,
      onClick: () => clickEast(s),
    };
  };

  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <p className="text-xs text-muted-foreground mb-2">
        Tap the edge of your plot that faces <strong>East</strong> (sunrise side). The other directions will be set automatically.
      </p>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="max-w-[260px] mx-auto block">
        {/* Plot fill */}
        <rect x={x} y={y} width={bw} height={bh} fill="hsl(var(--secondary))" stroke="none" />
        {/* Clickable edges */}
        <line x1={x} y1={y} x2={x + bw} y2={y} {...edgeProps("N")} />
        <line x1={x + bw} y1={y} x2={x + bw} y2={y + bh} {...edgeProps("E")} />
        <line x1={x} y1={y + bh} x2={x + bw} y2={y + bh} {...edgeProps("S")} />
        <line x1={x} y1={y} x2={x} y2={y + bh} {...edgeProps("W")} />
        {/* Edge labels */}
        <text x={W / 2} y={y - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">
          {edgeFor("N")}
        </text>
        <text x={x + bw + 14} y={H / 2 + 4} textAnchor="start" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">
          {edgeFor("E")}
        </text>
        <text x={W / 2} y={y + bh + 18} textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">
          {edgeFor("S")}
        </text>
        <text x={x - 14} y={H / 2 + 4} textAnchor="end" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">
          {edgeFor("W")}
        </text>
        {/* Plot label */}
        <text x={W / 2} y={H / 2 - 4} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">Your plot</text>
        <text x={W / 2} y={H / 2 + 10} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">{widthFt}′ × {depthFt}′</text>
      </svg>
      <p className="text-[11px] text-center text-muted-foreground mt-1">
        Front faces <strong>{edgeFor("S")}</strong> · East side highlighted in blue
      </p>
    </div>
  );
}
