import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const { type, table, record } = payload;

    if (type !== "INSERT" || !record?.content || record.embedding) {
      return new Response("Skipped", { status: 200 });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return new Response("No OPENAI_API_KEY", { status: 500 });

    const embResp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: record.content.substring(0, 8000),
      }),
    });

    if (!embResp.ok) return new Response(`OpenAI: ${await embResp.text()}`, { status: 500 });

    const { data } = await embResp.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error } = await supabase
      .from(table)
      .update({ embedding: data[0].embedding })
      .eq("id", record.id);

    if (error) return new Response(`DB: ${error.message}`, { status: 500 });
    return new Response("OK", { status: 200 });
  } catch (error) {
    return new Response(String(error), { status: 500 });
  }
});
