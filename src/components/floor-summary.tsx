import type { Variation, RoomType } from "@/lib/design-types";
import { Car, ArrowUpDown, Boxes, Wrench, Bed, Utensils } from "lucide-react";

interface Props {
  variation: Variation;
}

const ICON: Partial<Record<RoomType, React.ReactNode>> = {
  parking: <Car className="h-3 w-3" />,
  stairs: <ArrowUpDown className="h-3 w-3" />,
  lift: <Boxes className="h-3 w-3" />,
  utility: <Wrench className="h-3 w-3" />,
};

const COLOR: Partial<Record<RoomType, string>> = {
  parking: "bg-slate-200 text-slate-800",
  stairs: "bg-blue-100 text-blue-900",
  lift: "bg-violet-100 text-violet-900",
  utility: "bg-amber-100 text-amber-900",
};

const TRACKED: RoomType[] = ["parking", "stairs", "lift", "utility"];
const LABEL: Record<string, string> = {
  parking: "Parking",
  stairs: "Stairs",
  lift: "Lift",
  utility: "Utility",
};

export function FloorSummary({ variation }: Props) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <h2 className="font-display text-xl mb-3">Per-floor breakdown</h2>
      <div className="space-y-2">
        {variation.plates.map((plate) => {
          const present = new Set(plate.rooms.map((r) => r.type));
          const beds = plate.rooms.filter((r) => r.type === "bedroom" || r.type === "master_bedroom").length;
          const baths = plate.rooms.filter((r) => r.type === "bath").length;
          const hasKitchen = present.has("kitchen");
          return (
            <div
              key={plate.floor}
              className="flex items-center justify-between gap-3 p-2.5 bg-secondary/40 rounded-lg"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="font-display text-sm bg-primary text-primary-foreground rounded-md w-7 h-7 grid place-items-center shrink-0">
                  {plate.floor}
                </div>
                <div className="text-xs text-muted-foreground">
                  {beds > 0 && (
                    <span className="inline-flex items-center gap-1 mr-2">
                      <Bed className="h-3 w-3" /> {beds}
                    </span>
                  )}
                  {baths > 0 && <span className="mr-2">{baths} BA</span>}
                  {hasKitchen && (
                    <span className="inline-flex items-center gap-1">
                      <Utensils className="h-3 w-3" /> Kitchen
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1 justify-end">
                {TRACKED.filter((t) => present.has(t)).map((t) => (
                  <span
                    key={t}
                    className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${COLOR[t]}`}
                  >
                    {ICON[t]}
                    {LABEL[t]}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
