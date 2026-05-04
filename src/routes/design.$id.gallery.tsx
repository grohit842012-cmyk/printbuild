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
import { Loader2, RefreshCw, Trash2, Sparkles } from "lucide-react";
import type { DesignSpec, VastuPreferences, Variation } from "@/lib/design-types";
import { recommendVariations, climateFit, climateLabel } from "@/lib/climate";

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
  const [planMode, setPlanMode] = useState<"open" | "closed">("closed");
  const [kitchenOpen, setKitchenOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    const spec = data.spec as { planMode?: "open" | "closed"; kitchenOpen?: boolean } | null;
    setPlanMode(spec?.planMode ?? "closed");
    setKitchenOpen(!!spec?.kitchenOpen);
  }

  async function deleteVariation(varId: string) {
    if (!confirm("Delete this generated design? This can't be undone.")) return;
    setDeletingId(varId);
    const next = variations.filter((v) => v.id !== varId);
    const { error } = await supabase
      .from("designs")
      .update({ generated_variations: next as never })
      .eq("id", id);
    setDeletingId(null);
    if (error) { toast.error(error.message); return; }
    setVariations(next);
    toast.success("Design deleted");
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
                <div
                  key={v.id}
                  className="group relative bg-card border border-border rounded-2xl p-4 hover:shadow-lg transition-shadow"
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void deleteVariation(v.id); }}
                    disabled={deletingId === v.id}
                    aria-label="Delete design"
                    className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-background/80 border border-border opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => navigate({ to: "/design/$id/view/$idx", params: { id, idx: String(idx) } })}
                    className="text-left w-full"
                  >
                    <div className="aspect-square bg-secondary/40 rounded-xl mb-3 overflow-hidden">
                      <FloorPlan2D variation={v} floor={1} size={300} planMode={planMode} kitchenOpen={kitchenOpen} />
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
                </div>
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
