import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/design/$id/book")({
  head: () => ({ meta: [{ title: "Book your design — Vaastu Studio" }] }),
  component: () => (
    <RequireAuth>
      <BookPage />
    </RequireAuth>
  ),
});

const bookingSchema = z.object({
  contact_name: z.string().trim().min(1).max(120),
  contact_email: z.string().trim().email().max(255),
  contact_phone: z.string().trim().max(40).optional().or(z.literal("")),
  shipping_address: z.string().trim().min(5).max(500),
  shipping_city: z.string().trim().max(120).optional().or(z.literal("")),
  shipping_state: z.string().trim().max(120).optional().or(z.literal("")),
  shipping_postal_code: z.string().trim().max(40).optional().or(z.literal("")),
  shipping_country: z.string().trim().max(120).optional().or(z.literal("")),
  customer_notes: z.string().max(1000).optional().or(z.literal("")),
});

function BookPage() {
  const { id } = useParams({ from: "/design/$id/book" });
  const navigate = useNavigate();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [defaultEmail, setDefaultEmail] = useState("");

  useEffect(() => {
    if (user?.email) setDefaultEmail(user.email);
  }, [user]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(fd.entries());
    const parsed = bookingSchema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("bookings").insert({
      user_id: user.id,
      design_id: id,
      contact_name: parsed.data.contact_name,
      contact_email: parsed.data.contact_email,
      contact_phone: parsed.data.contact_phone || null,
      shipping_address: parsed.data.shipping_address,
      shipping_city: parsed.data.shipping_city || null,
      shipping_state: parsed.data.shipping_state || null,
      shipping_postal_code: parsed.data.shipping_postal_code || null,
      shipping_country: parsed.data.shipping_country || null,
      customer_notes: parsed.data.customer_notes || null,
      status: "new",
    });
    await supabase.from("designs").update({ status: "booked" }).eq("id", id);
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Booking placed — we'll be in touch.");
    void navigate({ to: "/designs" });
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10">
        <Link to="/design/$id/gallery" params={{ id }} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to gallery
        </Link>
        <h1 className="text-3xl font-display mt-2 mb-2">Book your design</h1>
        <p className="text-muted-foreground text-sm mb-8">
          We&apos;ll generate the per-wall STL files and contact you to arrange payment and shipping.
        </p>
        <form onSubmit={onSubmit} className="bg-card border border-border rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contact_name">Full name</Label>
              <Input id="contact_name" name="contact_name" required maxLength={120} />
            </div>
            <div>
              <Label htmlFor="contact_email">Email</Label>
              <Input id="contact_email" name="contact_email" type="email" defaultValue={defaultEmail} required maxLength={255} />
            </div>
          </div>
          <div>
            <Label htmlFor="contact_phone">Phone (optional)</Label>
            <Input id="contact_phone" name="contact_phone" maxLength={40} />
          </div>
          <div>
            <Label htmlFor="shipping_address">Shipping address</Label>
            <Textarea id="shipping_address" name="shipping_address" required maxLength={500} rows={2} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="shipping_city">City</Label>
              <Input id="shipping_city" name="shipping_city" maxLength={120} />
            </div>
            <div>
              <Label htmlFor="shipping_state">State</Label>
              <Input id="shipping_state" name="shipping_state" maxLength={120} />
            </div>
            <div>
              <Label htmlFor="shipping_postal_code">Postal code</Label>
              <Input id="shipping_postal_code" name="shipping_postal_code" maxLength={40} />
            </div>
            <div>
              <Label htmlFor="shipping_country">Country</Label>
              <Input id="shipping_country" name="shipping_country" maxLength={120} />
            </div>
          </div>
          <div>
            <Label htmlFor="customer_notes">Notes (optional)</Label>
            <Textarea id="customer_notes" name="customer_notes" maxLength={1000} rows={3} />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Placing booking…" : "Confirm booking"}
          </Button>
        </form>
      </div>
    </div>
  );
}
