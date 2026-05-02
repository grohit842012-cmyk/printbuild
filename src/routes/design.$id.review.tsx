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
import { Star } from "lucide-react";
import { z } from "zod";

export const Route = createFileRoute("/design/$id/review")({
  head: () => ({ meta: [{ title: "Review your design — PrintBuild" }] }),
  component: () => (
    <RequireAuth>
      <ReviewPage />
    </RequireAuth>
  ),
});

const reviewSchema = z.object({
  title: z.string().trim().min(2).max(120),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
  rating: z.number().int().min(1).max(5),
});

interface ReviewRow {
  id: string;
  user_id: string;
  rating: number;
  title: string;
  comment: string | null;
  created_at: string;
}

function ReviewPage() {
  const { id } = useParams({ from: "/design/$id/review" });
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [myReview, setMyReview] = useState<ReviewRow | null>(null);

  useEffect(() => {
    if (!user) return;
    void loadReviews();
  }, [user, id]);

  async function loadReviews() {
    const { data } = await supabase
      .from("reviews")
      .select("id,user_id,rating,title,comment,created_at")
      .eq("design_id", id)
      .order("created_at", { ascending: false });
    const list = (data ?? []) as ReviewRow[];
    setReviews(list);
    setMyReview(list.find((r) => r.user_id === user?.id) ?? null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    const fd = new FormData(e.currentTarget);
    const parsed = reviewSchema.safeParse({
      title: fd.get("title"),
      comment: fd.get("comment"),
      rating,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    setSubmitting(true);
    const payload = {
      user_id: user.id,
      design_id: id,
      title: parsed.data.title,
      comment: parsed.data.comment || null,
      rating: parsed.data.rating,
    };
    const { error } = myReview
      ? await supabase.from("reviews").update(payload).eq("id", myReview.id)
      : await supabase.from("reviews").insert(payload);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(myReview ? "Review updated" : "Thanks for your review!");
    void loadReviews();
    void navigate({ to: "/designs" });
  }

  useEffect(() => {
    if (myReview) setRating(myReview.rating);
  }, [myReview]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-10">
        <Link to="/design/$id/gallery" params={{ id }} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to gallery
        </Link>
        <h1 className="text-3xl font-display mt-2 mb-2">
          {myReview ? "Edit your review" : "Share your review"}
        </h1>
        <p className="text-muted-foreground text-sm mb-8">
          Tell us what you think about this design. Your feedback helps improve future generations.
        </p>

        <form onSubmit={onSubmit} className="bg-card border border-border rounded-2xl p-6 sm:p-8 space-y-5">
          <div>
            <Label>Rating</Label>
            <div className="flex gap-1 mt-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  className="p-1"
                  aria-label={`Rate ${n} stars`}
                >
                  <Star
                    className={`h-7 w-7 transition-colors ${
                      n <= (hover || rating)
                        ? "fill-accent text-accent"
                        : "text-muted-foreground"
                    }`}
                  />
                </button>
              ))}
              <span className="ml-2 self-center text-sm text-muted-foreground">{rating}/5</span>
            </div>
          </div>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              required
              maxLength={120}
              defaultValue={myReview?.title ?? ""}
              placeholder="A short headline"
            />
          </div>
          <div>
            <Label htmlFor="comment">Comment (optional)</Label>
            <Textarea
              id="comment"
              name="comment"
              rows={5}
              maxLength={2000}
              defaultValue={myReview?.comment ?? ""}
              placeholder="What did you like or dislike?"
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Saving…" : myReview ? "Update review" : "Submit review"}
          </Button>
        </form>

        {reviews.length > 0 && (
          <div className="mt-10">
            <h2 className="font-display text-xl mb-4">All reviews ({reviews.length})</h2>
            <div className="space-y-3">
              {reviews.map((r) => (
                <div key={r.id} className="bg-card border border-border rounded-xl p-4">
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
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="font-display">{r.title}</p>
                  {r.comment && <p className="text-sm text-muted-foreground mt-1">{r.comment}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
