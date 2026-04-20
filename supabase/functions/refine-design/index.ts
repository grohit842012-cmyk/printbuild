// Edge function: AI refinement chat for design specs.
// Uses Lovable AI Gateway to ask smart follow-up questions about the home design.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { spec, vastu, history } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an empathetic, expert architect assistant helping a customer refine the spec for a custom home with curved walls. The home will be 3D-printed, so structural and aesthetic clarity matters.

The customer has already submitted this spec:
${JSON.stringify(spec, null, 2)}

And these Vastu preferences:
${JSON.stringify(vastu, null, 2)}

Your job: ask thoughtful, specific follow-up questions one or two at a time to capture details that will help generate beautiful 10 design variations. Cover:
- Conflicts between Vastu rules and stated preferences (e.g. strict Vastu but south-facing entrance)
- Lifestyle nuances (where do they spend mornings, how do they entertain, do they need privacy zones)
- Aesthetic mood (favourite materials, light, openness)
- Special requirements (accessibility, ageing parents, pets)
- Outdoor/indoor flow

Be warm, concise, and conversational. Use markdown sparingly. After 4-6 exchanges, summarize the refinements and tell them you have enough to generate models.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...((history ?? []) as { role: string; content: string }[]),
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit reached. Please wait a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Add credits in workspace settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await response.text();
      console.error("AI gateway error", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("refine-design error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
