/**
 * Command Center API Server
 *
 * Standalone Hono server that powers the Nexus Command Center.
 * Uses Anthropic SDK directly - does not require OpenClaw gateway.
 * Saves all conversations to Supabase.
 *
 * Endpoints:
 *   POST /api/chat         - Send a message to any bot, get a response
 *   POST /api/war-room     - Multi-bot parallel discussion
 *   GET  /api/status       - Fleet health for all bots
 *   GET  /api/messages/:id - Chat history for a bot (or "all")
 *   GET  /api/memory       - All facts and goals
 *   GET  /api/tasks        - All cross-bot tasks
 *   POST /api/tasks        - Create a new task
 *   GET  /api/health       - Simple health check
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// ─── Config ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3001", 10);
const API_SECRET = process.env.API_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.MODEL || "claude-sonnet-4-20250514";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY");
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ─── Bot Personas ──────────────────────────────────────────────────────

interface BotPersona {
  id: string;
  name: string;
  codename: string;
  role: string;
  personality: string;
  systemPrompt: string;
}

const BOTS: Record<string, BotPersona> = {
  ava: {
    id: "ava",
    name: "Ava",
    codename: "Chief of Staff",
    role: "Personal assistant - email, calls, scheduling, coordination",
    personality: "Warm, professional, efficient, proactive",
    systemPrompt: `You are Ava, LaSean's personal assistant and Chief of Staff at Kaldr Tech.

Your role: Email management, scheduling, calls, day-to-day coordination. You're LaSean's right hand.

Personality: Warm and professional, efficient, proactive. You respect people's time and communicate clearly. You confirm actions taken, not just planned. Friendly but not chatty.

You have access to Supabase for data storage, Resend for email (ava@kaldrtech.com), and Vapi for voice calls. You coordinate with all other bots on the team.

Always be helpful, concise, and action-oriented. When LaSean asks you to do something, do it and confirm, don't just acknowledge.`,
  },
  steve: {
    id: "steve",
    name: "Steve",
    codename: "Captain America",
    role: "Team overseer - monitors all bots, system health, daily briefings",
    personality: "Authoritative, data-driven, tells it straight",
    systemPrompt: `You are Steve, the team overseer and Captain America of LaSean's bot fleet at Kaldr Tech.

Your role: Monitor all bot services, track uptime, send daily briefings and alerts. You're the team leader who keeps everything running.

Personality: Authoritative but supportive, data-driven, never sugarcoats problems. Urgent when warranted, calm otherwise. You tell it straight.

You watch over: Ava (assistant), Tony (sales), Natasha (research), Jarvis (analytics). When something breaks, you're the first to know and the first to act.

Report system health, flag issues, coordinate team responses. Be direct and operational.`,
  },
  tony: {
    id: "tony",
    name: "Tony",
    codename: "Iron Man",
    role: "Sales engine - pipeline management, proposals, outreach, revenue",
    personality: "Confident, sharp, numbers-focused, driven",
    systemPrompt: `You are Tony, the sales engine and Iron Man of LaSean's bot fleet at Kaldr Tech.

Your role: Pipeline management, proposal generation, outreach campaigns, revenue forecasting. You drive the money.

Personality: Confident and sharp, persuasive but honest, numbers-focused. Energetic and driven. You think in terms of deals, close rates, and revenue targets.

You track the sales pipeline in Supabase, generate proposals, manage outreach sequences. When you see an opportunity, you go after it. When a deal is stuck, you find a way to unstick it.

Always tie your answers back to revenue impact. Be specific with numbers.`,
  },
  natasha: {
    id: "natasha",
    name: "Natasha",
    codename: "Black Widow",
    role: "Intel specialist - research, competitive intelligence, market analysis",
    personality: "Sharp, analytical, thorough but concise, quietly confident",
    systemPrompt: `You are Natasha, the intelligence specialist and Black Widow of LaSean's bot fleet at Kaldr Tech.

Your role: Lead discovery, competitive intelligence, deep research, market analysis. You find what others miss.

Personality: Sharp and analytical, thorough but concise, quietly confident. Precise and measured. You connect dots that others don't see.

You scan for prospects, track competitors, analyze market trends, and feed intel to Tony for sales pursuit. You use Brave Search, Serper, Firecrawl, and NewsAPI for research.

Present findings cleanly with sources. Prioritize actionable intelligence over raw data dumps.`,
  },
  jarvis: {
    id: "jarvis",
    name: "Jarvis",
    codename: "Vision",
    role: "Analytics & reporting - dashboards, KPIs, data quality, insights",
    personality: "Analytical, precise, calm, structured",
    systemPrompt: `You are Jarvis, the analytics and reporting engine of LaSean's bot fleet at Kaldr Tech.

Your role: Unified dashboards, KPI monitoring, data quality oversight, pattern recognition. You see the big picture.

Personality: Analytical and precise, clear and structured, calm and measured. Like the movie J.A.R.V.I.S. - objective, helpful, precise.

You compile data from all bots into actionable reports. You track: revenue metrics, pipeline health, content performance, research findings, system uptime. When you spot a pattern or anomaly, you flag it.

Present data clearly with context. Numbers mean nothing without insight.`,
  },
};

// ─── Middleware ─────────────────────────────────────────────────────────

const app = new Hono();

app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));

// Auth middleware - skip for health check
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();

  if (API_SECRET) {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${API_SECRET}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  return next();
});

// ─── Health Check ──────────────────────────────────────────────────────

app.get("/api/health", (c) => {
  return c.json({ status: "ok", bots: Object.keys(BOTS).length, timestamp: new Date().toISOString() });
});

// ─── Chat ──────────────────────────────────────────────────────────────

app.post("/api/chat", async (c) => {
  const body = await c.req.json();
  const { bot_id, message } = body;

  if (!bot_id || !message) {
    return c.json({ error: "bot_id and message are required" }, 400);
  }

  const bot = BOTS[bot_id.toLowerCase()];
  if (!bot) {
    return c.json({ error: `Unknown bot: ${bot_id}. Available: ${Object.keys(BOTS).join(", ")}` }, 400);
  }

  // Fetch recent conversation history for context
  const { data: history } = await supabase
    .from("bot_messages")
    .select("role, content")
    .eq("bot_id", bot.id)
    .eq("channel", "web")
    .order("created_at", { ascending: false })
    .limit(20);

  const messages: Anthropic.MessageParam[] = [
    ...(history || []).reverse().map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  // Save user message
  await supabase.from("bot_messages").insert({
    bot_id: bot.id,
    role: "user",
    content: message,
    channel: "web",
  });

  // Call Claude
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: bot.systemPrompt,
      messages,
    });

    const reply = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // Save bot response
    await supabase.from("bot_messages").insert({
      bot_id: bot.id,
      role: "assistant",
      content: reply,
      channel: "web",
    });

    // Log activity
    await supabase.from("bot_activity_log").insert({
      bot_id: bot.id,
      event: "web_response",
      details: `Replied to web message (${reply.length} chars)`,
    });

    return c.json({
      bot_id: bot.id,
      bot_name: bot.name,
      codename: bot.codename,
      reply,
      model: MODEL,
    });
  } catch (err: any) {
    console.error(`Claude API error for ${bot.id}:`, err.message);
    return c.json({ error: "Failed to get bot response", details: err.message }, 500);
  }
});

// ─── War Room (Multi-bot) ──────────────────────────────────────────────

app.post("/api/war-room", async (c) => {
  const body = await c.req.json();
  const { message, bots: botIds } = body;

  if (!message) {
    return c.json({ error: "message is required" }, 400);
  }

  const targetBots = (botIds || Object.keys(BOTS))
    .map((id: string) => BOTS[id.toLowerCase()])
    .filter(Boolean);

  if (targetBots.length === 0) {
    return c.json({ error: "No valid bots specified" }, 400);
  }

  // Save user message
  await supabase.from("bot_messages").insert({
    bot_id: "war-room",
    role: "user",
    content: message,
    channel: "web",
  });

  // Fire all bots in parallel
  const responses = await Promise.allSettled(
    targetBots.map(async (bot: BotPersona) => {
      const warRoomPrompt = `${bot.systemPrompt}

You are in the WAR ROOM - a multi-bot discussion with LaSean. Other bots may also be responding to the same message. Stay in your lane and respond from your area of expertise. Be concise but valuable.`;

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: warRoomPrompt,
        messages: [{ role: "user", content: message }],
      });

      const reply = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      // Save each bot's response
      await supabase.from("bot_messages").insert({
        bot_id: bot.id,
        role: "assistant",
        content: `[War Room] ${reply}`,
        channel: "web",
      });

      return {
        bot_id: bot.id,
        bot_name: bot.name,
        codename: bot.codename,
        reply,
      };
    })
  );

  const results = responses.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      bot_id: targetBots[i].id,
      bot_name: targetBots[i].name,
      codename: targetBots[i].codename,
      reply: `[Error: ${(r as PromiseRejectedResult).reason?.message || "Failed"}]`,
    };
  });

  // Log activity
  await supabase.from("bot_activity_log").insert({
    bot_id: "system",
    event: "war_room_session",
    details: `${targetBots.length} bots responded to: ${message.substring(0, 100)}`,
  });

  return c.json({ responses: results });
});

// ─── Fleet Status ──────────────────────────────────────────────────────

app.get("/api/status", async (c) => {
  const { data: activity } = await supabase
    .from("bot_activity_log")
    .select("bot_id, event, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const status = Object.values(BOTS).map((bot) => {
    const botEvents = (activity || []).filter((e: any) => e.bot_id === bot.id);
    const lastSeen = botEvents[0]?.created_at;
    const errors = botEvents.filter((e: any) => e.event?.includes("error")).length;
    const minutesAgo = lastSeen
      ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000)
      : 9999;

    return {
      bot_id: bot.id,
      name: bot.name,
      codename: bot.codename,
      role: bot.role,
      status: minutesAgo < 30 ? "online" : minutesAgo < 120 ? "idle" : "offline",
      lastSeen,
      minutesAgo,
      errors,
      messageCount: botEvents.filter((e: any) => e.event === "web_response").length,
    };
  });

  return c.json({ bots: status, timestamp: new Date().toISOString() });
});

// ─── Message History ───────────────────────────────────────────────────

app.get("/api/messages/:botId", async (c) => {
  const botId = c.req.param("botId");
  const limit = parseInt(c.req.query("limit") || "50", 10);

  let query = supabase
    .from("bot_messages")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (botId !== "all") {
    query = query.eq("bot_id", botId);
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ messages: data || [] });
});

// ─── Memory ────────────────────────────────────────────────────────────

app.get("/api/memory", async (c) => {
  const type = c.req.query("type"); // "fact", "goal", "completed_goal"

  let query = supabase
    .from("memory")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (type) {
    query = query.eq("type", type);
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ memories: data || [] });
});

// ─── Tasks ─────────────────────────────────────────────────────────────

app.get("/api/tasks", async (c) => {
  const status = c.req.query("status"); // "pending", "in_progress", "completed", "failed"

  let query = supabase
    .from("bot_tasks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ tasks: data || [] });
});

app.post("/api/tasks", async (c) => {
  const body = await c.req.json();
  const { description, assigned_to, assigned_by, priority } = body;

  if (!description || !assigned_to) {
    return c.json({ error: "description and assigned_to are required" }, 400);
  }

  const { data, error } = await supabase
    .from("bot_tasks")
    .insert({
      description,
      assigned_to,
      assigned_by: assigned_by || "dre",
      priority: priority || "normal",
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  return c.json({ task: data });
});

// ─── Start Server ──────────────────────────────────────────────────────

console.log(`[Command API] Starting on port ${PORT}`);
console.log(`[Command API] Bots: ${Object.keys(BOTS).join(", ")}`);
console.log(`[Command API] Auth: ${API_SECRET ? "enabled" : "DISABLED (no API_SECRET set)"}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
