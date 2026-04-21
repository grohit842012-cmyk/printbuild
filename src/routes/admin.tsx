import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { FloorPlan2D } from "@/components/floor-plan-2d";
import type { Variation } from "@/lib/design-types";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — PrintBuild" }] }),
  component: () => (
    <RequireAuth requireAdmin>
      <AdminDashboard />
    </RequireAuth>
  ),
});

interface BookingRow {
  id: string;
  design_id: string;
  status: string;
  created_at: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  shipping_address: string;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
  customer_notes: string | null;
  internal_notes: string | null;
  designs: {
    name: string;
    spec: unknown;
    vastu_preferences: unknown;
    generated_variations: unknown;
    selected_variation_index: number | null;
  } | null;
}

const STATUSES = ["new", "in_production", "shipped", "delivered"];

function AdminDashboard() {
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("bookings")
      .select(`*, designs:designs(name, spec, vastu_preferences, generated_variations, selected_variation_index)`)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data as unknown as BookingRow[]) ?? []);
  }

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Status updated"); void load(); }
  }

  async function saveNotes(id: string, internal_notes: string) {
    const { error } = await supabase.from("bookings").update({ internal_notes }).eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Notes saved");
  }

  function downloadStlBundle(row: BookingRow) {
    const variations = (row.designs?.generated_variations as unknown as Variation[]) ?? [];
    const idx = row.designs?.selected_variation_index ?? 0;
    const v = variations[idx];
    if (!v) { toast.error("No variation selected"); return; }
    // Generate per-floor wall STL data on client (ASCII STL placeholder for v1).
    // Each floor outline becomes a closed wall as triangulated strip.
    const files: { name: string; content: string }[] = [];
    for (const outline of v.floorOutlines) {
      const pts = outline.points;
      const wallH = 1.6;
      let stl = `solid floor_${outline.floor}_wall\n`;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const ax = (a.x - 0.5) * 9, az = (a.y - 0.5) * 9;
        const bx = (b.x - 0.5) * 9, bz = (b.y - 0.5) * 9;
        const yBase = (outline.floor - 1) * wallH;
        const yTop = yBase + wallH;
        // Two triangles per segment
        const tri = (p1: number[], p2: number[], p3: number[]) =>
          `facet normal 0 0 0\n  outer loop\n    vertex ${p1.join(" ")}\n    vertex ${p2.join(" ")}\n    vertex ${p3.join(" ")}\n  endloop\nendfacet\n`;
        stl += tri([ax, yBase, az], [bx, yBase, bz], [bx, yTop, bz]);
        stl += tri([ax, yBase, az], [bx, yTop, bz], [ax, yTop, az]);
      }
      stl += `endsolid floor_${outline.floor}_wall\n`;
      files.push({ name: `floor-${outline.floor}/wall-perimeter.stl`, content: stl });
    }
    // Bundle as single text manifest + concatenated STL files (simple zip alternative for v1)
    const manifest = files.map((f) => `=== ${f.name} ===\n${f.content}`).join("\n\n");
    const blob = new Blob([manifest], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `booking-${row.id.slice(0, 8)}-stl-bundle.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("STL bundle downloaded");
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <h1 className="text-3xl font-display mb-2">Admin · Bookings</h1>
        <p className="text-sm text-muted-foreground mb-8">Manage orders, update status, download STL bundles.</p>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">No bookings yet.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const variations = (row.designs?.generated_variations as unknown as Variation[]) ?? [];
              const idx = row.designs?.selected_variation_index ?? 0;
              const v = variations[idx];
              const open = openId === row.id;
              return (
                <div key={row.id} className="bg-card border border-border rounded-xl">
                  <button
                    onClick={() => setOpenId(open ? null : row.id)}
                    className="w-full p-4 flex items-center gap-4 text-left"
                  >
                    <div className="w-16 h-16 bg-secondary/40 rounded-lg overflow-hidden shrink-0">
                      {v && <FloorPlan2D variation={v} floor={1} size={120} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-base truncate">{row.designs?.name ?? "Design"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {row.contact_name} · {row.contact_email}
                      </p>
                    </div>
                    <Badge variant="outline">{row.status.replace("_", " ")}</Badge>
                    {v && (
                      <Badge>{v.vastuTier === "strict" ? "Strict Vastu" : v.vastuTier === "mostly" ? "Mostly" : "Partial"}</Badge>
                    )}
                  </button>
                  {open && (
                    <div className="border-t border-border p-5 grid lg:grid-cols-2 gap-6">
                      <div>
                        <h3 className="font-display text-lg mb-3">Order details</h3>
                        <dl className="text-sm space-y-1.5">
                          <Field label="Customer">{row.contact_name}</Field>
                          <Field label="Email">{row.contact_email}</Field>
                          <Field label="Phone">{row.contact_phone || "—"}</Field>
                          <Field label="Shipping">
                            {row.shipping_address}
                            {row.shipping_city && `, ${row.shipping_city}`}
                            {row.shipping_state && `, ${row.shipping_state}`}
                            {row.shipping_postal_code && ` ${row.shipping_postal_code}`}
                            {row.shipping_country && `, ${row.shipping_country}`}
                          </Field>
                          <Field label="Customer notes">{row.customer_notes || "—"}</Field>
                          <Field label="Booked">{new Date(row.created_at).toLocaleString()}</Field>
                        </dl>

                        <div className="mt-4 flex flex-wrap gap-2 items-center">
                          <span className="text-sm text-muted-foreground">Status:</span>
                          <Select value={row.status} onValueChange={(v) => updateStatus(row.id, v)}>
                            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="outline" onClick={() => downloadStlBundle(row)}>
                            <Download className="h-4 w-4 mr-2" />
                            Download STL bundle
                          </Button>
                        </div>

                        <div className="mt-4">
                          <p className="text-sm text-muted-foreground mb-1">Internal notes</p>
                          <Textarea
                            defaultValue={row.internal_notes ?? ""}
                            rows={3}
                            maxLength={2000}
                            onBlur={(e) => saveNotes(row.id, e.target.value)}
                          />
                        </div>
                      </div>
                      <div>
                        <h3 className="font-display text-lg mb-3">Selected design</h3>
                        {v ? (
                          <div className="bg-secondary/40 rounded-xl p-3">
                            <FloorPlan2D variation={v} floor={1} size={360} />
                            <p className="text-xs text-muted-foreground mt-2">
                              Vastu {v.vastuScore}/100 · curvature {Math.round(v.curvatureLevel * 100)}%
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No variation selected</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}
