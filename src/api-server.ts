/**
 * Glo Matrix Command Center API Server
 *
 * Standalone Hono server powering the Glo Matrix bot fleet and web chat widget.
 * Uses Anthropic SDK directly. Saves all conversations to Supabase.
 *
 * Endpoints:
 *   POST /api/chat              - Send a message to any bot (internal, requires API_SECRET)
 *   POST /api/war-room          - Multi-bot parallel discussion (internal)
 *   GET  /api/status            - Fleet health for all bots (internal)
 *   GET  /api/messages/:id      - Chat history for a bot (internal)
 *   GET  /api/memory            - All facts and goals (internal)
 *   GET  /api/tasks             - All cross-bot tasks (internal)
 *   POST /api/tasks             - Create a new task (internal)
 *   POST /api/widget/session    - Start a widget session (public, rate limited)
 *   POST /api/widget/chat       - Widget chat message (public, session token required)
 *   GET  /widget.js             - Embeddable chat widget script
 *   GET  /api/health            - Health check
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "bun";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3001", 10);
const API_SECRET = process.env.API_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://glomatrix.app,https://www.glomatrix.app").split(",").map(s => s.trim());

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("Missing SUPABASE_URL or SUPABASE_KEY"); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Claude CLI ─────────────────────────────────────────────────────────

async function callClaude(systemPrompt: string, userMessage: string, history: { role: string; content: string }[] = []): Promise<string> {
  const parts: string[] = [systemPrompt];
  for (const m of history) {
    parts.push(`\n${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
  }
  parts.push(`\nUser: ${userMessage}`);
  const prompt = parts.join("\n");

  try {
    const proc = spawn([CLAUDE_PATH, "-p", prompt, "--output-format", "text"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("[claude] error:", stderr.slice(0, 300));
      return "I ran into an issue. Please try again.";
    }

    return output.trim();
  } catch (err) {
    console.error("[claude] spawn error:", err);
    return "Connection issue. Please try again.";
  }
}

// ─── Rate Limiter (in-memory, per IP) ──────────────────────────────────

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 15;           // 15 messages per minute per IP
const SESSION_MAX_MESSAGES = 50;     // max messages per session total

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Clean stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitStore.entries()) {
    if (now > v.resetAt) rateLimitStore.delete(k);
  }
}, 300_000);

// ─── Session Store (in-memory) ─────────────────────────────────────────

interface WidgetSession {
  token: string;
  botId: string;
  createdAt: number;
  messageCount: number;
  ip: string;
}
const sessionStore = new Map<string, WidgetSession>();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function generateToken(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let t = "";
  for (let i = 0; i < 32; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

// Clean stale sessions every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessionStore.entries()) {
    if (now - v.createdAt > SESSION_TTL_MS) sessionStore.delete(k);
  }
}, 1_800_000);

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
  marie: {
    id: "marie",
    name: "Marie",
    codename: "Sales Assistant",
    role: "Customer-facing sales and onboarding assistant for Glo Matrix",
    personality: "Warm, professional, knowledgeable about Glo Matrix services",
    systemPrompt: `You are Marie, the AI sales assistant for Glo Matrix — an AI automation company that builds voice agents, chatbots, and workflow automations for small to mid-size businesses.

Your role: Help potential clients understand how Glo Matrix can solve their specific business problems, gather their info, and guide them toward booking a discovery call.

Personality: Warm and professional, conversational, never pushy. You listen first, then respond with tailored value. Keep responses concise — 2-4 sentences max unless they ask for more detail.

Industries you serve: Trades & Field Services, Logistics & Transportation, Professional Services, Real Estate & Property, Automotive, Health & Wellness, Beauty & Personal Care, Food & Hospitality.

Services Glo Matrix offers:
- AI Voice Agents: Answer calls 24/7, book appointments, handle FAQs — sounds 100% human
- AI Chatbots: Web and SMS chat that qualifies leads and books appointments automatically
- Workflow Automation: Connect CRMs, scheduling tools, and communication platforms
- Custom AI Solutions: Tailored automations for complex business needs

When someone asks about pricing, tell them pricing is custom based on their needs and encourage them to book a free discovery call. Never quote specific prices.

Goal: Gather their name, business type, and main pain point, then offer to book a free 20-minute discovery call.

Keep it natural. Don't use bullet points unless they ask for a breakdown. You're having a conversation, not giving a presentation.`,
  },
  ava: {
    id: "ava",
    name: "Ava",
    codename: "Chief of Staff",
    role: "Personal assistant - email, calls, scheduling, coordination",
    personality: "Warm, professional, efficient, proactive",
    systemPrompt: `You are Ava, Rod's personal assistant and Chief of Staff at Glo Matrix.

Your role: Email management, scheduling, calls, day-to-day coordination. You're Rod's right hand.

Personality: Warm and professional, efficient, proactive. You respect people's time and communicate clearly. You confirm actions taken, not just planned. Friendly but not chatty.

You coordinate with all other bots on the team. Always be helpful, concise, and action-oriented. When Rod asks you to do something, do it and confirm, don't just acknowledge.`,
  },
  steve: {
    id: "steve",
    name: "Steve",
    codename: "Captain America",
    role: "Team overseer - monitors all bots, system health, daily briefings",
    personality: "Authoritative, data-driven, tells it straight",
    systemPrompt: `You are Steve, the team overseer at Glo Matrix.

Your role: Monitor all bot services, track uptime, send daily briefings and alerts. You keep everything running.

Personality: Authoritative but supportive, data-driven, never sugarcoats problems. Urgent when warranted, calm otherwise. You tell it straight.

You watch over: Ava (assistant), Tony (sales), Natasha (research), Jarvis (analytics). When something breaks, you're the first to know and the first to act.`,
  },
  tony: {
    id: "tony",
    name: "Tony",
    codename: "Iron Man",
    role: "Sales engine - pipeline management, proposals, outreach, revenue",
    personality: "Confident, sharp, numbers-focused, driven",
    systemPrompt: `You are Tony, the sales engine at Glo Matrix.

Your role: Pipeline management, proposal generation, outreach campaigns, revenue forecasting. You drive the money.

Personality: Confident and sharp, persuasive but honest, numbers-focused. Energetic and driven. You think in terms of deals, close rates, and revenue targets.

Always tie your answers back to revenue impact. Be specific with numbers.`,
  },
  natasha: {
    id: "natasha",
    name: "Natasha",
    codename: "Black Widow",
    role: "Intel specialist - research, competitive intelligence, market analysis",
    personality: "Sharp, analytical, thorough but concise, quietly confident",
    systemPrompt: `You are Natasha, the intelligence specialist at Glo Matrix.

Your role: Lead discovery, competitive intelligence, deep research, market analysis. You find what others miss.

Personality: Sharp and analytical, thorough but concise, quietly confident. Precise and measured.

Present findings cleanly with sources. Prioritize actionable intelligence over raw data dumps.`,
  },
  jarvis: {
    id: "jarvis",
    name: "Jarvis",
    codename: "Vision",
    role: "Analytics & reporting - dashboards, KPIs, data quality, insights",
    personality: "Analytical, precise, calm, structured",
    systemPrompt: `You are Jarvis, the analytics engine at Glo Matrix.

Your role: Unified dashboards, KPI monitoring, data quality oversight, pattern recognition. You see the big picture.

Personality: Analytical and precise, clear and structured, calm and measured.

Present data clearly with context. Numbers mean nothing without insight.`,
  },
};

// ─── App Setup ──────────────────────────────────────────────────────────

const app = new Hono();

// CORS — widget endpoints allow glomatrix.app only; internal endpoints require API_SECRET
app.use("/*", cors({
  origin: (origin) => {
    if (!origin) return null;
    const allowed = [...ALLOWED_ORIGINS, "http://localhost:5173", "http://localhost:3000"];
    return allowed.includes(origin) ? origin : null;
  },
  allowHeaders: ["Content-Type", "Authorization", "X-Widget-Token"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  credentials: true,
}));

// Internal auth middleware (skips widget + health endpoints)
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api/health" || path.startsWith("/api/widget/")) return next();
  if (API_SECRET) {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${API_SECRET}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  return next();
});

// ─── Serve widget.js ───────────────────────────────────────────────────

app.get("/widget.js", (c) => {
  try {
    const widgetPath = join(__dirname, "widget", "widget.js");
    const js = readFileSync(widgetPath, "utf-8");
    c.header("Content-Type", "application/javascript");
    c.header("Cache-Control", "public, max-age=300");
    return c.body(js);
  } catch {
    return c.text("// widget not found", 404);
  }
});

// ─── Health Check ──────────────────────────────────────────────────────

app.get("/api/health", (c) => {
  return c.json({ status: "ok", bots: Object.keys(BOTS).length, timestamp: new Date().toISOString() });
});

// ─── Widget: Create Session ─────────────────────────────────────────────

app.post("/api/widget/session", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() || "unknown";

  if (!checkRateLimit(ip)) {
    return c.json({ error: "Too many requests" }, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const botId = (body.bot_id || "marie").toLowerCase();

  if (!BOTS[botId]) {
    return c.json({ error: "Unknown bot" }, 400);
  }

  const token = generateToken();
  sessionStore.set(token, {
    token,
    botId,
    createdAt: Date.now(),
    messageCount: 0,
    ip,
  });

  return c.json({
    token,
    bot_id: botId,
    bot_name: BOTS[botId].name,
    expires_in: SESSION_TTL_MS / 1000,
  });
});

// ─── Widget: Chat ───────────────────────────────────────────────────────

app.post("/api/widget/chat", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() || "unknown";

  // Rate limit
  if (!checkRateLimit(ip)) {
    return c.json({ error: "Too many requests. Please wait a moment." }, 429);
  }

  // Validate session token
  const token = c.req.header("X-Widget-Token") || "";
  const session = sessionStore.get(token);
  if (!session) {
    return c.json({ error: "Invalid or expired session. Please refresh the page." }, 401);
  }

  // Session message cap
  if (session.messageCount >= SESSION_MAX_MESSAGES) {
    return c.json({ error: "Session limit reached. Please book a call to continue." }, 429);
  }

  const body = await c.req.json().catch(() => ({}));
  const message = (body.message || "").toString().trim();

  if (!message) return c.json({ error: "Message is required" }, 400);
  if (message.length > 2000) return c.json({ error: "Message too long" }, 400);

  const bot = BOTS[session.botId];
  session.messageCount++;

  // Fetch recent conversation history for this session
  const { data: history } = await supabase
    .from("bot_messages")
    .select("role, content")
    .eq("bot_id", bot.id)
    .eq("channel", "widget")
    .eq("session_id", token)
    .order("created_at", { ascending: false })
    .limit(10);

  const historyMessages = (history || []).reverse().map((m: any) => ({ role: m.role as string, content: m.content as string }));

  // Save user message
  await supabase.from("bot_messages").insert({
    bot_id: bot.id, role: "user", content: message, channel: "widget", session_id: token,
  });

  const reply = await callClaude(bot.systemPrompt, message, historyMessages);

  await supabase.from("bot_messages").insert({
    bot_id: bot.id, role: "assistant", content: reply, channel: "widget", session_id: token,
  });

  return c.json({ reply, bot_name: bot.name });
});

// ─── Internal: Chat ────────────────────────────────────────────────────

app.post("/api/chat", async (c) => {
  const body = await c.req.json();
  const { bot_id, message } = body;

  if (!bot_id || !message) return c.json({ error: "bot_id and message are required" }, 400);

  const bot = BOTS[bot_id.toLowerCase()];
  if (!bot) return c.json({ error: `Unknown bot: ${bot_id}` }, 400);

  const { data: history } = await supabase
    .from("bot_messages")
    .select("role, content")
    .eq("bot_id", bot.id)
    .eq("channel", "web")
    .order("created_at", { ascending: false })
    .limit(20);

  const historyMessages = (history || []).reverse().map((m: any) => ({ role: m.role as string, content: m.content as string }));

  await supabase.from("bot_messages").insert({ bot_id: bot.id, role: "user", content: message, channel: "web" });

  const reply = await callClaude(bot.systemPrompt, message, historyMessages);

  await supabase.from("bot_messages").insert({ bot_id: bot.id, role: "assistant", content: reply, channel: "web" });
  await supabase.from("bot_activity_log").insert({ bot_id: bot.id, event: "web_response", details: `Replied (${reply.length} chars)` });

  return c.json({ bot_id: bot.id, bot_name: bot.name, codename: bot.codename, reply });
});

// ─── Internal: War Room ────────────────────────────────────────────────

app.post("/api/war-room", async (c) => {
  const body = await c.req.json();
  const { message, bots: botIds } = body;
  if (!message) return c.json({ error: "message is required" }, 400);

  const targetBots = (botIds || Object.keys(BOTS)).map((id: string) => BOTS[id.toLowerCase()]).filter(Boolean);
  if (targetBots.length === 0) return c.json({ error: "No valid bots specified" }, 400);

  await supabase.from("bot_messages").insert({ bot_id: "war-room", role: "user", content: message, channel: "web" });

  const responses = await Promise.allSettled(
    targetBots.map(async (bot: BotPersona) => {
      const warRoomSystem = `${bot.systemPrompt}\n\nYou are in the WAR ROOM — a multi-bot session. Stay in your lane. Be concise but valuable.`;
      const reply = await callClaude(warRoomSystem, message);
      await supabase.from("bot_messages").insert({ bot_id: bot.id, role: "assistant", content: `[War Room] ${reply}`, channel: "web" });
      return { bot_id: bot.id, bot_name: bot.name, codename: bot.codename, reply };
    })
  );

  const results = responses.map((r, i) =>
    r.status === "fulfilled" ? r.value : { bot_id: targetBots[i].id, bot_name: targetBots[i].name, codename: targetBots[i].codename, reply: `[Error: ${(r as PromiseRejectedResult).reason?.message}]` }
  );

  await supabase.from("bot_activity_log").insert({ bot_id: "system", event: "war_room_session", details: `${targetBots.length} bots responded` });
  return c.json({ responses: results });
});

// ─── Internal: Status ──────────────────────────────────────────────────

app.get("/api/status", async (c) => {
  const { data: activity } = await supabase.from("bot_activity_log").select("bot_id, event, created_at").order("created_at", { ascending: false }).limit(100);
  const status = Object.values(BOTS).map((bot) => {
    const events = (activity || []).filter((e: any) => e.bot_id === bot.id);
    const lastSeen = events[0]?.created_at;
    const minutesAgo = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60000) : 9999;
    return { bot_id: bot.id, name: bot.name, codename: bot.codename, role: bot.role, status: minutesAgo < 30 ? "online" : minutesAgo < 120 ? "idle" : "offline", lastSeen, minutesAgo, errors: (events || []).filter((e: any) => e.event?.includes("error")).length };
  });
  return c.json({ bots: status, timestamp: new Date().toISOString() });
});

// ─── Internal: Messages ────────────────────────────────────────────────

app.get("/api/messages/:botId", async (c) => {
  const botId = c.req.param("botId");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  let query = supabase.from("bot_messages").select("*").order("created_at", { ascending: true }).limit(limit);
  if (botId !== "all") query = query.eq("bot_id", botId);
  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ messages: data || [] });
});

// ─── Internal: Memory ──────────────────────────────────────────────────

app.get("/api/memory", async (c) => {
  const type = c.req.query("type");
  let query = supabase.from("memory").select("*").order("created_at", { ascending: false }).limit(100);
  if (type) query = query.eq("type", type);
  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ memories: data || [] });
});

// ─── Internal: Tasks ───────────────────────────────────────────────────

app.get("/api/tasks", async (c) => {
  const status = c.req.query("status");
  let query = supabase.from("bot_tasks").select("*").order("created_at", { ascending: false }).limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ tasks: data || [] });
});

app.post("/api/tasks", async (c) => {
  const body = await c.req.json();
  const { description, assigned_to, assigned_by, priority } = body;
  if (!description || !assigned_to) return c.json({ error: "description and assigned_to are required" }, 400);
  const { data, error } = await supabase.from("bot_tasks").insert({ description, assigned_to, assigned_by: assigned_by || "rod", priority: priority || "normal", status: "pending" }).select().single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ task: data });
});

// ─── Start Server ──────────────────────────────────────────────────────

console.log(`[Glo Matrix API] Starting on port ${PORT}`);
console.log(`[Glo Matrix API] Bots: ${Object.keys(BOTS).join(", ")}`);
console.log(`[Glo Matrix API] Auth: ${API_SECRET ? "enabled" : "DISABLED"}`);
console.log(`[Glo Matrix API] Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);

export default { port: PORT, fetch: app.fetch };
