import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Variation } from "@/lib/design-types";
import { dnaToRenderPrompt, fallbackDnaFromVariation } from "@/lib/design-dna";
import { Loader2, Sparkles, RefreshCw, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  designId: string;
  index: number;
  variation: Variation;
  spec: {
    plot: { widthFt: number; depthFt: number; facing: string; shape: string };
    floors: number;
    rooms: { type: string; count: number; sizePref: string }[];
    lifestyle: { familySize: number; workFromHome: boolean; entertaining: boolean; notes: string };
  };
  // If true, render is generated on mount when missing. If false, user must
  // click a button to generate (used on gallery cards to save credits).
  autoGenerate?: boolean;
  className?: string;
  // Optional list of other variations' DNAs to include in the exclusion clause.
  siblings?: Variation[];
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

function storageUrl(designId: string, index: number) {
  return `${SUPABASE_URL}/storage/v1/object/public/design-renders/${designId}/${index}.png`;
}

export function DesignRender({ designId, index, variation, spec, autoGenerate = true, className = "", siblings = [] }: Props) {
  const initialUrl = storageUrl(designId, index);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [status, setStatus] = useState<"idle" | "checking" | "generating" | "ready" | "missing" | "error">("checking");
  const [error, setError] = useState<string | null>(null);
  const generatedRef = useRef(false);

  const dna = variation.dna ?? fallbackDnaFromVariation(variation, index);

  useEffect(() => {
    // Reset on variation change
    setUrl(initialUrl);
    setStatus("checking");
    setError(null);
    generatedRef.current = false;
    // No HEAD request — cheap trick: <img onError> triggers generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId, index]);

  async function generate(force = false) {
    if (generatedRef.current && !force) return;
    generatedRef.current = true;
    setStatus("generating");
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setStatus("error");
        setError("Please sign in to generate renders.");
        return;
      }
      const avoidTuples = siblings
        .filter((_, i) => i !== index)
        .map((s) => s.dna)
        .filter((d): d is NonNullable<Variation["dna"]> => !!d)
        .slice(0, 5)
        .map((d) => `${d.massing}, ${d.facade}, ${d.roof}, ${d.signature}`);
      const prompt = dnaToRenderPrompt(dna, spec, avoidTuples);
      const resp = await fetch("/api/public/generate-render", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ designId, idx: index, prompt, force }),
      });
      const j = (await resp.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!resp.ok || !j.url) {
        setStatus("error");
        setError(j.error ?? `Render failed (${resp.status})`);
        return;
      }
      // Cache-bust in case of upsert
      setUrl(`${j.url}?t=${Date.now()}`);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Network error");
    }
  }

  return (
    <div className={`relative w-full aspect-[4/3] bg-secondary/40 rounded-xl overflow-hidden ${className}`}>
      {url && status !== "missing" && (
        <img
          src={url}
          alt={`${dna.name} — photorealistic exterior render`}
          className="w-full h-full object-cover"
          onLoad={() => setStatus((s) => (s === "generating" ? "ready" : s === "checking" ? "ready" : s))}
          onError={() => {
            if (status === "checking") {
              if (autoGenerate) void generate();
              else setStatus("missing");
            }
          }}
        />
      )}

      {status === "generating" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm">
          <Loader2 className="h-6 w-6 animate-spin text-accent mb-2" />
          <p className="text-xs text-muted-foreground">Rendering {dna.name}…</p>
          <p className="text-[10px] text-muted-foreground mt-1">This takes ~15–25s</p>
        </div>
      )}

      {status === "missing" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground text-center">No render yet</p>
          <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); void generate(); }}>
            <Sparkles className="h-3 w-3 mr-1" /> Generate
          </Button>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 bg-background/85">
          <p className="text-[11px] text-destructive text-center">{error}</p>
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void generate(true); }}>
            <RefreshCw className="h-3 w-3 mr-1" /> Retry
          </Button>
        </div>
      )}

      {status === "ready" && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void generate(true); }}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-background/70 border border-border opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity"
          title="Regenerate render"
          aria-label="Regenerate render"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
