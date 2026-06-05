import { useMemo } from "react";
import type { Direction } from "@/lib/design-types";

interface Props {
  widthFt: number;
  depthFt: number;
  facing: Direction;
  onChange: (d: Direction) => void;
}

type Side = "N" | "E" | "S" | "W";

const COMPASS: Record<Side, Record<Side, Direction>> = {
  N: { N: "E", E: "S", S: "W", W: "N" },
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

  const aspect = widthFt / depthFt;
  // Box sized within a 280x280 container, with 40px padding for labels
  const containerSize = 280;
  const pad = 44;
  const inner = containerSize - pad * 2;
  const bw = aspect >= 1 ? inner : inner * aspect;
  const bh = aspect >= 1 ? inner / aspect : inner;
  const left = (containerSize - bw) / 2;
  const top = (containerSize - bh) / 2;
  const hit = 36;

  const edgeFor = (s: Side): Direction => COMPASS[eastSide][s];
  const clickEast = (s: Side) => onChange(COMPASS[s].S);

  const edgeStyle = (s: Side): React.CSSProperties => {
    const isEast = s === eastSide;
    const color = isEast ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.4)";
    const thickness = isEast ? 6 : 3;
    const common: React.CSSProperties = {
      position: "absolute",
      background: "transparent",
      border: "none",
      padding: 0,
      cursor: "pointer",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    };
    if (s === "N") return { ...common, left: left - hit / 2, top: top - hit / 2, width: bw + hit, height: hit, borderTop: `${thickness}px solid ${color}`, boxSizing: "border-box" };
    if (s === "S") return { ...common, left: left - hit / 2, top: top + bh - hit / 2, width: bw + hit, height: hit, borderBottom: `${thickness}px solid ${color}`, boxSizing: "border-box" };
    if (s === "E") return { ...common, left: left + bw - hit / 2, top: top - hit / 2, width: hit, height: bh + hit, borderRight: `${thickness}px solid ${color}`, boxSizing: "border-box" };
    return { ...common, left: left - hit / 2, top: top - hit / 2, width: hit, height: bh + hit, borderLeft: `${thickness}px solid ${color}`, boxSizing: "border-box" };
  };

  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <p className="text-xs text-muted-foreground mb-3">
        Tap the edge of your plot that faces <strong>East</strong> (sunrise side). The other directions will be set automatically.
      </p>
      <div className="mx-auto relative" style={{ width: containerSize, height: containerSize, maxWidth: "100%" }}>
        {/* Plot fill */}
        <div
          style={{
            position: "absolute",
            left,
            top,
            width: bw,
            height: bh,
            background: "hsl(var(--secondary))",
            pointerEvents: "none",
          }}
        />
        {/* Center label */}
        <div
          style={{ position: "absolute", left, top, width: bw, height: bh, pointerEvents: "none" }}
          className="flex flex-col items-center justify-center text-muted-foreground"
        >
          <span className="text-[10px]">Your plot</span>
          <span className="text-[10px]">{widthFt}′ × {depthFt}′</span>
        </div>
        {/* Edge buttons */}
        {(["N", "E", "S", "W"] as Side[]).map((s) => (
          <button key={s} type="button" aria-label={`Set ${s} edge as East`} style={edgeStyle(s)} onClick={() => clickEast(s)} />
        ))}
        {/* Edge direction labels */}
        <div style={{ position: "absolute", left: 0, right: 0, top: top - 28, textAlign: "center", pointerEvents: "none" }} className="text-sm font-bold text-foreground">
          {edgeFor("N")}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: top + bh + 10, textAlign: "center", pointerEvents: "none" }} className="text-sm font-bold text-foreground">
          {edgeFor("S")}
        </div>
        <div style={{ position: "absolute", left: left + bw + 10, top: top + bh / 2 - 10, pointerEvents: "none" }} className="text-sm font-bold text-foreground">
          {edgeFor("E")}
        </div>
        <div style={{ position: "absolute", right: containerSize - left + 10, top: top + bh / 2 - 10, pointerEvents: "none" }} className="text-sm font-bold text-foreground">
          {edgeFor("W")}
        </div>
      </div>
      <p className="text-[11px] text-center text-muted-foreground mt-2">
        Front faces <strong>{edgeFor("S")}</strong> · East side highlighted
      </p>
    </div>
  );
}
