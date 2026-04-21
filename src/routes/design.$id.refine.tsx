import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Loader2, Sparkles, ArrowRight } from "lucide-react";
import type { DesignSpec, VastuPreferences } from "@/lib/design-types";
import { generateVariations } from "@/lib/model-generator";

export const Route = createFileRoute("/design/$id/refine")({
  head: () => ({ meta: [{ title: "Refine your design — PrintBuild" }] }),
  component: () => (
    <RequireAuth>
      <RefinePage />
    </RequireAuth>
  ),
});

interface ChatMsg { role: "user" | "assistant"; content: string }

function RefinePage() {
  const { id } = useParams({ from: "/design/$id/refine" });
  const navigate = useNavigate();
  const { session } = useAuth();
  const [spec, setSpec] = useState<DesignSpec | null>(null);
  const [vastu, setVastu] = useState<VastuPreferences | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const initRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("designs")
        .select("spec, vastu_preferences, ai_refinements")
        .eq("id", id)
        .single();
      if (error || !data) {
        toast.error("Design not found");
        void navigate({ to: "/designs" });
        return;
      }
      setSpec(data.spec as unknown as DesignSpec);
      setVastu(data.vastu_preferences as unknown as VastuPreferences);
      const prev = (data.ai_refinements as unknown as ChatMsg[]) ?? [];
      setMessages(prev);
    })();
  }, [id, navigate]);

  useEffect(() => {
    if (spec && vastu && messages.length === 0 && !initRef.current) {
      initRef.current = true;
      void sendInitial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, vastu]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function streamReply(history: ChatMsg[]) {
    if (!session || !spec || !vastu) return;
    setIsStreaming(true);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-design`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ spec, vastu, history }),
      });
      if (!resp.ok || !resp.body) {
        const errBody = await resp.json().catch(() => ({ error: "Stream failed" }));
        if (resp.status === 429) toast.error("AI is busy — try again in a moment.");
        else if (resp.status === 402) toast.error("AI credits exhausted. Add credits in workspace.");
        else toast.error(errBody.error ?? "Failed to get response");
        setMessages((m) => m.slice(0, -1));
        setIsStreaming(false);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantSoFar = "";
      let done = false;
      while (!done) {
        const { value, done: rDone } = await reader.read();
        if (rDone) break;
        buffer += decoder.decode(value, { stream: true });
        let nlIdx;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantSoFar += delta;
              setMessages((m) => {
                const copy = m.slice();
                copy[copy.length - 1] = { role: "assistant", content: assistantSoFar };
                return copy;
              });
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
      // Persist
      const newHistory = [...history, { role: "assistant" as const, content: assistantSoFar }];
      await supabase.from("designs").update({ ai_refinements: newHistory as never }).eq("id", id);
    } catch (e) {
      console.error(e);
      toast.error("Connection error");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setIsStreaming(false);
    }
  }

  async function sendInitial() {
    await streamReply([
      { role: "user", content: "Please review my spec and ask me a few key follow-up questions to refine it." },
    ]);
  }

  async function send() {
    if (!input.trim() || isStreaming) return;
    const userMsg: ChatMsg = { role: "user", content: input.trim() };
    setInput("");
    const next = [...messages, userMsg];
    setMessages(next);
    await streamReply(next);
  }

  async function generateAndContinue() {
    if (!spec || !vastu) return;
    setGenerating(true);
    try {
      const variations = generateVariations(spec, vastu, 10);
      const { error } = await supabase
        .from("designs")
        .update({
          generated_variations: variations as never,
          status: "generated",
        })
        .eq("id", id);
      if (error) throw error;
      void navigate({ to: "/design/$id/gallery", params: { id } });
    } catch (e) {
      console.error(e);
      toast.error("Could not generate variations");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-sm uppercase tracking-wider text-accent">Refinement</p>
            <h1 className="text-2xl font-display">Let&apos;s sharpen your vision</h1>
          </div>
          <Button onClick={generateAndContinue} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate 10 models
          </Button>
        </div>

        <div className="bg-card border border-border rounded-2xl flex flex-col h-[60vh]">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">Starting conversation…</p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                {m.content || "…"}
              </div>
            ))}
          </div>
          <div className="border-t border-border p-3 flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Type your reply…"
              rows={2}
              maxLength={1000}
              className="resize-none"
            />
            <Button onClick={send} disabled={isStreaming || !input.trim()}>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-6 flex justify-between text-sm text-muted-foreground">
          <Link to="/designs" className="hover:text-foreground">← Save & exit</Link>
          <span>You can always regenerate after seeing the gallery.</span>
        </div>
      </div>
    </div>
  );
}
