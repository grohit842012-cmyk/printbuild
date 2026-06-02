// Edge function: AI refinement chat for design specs.
// Uses Lovable AI Gateway to ask smart follow-up questions about the home design.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_HISTORY = 30;
const MAX_MSG_LEN = 2000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SPEC_BYTES = 16 * 1024;

function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // --- Auth check ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonErr(401, "Unauthorized");
    const token = authHeader.slice(7);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) return jsonErr(500, "Server misconfigured");
    const sb = createClient(supabaseUrl, supabaseAnonKey);
    const { data: userData, error: authError } = await sb.auth.getUser(token);
    if (authError || !userData?.user) return jsonErr(401, "Unauthorized");

    // --- Read & size-limit body ---
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return jsonErr(413, "Payload too large");
    let parsed: { spec?: unknown; vastu?: unknown; history?: unknown };
    try { parsed = JSON.parse(raw); } catch { return jsonErr(400, "Invalid JSON"); }
    const { spec, vastu, history } = parsed;

    // --- Validate spec / vastu shape and size ---
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return jsonErr(400, "Invalid spec");
    if (!vastu || typeof vastu !== "object" || Array.isArray(vastu)) return jsonErr(400, "Invalid vastu");
    const specJson = JSON.stringify(spec);
    const vastuJson = JSON.stringify(vastu);
    if (specJson.length + vastuJson.length > MAX_SPEC_BYTES) return jsonErr(413, "Spec too large");

    // --- Validate history ---
    const histInput = Array.isArray(history) ? history : [];
    if (histInput.length > MAX_HISTORY) return jsonErr(400, `History exceeds ${MAX_HISTORY} messages`);
    const cleanHistory: { role: "user" | "assistant"; content: string }[] = [];
    for (const m of histInput) {
      if (!m || typeof m !== "object") return jsonErr(400, "Invalid history entry");
      const mm = m as { role?: unknown; content?: unknown };
      if (mm.role !== "user" && mm.role !== "assistant") return jsonErr(400, "Invalid history role");
      if (typeof mm.content !== "string") return jsonErr(400, "Invalid history content");
      if (mm.content.length > MAX_MSG_LEN) return jsonErr(400, `Message exceeds ${MAX_MSG_LEN} chars`);
      // Strip common prompt-injection delimiters
      const safe = mm.content.replace(/<\|[^>]*\|>/g, "").replace(/\u0000/g, "");
      cleanHistory.push({ role: mm.role, content: safe });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return jsonErr(500, "LOVABLE_API_KEY missing");

    const systemPrompt = `You are a senior residential architect on the PrintBuild team. The customer is designing a real, buildable family home that will be 3D-printed. The footprint is a rectangular plot with rounded/chamfered corners (NOT amorphous blob shapes). Rooms are arranged on an orthogonal grid like any real house — kitchen, living, bedrooms, baths each have proper rectangular boundaries, doors between adjacent rooms, and windows on outer walls. "Curvature" only refers to softened corners and the overall silhouette.

Apply real architectural reasoning:
- Sensible adjacencies: kitchen ↔ dining ↔ living; bedrooms grouped, away from living noise; baths near bedrooms; pooja in NE; courtyard centrally accessible.
- Sun path: living/dining benefit from morning light (E/NE); bedrooms typically W/SW; service (kitchen/utility) SE or NW.
- Vastu: respect the user's preferences exactly when "strict"; suggest sensible deviations when conflicts exist.
- Plot setbacks (~3 ft), door swings, circulation corridors, stair location for multi-floor homes.
- Window/ventilation density per the user's preference.

The customer has already submitted this spec:
${specJson}

And these Vastu preferences:
${vastuJson}

Ask thoughtful, specific follow-up questions one or two at a time to capture the details that will let you generate 10 distinct, livable plans:
- Resolve conflicts between Vastu rules and stated preferences (e.g. strict Vastu vs south-facing entrance).
- Lifestyle nuances: morning routine, entertaining style, privacy needs, ageing parents, pets, work-from-home zones.
- Aesthetic mood: favourite materials, light quality, openness, ceiling heights, indoor/outdoor flow.
- Stairs/lifts, storage, parking/setbacks, terrace use.

Be warm, concise, and conversational. Use markdown sparingly. After 4–6 exchanges, summarize the refinements and tell them you have enough to generate plans.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...cleanHistory,
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
      if (response.status === 429) return jsonErr(429, "Rate limit reached. Please wait a moment.");
      if (response.status === 402) return jsonErr(402, "AI credits exhausted. Add credits in workspace settings.");
      const t = await response.text();
      console.error("AI gateway error", response.status, t);
      return jsonErr(500, "AI gateway error");
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("refine-design error", e);
    return jsonErr(500, "Internal error");
  }
});
