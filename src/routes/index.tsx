import heroImg from "@/assets/hero-home.jpg";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Compass, Home, Sparkles, Box } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PrintBuild — Design & 3D-print your dream home" },
      {
        name: "description",
        content:
          "Customize a curved-wall home with Vastu guidance. See 10 AI-generated 3D models, pick your favorite, and order printable STL files.",
      },
      { property: "og:title", content: "PrintBuild — Design your dream home" },
      {
        property: "og:description",
        content: "Generate Vastu-aligned 3D home designs with curved walls.",
      },
      { property: "og:image", content: heroImg },
      { name: "twitter:image", content: heroImg },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-12 sm:pt-20 pb-16 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-accent mb-4">
              Curved walls · Vastu aligned · 3D printable
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display leading-[1.05] mb-6">
              Design the home that lives in your mind.
            </h1>
            <p className="text-lg text-muted-foreground max-w-lg mb-8">
              Tell us about your plot, your rooms, and your Vastu preferences. We&apos;ll generate ten
              architectural 3D variations with flowing curved walls — explore them, pick a favourite, and
              order it as a printable model.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/auth">Start designing</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#how">How it works</a>
              </Button>
            </div>
          </div>
          <div className="relative" style={{ perspective: "1200px" }}>
            <div className="absolute -inset-6 bg-accent/10 rounded-3xl blur-3xl" aria-hidden />
            <div
              className="relative transition-transform duration-500 ease-out hover:[transform:rotateY(-8deg)_rotateX(4deg)] [transform:rotateY(-4deg)_rotateX(2deg)]"
              style={{ transformStyle: "preserve-3d" }}
            >
              <img
                src={heroImg}
                alt="Curved-wall architectural interior with compass overlay"
                width={1536}
                height={1024}
                className="rounded-2xl shadow-[0_40px_80px_-20px_rgba(0,0,0,0.45)] border border-border w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16">
          <h2 className="text-3xl font-display mb-10 text-center">How it works</h2>
          <div className="grid md:grid-cols-4 gap-6" style={{ perspective: "1000px" }}>
            {[
              { icon: Home, title: "Tell us about your home", desc: "Plot, floors, rooms, lifestyle and Vastu preferences in a guided form." },
              { icon: Sparkles, title: "Refine with AI", desc: "Our assistant asks smart follow-ups to capture exactly what you envision." },
              { icon: Box, title: "Explore 10 designs", desc: "Walk through ten parametric variations with curved walls and 2D plans." },
              { icon: Compass, title: "Book & receive", desc: "Confirm your favourite — we fabricate the printable STL files for you." },
            ].map((step, i) => (
              <div
                key={i}
                className="bg-card border border-border rounded-xl p-6 transition-transform duration-300 hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)]"
                style={{ transformStyle: "preserve-3d" }}
              >
                <step.icon className="h-6 w-6 text-accent mb-4" />
                <h3 className="font-display text-xl mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Button asChild size="lg">
              <Link to="/auth">Create your free account</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-sm text-muted-foreground flex flex-col sm:flex-row gap-2 justify-between">
          <span>© PrintBuild</span>
          <span>Curved walls. Considered design. Printable homes.</span>
        </div>
      </footer>
    </div>
  );
}
