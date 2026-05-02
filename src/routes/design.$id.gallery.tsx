import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FloorPlan2D } from "@/components/floor-plan-2d";
import { generateVariations } from "@/lib/model-generator";
import { Loader2, RefreshCw } from "lucide-react";
import type { DesignSpec, VastuPreferences, Variation } from "@/lib/design-types";

export const Route = createFileRoute("/design/$id/gallery")({
  head: () => ({ meta: [{ title: "Your designs — PrintBuild" }] }),
  component: () => (
    <RequireAuth>
      <GalleryPage />
    </RequireAuth>
  ),
});

function tierLabel(tier: Variation["vastuTier"]) {
  if (tier === "strict") return { text: "Strict Vastu", cls: "bg-emerald-100 text-emerald-900" };
  if (tier === "mostly") return { text: "Mostly Vastu", cls: "bg-amber-100 text-amber-900" };
  return { text: "Partial Vastu", cls: "bg-stone-200 text-stone-900" };
}

function GalleryPage() {
  const { id } = useParams({ from: "/design/$id/gallery" });
  const navigate = useNavigate();
  const [variations, setVariations] = useState<Variation[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => { void load(); }, [id]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("designs")
      .select("generated_variations, spec, vastu_preferences")
      .eq("id", id)
      .single();
    setLoading(false);
    if (error || !data) { toast.error("Could not load designs"); return; }
    setVariations((data.generated_variations as unknown as Variation[]) ?? []);
  }

  async function regenerate() {
    setRegenerating(true);
    const { data } = await supabase
      .from("designs")
      .select("spec, vastu_preferences")
      .eq("id", id)
      .single();
    if (!data) { setRegenerating(false); return; }
    const v = generateVariations(data.spec as unknown as DesignSpec, data.vastu_preferences as unknown as VastuPreferences, 10);
    await supabase.from("designs").update({ generated_variations: v as never }).eq("id", id);
    setVariations(v);
    setRegenerating(false);
    toast.success("Generated a fresh batch");
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <div className="flex flex-wrap gap-4 items-end justify-between mb-8">
          <div>
            <p className="text-sm uppercase tracking-wider text-accent">Gallery</p>
            <h1 className="text-3xl font-display">10 designs ready to explore</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sorted by Vastu compliance. Click any design for the full 3D inspector.
            </p>
          </div>
          <Button variant="outline" onClick={regenerate} disabled={regenerating}>
            {regenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Regenerate batch
          </Button>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {variations.map((v, idx) => {
              const t = tierLabel(v.vastuTier);
              return (
                <button
                  key={v.id}
                  onClick={() => navigate({ to: "/design/$id/view/$idx", params: { id, idx: String(idx) } })}
                  className="group bg-card border border-border rounded-2xl p-4 text-left hover:shadow-lg transition-shadow"
                >
                  <div className="aspect-square bg-secondary/40 rounded-xl mb-3 overflow-hidden">
                    <FloorPlan2D variation={v} floor={1} size={300} />
                  </div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-display text-lg">Design {idx + 1}</h3>
                    <Badge className={t.cls}>{t.text}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground capitalize">
                    {v.elevationStyle.replace(/-/g, " ")} ·{" "}
                    {v.parking
                      ? v.parking.covered ? "Carport" : "Open parking"
                      : "Stilt parking"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Curvature {Math.round(v.curvatureLevel * 100)}% · Vastu {v.vastuScore}/100
                  </p>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-8">
          <Link to="/designs" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to my designs
          </Link>
        </div>
      </div>
    </div>
  );
}
