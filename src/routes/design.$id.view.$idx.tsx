import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ModelViewer3D } from "@/components/model-viewer-3d";
import { FloorPlan2D } from "@/components/floor-plan-2d";
import type { Variation } from "@/lib/design-types";
import { Check, X, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/design/$id/view/$idx")({
  head: () => ({ meta: [{ title: "Inspect design — PrintBuild" }] }),
  component: () => (
    <RequireAuth>
      <InspectorPage />
    </RequireAuth>
  ),
});

function InspectorPage() {
  const { id, idx } = useParams({ from: "/design/$id/view/$idx" });
  const navigate = useNavigate();
  const [variation, setVariation] = useState<Variation | null>(null);
  const [allFloors, setAllFloors] = useState<number[]>([]);
  const [visibleFloors, setVisibleFloors] = useState<Set<number>>(new Set());
  const [activeFloor, setActiveFloor] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("designs")
        .select("generated_variations")
        .eq("id", id)
        .single();
      if (error || !data) { toast.error("Not found"); return; }
      const variations = (data.generated_variations as unknown as Variation[]) ?? [];
      const v = variations[Number(idx)];
      if (!v) { toast.error("Variation not found"); return; }
      setVariation(v);
      const floors = v.plates.map((p) => p.floor);
      setAllFloors(floors);
      setVisibleFloors(new Set(floors));
      setActiveFloor(floors[0]);
    })();
  }, [id, idx]);

  async function selectAndReview() {
    setSaving(true);
    await supabase
      .from("designs")
      .update({ selected_variation_index: Number(idx), status: "selected" })
      .eq("id", id);
    setSaving(false);
    void navigate({ to: "/design/$id/review", params: { id } });
  }

  function toggleFloor(f: number) {
    setVisibleFloors((s) => {
      const n = new Set(s);
      if (n.has(f)) n.delete(f); else n.add(f);
      return n;
    });
  }

  if (!variation) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <p className="p-8 text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <Link to="/design/$id/gallery" params={{ id }} className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to gallery
          </Link>
          <Badge>{variation.vastuTier === "strict" ? "Strict Vastu" : variation.vastuTier === "mostly" ? "Mostly Vastu" : "Partial Vastu"}</Badge>
        </div>

        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="aspect-[4/3] sm:aspect-video">
              <ModelViewer3D variation={variation} visibleFloors={visibleFloors} className="w-full h-full" />
            </div>
            <div className="p-4 flex flex-wrap gap-2 items-center border-t border-border">
              <span className="text-sm text-muted-foreground mr-2">Visible floors:</span>
              {allFloors.map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={visibleFloors.has(f) ? "default" : "outline"}
                  onClick={() => toggleFloor(f)}
                >
                  Floor {f}
                </Button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">Drag to rotate · scroll to zoom</span>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-display text-xl mb-2">2D floor plan</h2>
            <div className="flex gap-2 mb-3">
              {allFloors.map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={activeFloor === f ? "default" : "outline"}
                  onClick={() => setActiveFloor(f)}
                >
                  Floor {f}
                </Button>
              ))}
            </div>
            <div className="bg-secondary/40 rounded-xl p-3">
              <FloorPlan2D variation={variation} floor={activeFloor} size={360} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="bg-secondary/40 rounded-lg p-3">
                <p className="text-muted-foreground">Vastu score</p>
                <p className="font-display text-2xl">{variation.vastuScore}/100</p>
              </div>
              <div className="bg-secondary/40 rounded-lg p-3">
                <p className="text-muted-foreground">Curvature</p>
                <p className="font-display text-2xl">{Math.round(variation.curvatureLevel * 100)}%</p>
              </div>
            </div>

            {/* Liveability check */}
            <div className="mt-4 border border-border rounded-xl p-4">
              <h3 className="font-display text-sm mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-accent" />
                Liveability check
              </h3>
              <ul className="space-y-1.5 text-xs">
                <CheckRow ok={variation.liveability.hallway} label="Hallway / corridor" />
                <CheckRow ok={variation.liveability.bedroomsHaveWindows} label="Every habitable room has a window" />
                <CheckRow ok={variation.liveability.bathroomsPrivate} label="Bathrooms not adjacent to kitchen / pooja" />
                <CheckRow ok={variation.liveability.entranceCorrect} label="Front door on requested direction" />
                <CheckRow ok={variation.liveability.stairsAligned} label="Stairs aligned across floors" />
              </ul>
              {variation.liveability.issues.length > 0 && (
                <ul className="mt-2 pt-2 border-t border-border space-y-0.5 text-[11px] text-muted-foreground">
                  {variation.liveability.issues.slice(0, 4).map((issue, i) => (
                    <li key={i}>• {issue}</li>
                  ))}
                </ul>
              )}
            </div>

            <Button className="w-full mt-5" size="lg" onClick={selectAndReview} disabled={saving}>
              {saving ? "Saving…" : "I love this — leave a review"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <Check className="h-3.5 w-3.5 text-primary shrink-0" />
      ) : (
        <X className="h-3.5 w-3.5 text-destructive shrink-0" />
      )}
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}
