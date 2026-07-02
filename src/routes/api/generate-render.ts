import { createFileRoute } from "@tanstack/react-router";

// Photorealistic exterior render generator. Called from the client when the
// user opens a variation for the first time. Uses Lovable AI Gateway
// (openai/gpt-image-2, low quality — cheapest photoreal). Non-streaming to
// keep the pipeline simple: we buffer the final PNG, upload to Supabase
// Storage via the service role, and return the public storage URL.
//
// Path lives under /api/public/ so it's callable from the browser without
// the TanStack server-fn RPC contract. Auth check is lightweight — we
// validate the caller's Supabase session bearer token before spending
// credits.

export const Route = createFileRoute("/api/generate-render")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return Response.json(
              { error: "LOVABLE_API_KEY is not configured" },
              { status: 500 },
            );
          }

          // Validate caller with the Supabase publishable client (RLS as user).
          const authHeader = request.headers.get("authorization") ?? "";
          const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
          if (!token) {
            return Response.json({ error: "Not signed in" }, { status: 401 });
          }
          const { createClient } = await import("@supabase/supabase-js");
          const supabaseUser = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );
          const { data: userRes, error: userErr } = await supabaseUser.auth.getUser(token);
          if (userErr || !userRes.user) {
            return Response.json({ error: "Invalid session" }, { status: 401 });
          }

          const body = (await request.json().catch(() => null)) as
            | { designId?: string; idx?: number; prompt?: string; force?: boolean }
            | null;
          if (!body || typeof body.designId !== "string" || typeof body.idx !== "number" || typeof body.prompt !== "string") {
            return Response.json({ error: "Invalid request body" }, { status: 400 });
          }
          const { designId, idx, prompt, force } = body;
          if (prompt.length > 4000) {
            return Response.json({ error: "Prompt too long" }, { status: 400 });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const objectPath = `${designId}/${idx}.png`;

          // Fast path — if the render already exists, return its URL (unless force).
          if (!force) {
            const { data: existing } = await supabaseAdmin.storage
              .from("design-renders")
              .list(designId, { search: `${idx}.png` });
            if (existing?.some((o) => o.name === `${idx}.png`)) {
              const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/design-renders/${objectPath}`;
              return Response.json({ url, cached: true });
            }
          }

          // Verify the design belongs to the caller before spending credits.
          const { data: design, error: dErr } = await supabaseUser
            .from("designs")
            .select("id,user_id")
            .eq("id", designId)
            .maybeSingle();
          if (dErr || !design || design.user_id !== userRes.user.id) {
            return Response.json({ error: "Design not found" }, { status: 404 });
          }

          // --- Call Lovable AI Gateway ---
          const gwResp = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "openai/gpt-image-2",
              prompt,
              quality: "low",
              size: "1024x1024",
              n: 1,
            }),
          });

          if (!gwResp.ok) {
            const text = await gwResp.text().catch(() => "");
            if (gwResp.status === 429) {
              return Response.json(
                { error: "AI is busy right now — try again in a moment." },
                { status: 429 },
              );
            }
            if (gwResp.status === 402) {
              return Response.json(
                { error: "AI credits exhausted. Add credits in your workspace." },
                { status: 402 },
              );
            }
            return Response.json(
              { error: `Render failed: ${text.slice(0, 200)}` },
              { status: gwResp.status },
            );
          }

          const payload = (await gwResp.json()) as {
            data?: { b64_json?: string }[];
            error?: { message?: string };
          };
          const b64 = payload.data?.[0]?.b64_json;
          if (!b64) {
            return Response.json(
              { error: payload.error?.message ?? "Empty response from image model" },
              { status: 502 },
            );
          }

          // --- Upload to Supabase Storage ---
          const buffer = Buffer.from(b64, "base64");
          const { error: upErr } = await supabaseAdmin.storage
            .from("design-renders")
            .upload(objectPath, buffer, { contentType: "image/png", upsert: true });
          if (upErr) {
            return Response.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
          }

          const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/design-renders/${objectPath}`;
          return Response.json({ url, cached: false });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unexpected error";
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});
