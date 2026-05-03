import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FloorPlan2D } from "@/components/floor-plan-2d";
import type { Variation } from "@/lib/design-types";
import { Check, X, AlertTriangle, Star, Clock, Hammer, Ruler } from "lucide-react";
import { computeEstimates, formatCurrency, type Currency } from "@/lib/estimates";

export const Route = createFileRoute("/design/$id/view/$idx")({
  head: () => ({ meta: [{ title: "Inspect design — PrintBuild" }] }),
  component: () => (
    <RequireAuth>
      <InspectorPage />
    </RequireAuth>
  ),
});

interface ReviewRow {
  id: string;
  user_id: string;
  rating: number;
  title: string;
  comment: string | null;
  created_at: string;
}

function InspectorPage() {
  const { id, idx } = useParams({ from: "/design/$id/view/$idx" });
  const navigate = useNavigate();
  const [variation, setVariation] = useState<Variation | null>(null);
  const [allFloors, setAllFloors] = useState<number[]>([]);
  const [activeFloor, setActiveFloor] = useState(1);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState<Currency>("INR");
  const [reviews, setReviews] = useState<ReviewRow[]>([]);

  const [planMode, setPlanMode] = useState<"open" | "closed">("closed");
  const [kitchenOpen, setKitchenOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("designs")
        .select("generated_variations, spec")
        .eq("id", id)
        .single();
      if (error || !data) { toast.error("Not found"); return; }
      const variations = (data.generated_variations as unknown as Variation[]) ?? [];
      const v = variations[Number(idx)];
      if (!v) { toast.error("Variation not found"); return; }
      setVariation(v);
      const spec = data.spec as { planMode?: "open" | "closed"; kitchenOpen?: boolean } | null;
      setPlanMode(spec?.planMode ?? "closed");
      setKitchenOpen(!!spec?.kitchenOpen);
      const floors = v.plates.map((p) => p.floor);
      setAllFloors(floors);
      setActiveFloor(floors[0]);

      const { data: rs } = await supabase
        .from("reviews")
        .select("id,user_id,rating,title,comment,created_at")
        .eq("design_id", id)
        .order("created_at", { ascending: false });
      setReviews((rs ?? []) as ReviewRow[]);
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

  const estimates = useMemo(
    () => (variation ? computeEstimates(variation) : null),
    [variation],
  );

  const avgRating = reviews.length
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0;

  if (!variation || !estimates) {
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

        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
          {/* 2D plan + floor switcher */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-xl">2D floor plan</h2>
              <div className="flex gap-2">
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
            </div>
            <div className="bg-secondary/40 rounded-xl p-3">
              <FloorPlan2D variation={variation} floor={activeFloor} size={520} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Plot {variation.plotWidthFt}′ × {variation.plotDepthFt}′ · {variation.plates.length} floor{variation.plates.length > 1 ? "s" : ""}
              {estimates.hasLift ? " · Home lift" : ""}
            </p>
          </div>

          {/* Right column: estimates, vastu, reviews */}
          <div className="space-y-4">
            {/* Estimate card */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-xl">House summary</h2>
                <div className="flex border border-border rounded-md overflow-hidden text-xs">
                  <button
                    onClick={() => setCurrency("INR")}
                    className={`px-2 py-1 ${currency === "INR" ? "bg-primary text-primary-foreground" : ""}`}
                  >
                    ₹ INR
                  </button>
                  <button
                    onClick={() => setCurrency("USD")}
                    className={`px-2 py-1 ${currency === "USD" ? "bg-primary text-primary-foreground" : ""}`}
                  >
                    $ USD
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  icon={<Ruler className="h-4 w-4" />}
                  label="Built-up area"
                  value={`${estimates.builtUpAreaSqft.toLocaleString()} sqft`}
                  sub={`Livable ${estimates.livableAreaSqft.toLocaleString()} sqft`}
                />
                <Stat
                  icon={<Hammer className="h-4 w-4" />}
                  label="Estimated cost"
                  value={formatCurrency(
                    currency === "INR" ? estimates.cost.inr : estimates.cost.usd,
                    currency,
                  )}
                  sub={currency === "INR" ? "₹2,000 / sqft basis" : "$180 / sqft basis"}
                />
                <Stat
                  icon={<Clock className="h-4 w-4" />}
                  label="3D-print time"
                  value={`${estimates.printDays} days`}
                  sub={`≈ ${estimates.printHours.toLocaleString()} printer-hours`}
                />
                <Stat
                  icon={<Ruler className="h-4 w-4" />}
                  label="Rooms"
                  value={`${estimates.bedrooms} BR · ${estimates.bathrooms} BA`}
                  sub={`Parking ${estimates.parkingAreaSqft} sqft`}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">
                Estimates are indicative. Actual cost depends on materials, finishes, site, and labour.
              </p>
            </div>

            {/* Vastu + liveability */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-xl">Vastu & liveability</h2>
                <div className="text-right">
                  <p className="text-2xl font-display leading-none">{variation.vastuScore}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">/ 100</p>
                </div>
              </div>
              <ul className="space-y-1.5 text-xs">
                <CheckRow ok={variation.liveability.hallway} label="Hallway / corridor" />
                <CheckRow ok={variation.liveability.bedroomsHaveWindows} label="Habitable rooms have windows" />
                <CheckRow ok={variation.liveability.bathroomsPrivate} label="Baths not adjacent to kitchen / pooja" />
                <CheckRow ok={variation.liveability.entranceCorrect} label="Front door on requested direction" />
                <CheckRow ok={variation.liveability.stairsAligned} label="Stairs aligned across floors" />
              </ul>
              {variation.liveability.issues.length > 0 && (
                <details className="mt-3">
                  <summary className="text-[11px] text-muted-foreground cursor-pointer flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-accent" />
                    {variation.liveability.issues.length} note{variation.liveability.issues.length > 1 ? "s" : ""}
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                    {variation.liveability.issues.slice(0, 6).map((i, k) => (
                      <li key={k}>• {i}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {/* Reviews summary */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-display text-xl mb-2">Reviews</h2>
              {reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reviews yet for this design.</p>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={`h-4 w-4 ${
                            n <= Math.round(avgRating)
                              ? "fill-accent text-accent"
                              : "text-muted-foreground"
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-sm">
                      {avgRating.toFixed(1)} · {reviews.length} review{reviews.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {reviews.slice(0, 5).map((r) => (
                      <div key={r.id} className="border border-border rounded-lg p-2.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-display">{r.title}</p>
                          <span className="text-[10px] text-muted-foreground">{r.rating}/5</span>
                        </div>
                        {r.comment && (
                          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{r.comment}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <Button className="w-full" size="lg" onClick={selectAndReview} disabled={saving}>
              {saving ? "Saving…" : "I love this — leave a review"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-secondary/40 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground text-[11px] uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <p className="font-display text-lg leading-tight mt-1">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
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
