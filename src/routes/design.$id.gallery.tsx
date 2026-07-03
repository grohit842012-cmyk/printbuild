import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ModelViewer3D } from "@/components/model-viewer-3d";
import { generateVariations } from "@/lib/model-generator";
import { fallbackDnaFromVariation } from "@/lib/design-dna";
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
  const [spec, setSpec] = useState<DesignSpec | null>(null);
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
    const s = data.spec as unknown as DesignSpec;
    setSpec(s);
    setPlanMode(s?.planMode ?? "closed");
    setKitchenOpen(!!s?.kitchenOpen);
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
          <>
          {(() => {
            const recommended = recommendVariations(variations, 3);
            return (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {variations.map((v, idx) => {
              const t = tierLabel(v.vastuTier);
              const isRec = recommended.has(v.id);
              const fit = climateFit(v.elevationStyle);
              const dna = v.dna ?? fallbackDnaFromVariation(v, idx);
              return (
                <div
                  key={v.id}
                  className={`group relative bg-card border rounded-2xl p-4 hover:shadow-lg transition-shadow ${isRec ? "border-accent ring-2 ring-accent/30" : "border-border"}`}
                >
                  {isRec && (
                    <span className="absolute -top-2 left-3 z-10 bg-accent text-accent-foreground text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded inline-flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> Recommended
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void deleteVariation(v.id); }}
                    disabled={deletingId === v.id}
                    aria-label="Delete design"
                    className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-background/80 border border-border opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <div
                    onClick={() => navigate({ to: "/design/$id/view/$idx", params: { id, idx: String(idx) } })}
                    className="text-left w-full cursor-pointer"
                  >
                    <div className="mb-3 pointer-events-none">
                      <ModelViewer3D variation={v} planMode={planMode} kitchenOpen={kitchenOpen} />
                    </div>
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <h3 className="font-display text-lg leading-tight">{dna.name}</h3>
                      <Badge className={t.cls + " shrink-0"}>{t.text}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">
                      {dna.facade} · {dna.roof}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Vastu {v.vastuScore}/100 · {v.parking ? (v.parking.covered ? "Carport" : "Open parking") : "Stilt parking"}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {fit.best.slice(0, 2).map((c) => (
                        <span key={c} className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900">
                          {climateLabel(c)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
            );
          })()}
          </>
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
