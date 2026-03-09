import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const { query, table = "messages", match_count = 10, match_threshold = 0.7 } = await req.json();

    if (!query) return new Response("Missing query", { status: 400 });

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return new Response("No OPENAI_API_KEY", { status: 500 });

    const embResp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
    });

    if (!embResp.ok) return new Response(`OpenAI: ${await embResp.text()}`, { status: 500 });

    const { data } = await embResp.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const rpcName = table === "memory" ? "match_memory" : "match_messages";
    const { data: results, error } = await supabase.rpc(rpcName, {
      query_embedding: data[0].embedding,
      match_threshold,
      match_count,
    });

    if (error) return new Response(`Search: ${error.message}`, { status: 500 });

    return new Response(JSON.stringify(results || []), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(String(error), { status: 500 });
  }
});
