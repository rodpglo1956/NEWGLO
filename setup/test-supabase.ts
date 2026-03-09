/**
 * Test Supabase connection
 * Usage: bun run setup/test-supabase.ts
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || "";
const KEY = process.env.SUPABASE_ANON_KEY || "";

if (!URL || !KEY) { console.error("❌ SUPABASE_URL and SUPABASE_ANON_KEY required"); process.exit(1); }

console.log("Testing Supabase...");

const supabase = createClient(URL, KEY);
const tables = ["messages", "memory", "bot_activity_log", "bot_tasks", "logs"];
let ok = true;

for (const t of tables) {
  const { error } = await supabase.from(t).select("id").limit(1);
  if (error) { console.error(`❌ ${t}: ${error.message}`); ok = false; }
  else { console.log(`✅ ${t}`); }
}

if (ok) {
  const { error } = await supabase.from("bot_activity_log").insert({
    bot_id: "ava", event: "test", details: "Connection verified",
  });
  if (error) console.error("❌ Write test:", error.message);
  else console.log("✅ Write test passed");
}

console.log(ok ? "\n✅ Supabase ready." : "\n⚠️ Run db/schema.sql in SQL Editor first.");
