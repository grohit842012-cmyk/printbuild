import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/designs")({
  head: () => ({ meta: [{ title: "My designs — Vaastu Studio" }] }),
  component: () => (
    <RequireAuth>
      <DesignsPage />
    </RequireAuth>
  ),
});

interface DesignRow {
  id: string;
  name: string;
  status: string;
  created_at: string;
  selected_variation_index: number | null;
}

function DesignsPage() {
  const { user } = useAuth();
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [bookings, setBookings] = useState<{ id: string; design_id: string; status: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [d, b] = await Promise.all([
        supabase.from("designs").select("id,name,status,created_at,selected_variation_index").order("created_at", { ascending: false }),
        supabase.from("bookings").select("id,design_id,status,created_at").order("created_at", { ascending: false }),
      ]);
      setDesigns((d.data as DesignRow[]) ?? []);
      setBookings(b.data ?? []);
      setLoading(false);
    })();
  }, [user]);

  function nextRoute(d: DesignRow): { to: "/design/$id/refine" | "/design/$id/gallery" | "/design/$id/view/$idx"; params: Record<string, string> } {
    if (d.status === "draft" || d.status === "spec_complete")
      return { to: "/design/$id/refine", params: { id: d.id } };
    if (d.selected_variation_index != null)
      return { to: "/design/$id/view/$idx", params: { id: d.id, idx: String(d.selected_variation_index) } };
    return { to: "/design/$id/gallery", params: { id: d.id } };
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-sm uppercase tracking-wider text-accent">My designs</p>
            <h1 className="text-3xl font-display">Your saved homes</h1>
          </div>
          <Button asChild>
            <Link to="/design/new"><Plus className="h-4 w-4 mr-2" />New design</Link>
          </Button>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : designs.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-10 text-center">
            <p className="text-muted-foreground mb-4">You haven&apos;t designed anything yet.</p>
            <Button asChild><Link to="/design/new">Start your first design</Link></Button>
          </div>
        ) : (
          <div className="space-y-3">
            {designs.map((d) => {
              const booking = bookings.find((b) => b.design_id === d.id);
              const route = nextRoute(d);
              return (
                <Link
                  key={d.id}
                  to={route.to}
                  // @ts-expect-error dynamic params
                  params={route.params}
                  className="block bg-card border border-border rounded-xl p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-display text-lg">{d.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(d.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2 items-center">
                      <Badge variant="outline">{d.status.replace("_", " ")}</Badge>
                      {booking && <Badge>Booked: {booking.status}</Badge>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
