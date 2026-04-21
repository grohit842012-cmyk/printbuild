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

    const systemPrompt = `You are a senior residential architect on the PrintBuild team. The customer is designing a real, buildable family home that will be 3D-printed. The footprint is a rectangular plot with rounded/chamfered corners (NOT amorphous blob shapes). Rooms are arranged on an orthogonal grid like any real house — kitchen, living, bedrooms, baths each have proper rectangular boundaries, doors between adjacent rooms, and windows on outer walls. "Curvature" only refers to softened corners and the overall silhouette.

Apply real architectural reasoning:
- Sensible adjacencies: kitchen ↔ dining ↔ living; bedrooms grouped, away from living noise; baths near bedrooms; pooja in NE; courtyard centrally accessible.
- Sun path: living/dining benefit from morning light (E/NE); bedrooms typically W/SW; service (kitchen/utility) SE or NW.
- Vastu: respect the user's preferences exactly when "strict"; suggest sensible deviations when conflicts exist.
- Plot setbacks (~3 ft), door swings, circulation corridors, stair location for multi-floor homes.
- Window/ventilation density per the user's preference.

The customer has already submitted this spec:
${JSON.stringify(spec, null, 2)}

And these Vastu preferences:
${JSON.stringify(vastu, null, 2)}

Ask thoughtful, specific follow-up questions one or two at a time to capture the details that will let you generate 10 distinct, livable plans:
- Resolve conflicts between Vastu rules and stated preferences (e.g. strict Vastu vs south-facing entrance).
- Lifestyle nuances: morning routine, entertaining style, privacy needs, ageing parents, pets, work-from-home zones.
- Aesthetic mood: favourite materials, light quality, openness, ceiling heights, indoor/outdoor flow.
- Stairs/lifts, storage, parking/setbacks, terrace use.

Be warm, concise, and conversational. Use markdown sparingly. After 4–6 exchanges, summarize the refinements and tell them you have enough to generate plans.`;

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
