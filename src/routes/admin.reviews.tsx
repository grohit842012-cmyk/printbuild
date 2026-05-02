import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Star, Trash2 } from "lucide-react";

export const Route = createFileRoute("/admin/reviews")({
  head: () => ({ meta: [{ title: "Admin · Reviews — PrintBuild" }] }),
  component: () => (
    <RequireAuth requireAdmin>
      <AdminReviewsPage />
    </RequireAuth>
  ),
});

interface ReviewRow {
  id: string;
  user_id: string;
  design_id: string;
  rating: number;
  title: string;
  comment: string | null;
  created_at: string;
  designs: { name: string } | null;
  profiles: { display_name: string | null; email: string | null } | null;
}

function AdminReviewsPage() {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    // Fetch reviews
    const { data: reviews, error } = await supabase
      .from("reviews")
      .select("id,user_id,design_id,rating,title,comment,created_at")
      .order("created_at", { ascending: false });
    if (error) { toast.error(error.message); setLoading(false); return; }

    const designIds = Array.from(new Set((reviews ?? []).map((r) => r.design_id)));
    const userIds = Array.from(new Set((reviews ?? []).map((r) => r.user_id)));

    const [{ data: designs }, { data: profiles }] = await Promise.all([
      designIds.length
        ? supabase.from("designs").select("id,name").in("id", designIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      userIds.length
        ? supabase.from("profiles").select("user_id,display_name,email").in("user_id", userIds)
        : Promise.resolve({ data: [] as { user_id: string; display_name: string | null; email: string | null }[] }),
    ]);

    const dmap = new Map((designs ?? []).map((d) => [d.id, d]));
    const pmap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    setRows(
      (reviews ?? []).map((r) => ({
        ...r,
        designs: dmap.get(r.design_id) ?? null,
        profiles: pmap.get(r.user_id) ?? null,
      })) as ReviewRow[]
    );
    setLoading(false);
  }

  async function deleteReview(id: string) {
    if (!confirm("Delete this review?")) return;
    const { error } = await supabase.from("reviews").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Review deleted");
    void load();
  }

  const avg = rows.length
    ? (rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(1)
    : "—";

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-display mb-1">Admin · Reviews</h1>
            <p className="text-sm text-muted-foreground">
              {rows.length} review{rows.length === 1 ? "" : "s"} · average rating {avg}
            </p>
          </div>
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            ← Bookings
          </Link>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">No reviews yet.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={`h-4 w-4 ${
                            n <= r.rating ? "fill-accent text-accent" : "text-muted-foreground"
                          }`}
                        />
                      ))}
                      <span className="text-xs text-muted-foreground ml-2">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="font-display text-lg">{r.title}</p>
                    {r.comment && <p className="text-sm text-muted-foreground mt-1">{r.comment}</p>}
                    <p className="text-xs text-muted-foreground mt-2">
                      {r.profiles?.display_name || r.profiles?.email || "Unknown user"} ·{" "}
                      Design: {r.designs?.name ?? r.design_id.slice(0, 8)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteReview(r.id)}
                    aria-label="Delete review"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
