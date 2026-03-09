/**
 * Avengers Relay - Multi-Bot Claude Code Telegram Relay
 * Kaldr Tech | One codebase, multiple bots via BOT_ID env var
 *
 * Each Railway service sets BOT_ID (ava, tony, steve, cleah, carter)
 * and gets a different persona from config/{bot_id}-profile.md
 */

import { Bot, Context } from "grammy";
import { spawn } from "bun";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import { join, dirname } from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { transcribe } from "./transcribe.ts";
import {
  processMemoryIntents,
  getMemoryContext,
  getRelevantContext,
} from "./memory.ts";

const PROJECT_ROOT = dirname(dirname(import.meta.path));

// ============================================================
// CONFIGURATION
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const PROJECT_DIR = process.env.PROJECT_DIR || "";
const RELAY_DIR =
  process.env.RELAY_DIR || join(process.env.HOME || "~", ".claude-relay");
const USER_NAME = process.env.USER_NAME || "LaSean";
const USER_TIMEZONE = process.env.USER_TIMEZONE || "America/New_York";
const BOT_ID = process.env.BOT_ID || "ava";

let profileContext = "";

const TEMP_DIR = join(RELAY_DIR, "temp");
const UPLOADS_DIR = join(RELAY_DIR, "uploads");
const SESSION_FILE = join(RELAY_DIR, "session.json");

interface SessionState {
  sessionId: string | null;
  lastActivity: string;
}

// ============================================================
// SESSION
// ============================================================

async function loadSession(): Promise<SessionState> {
  try {
    const content = await readFile(SESSION_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return { sessionId: null, lastActivity: new Date().toISOString() };
  }
}

async function saveSession(state: SessionState): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(state, null, 2));
}

let session = await loadSession();

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

// ============================================================
// STARTUP
// ============================================================

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set!");
  process.exit(1);
}

await mkdir(TEMP_DIR, { recursive: true });
await mkdir(UPLOADS_DIR, { recursive: true });

// Load bot profile dynamically based on BOT_ID
try {
  profileContext = await readFile(
    join(PROJECT_ROOT, "config", `${BOT_ID}-profile.md`),
    "utf-8"
  );
  console.log(`Loaded profile: ${BOT_ID}`);
} catch {
  console.warn(`No profile at config/${BOT_ID}-profile.md - using defaults`);
}

// ============================================================
// SUPABASE
// ============================================================

const supabase: SupabaseClient | null =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

if (supabase) {
  console.log("Supabase connected");
} else {
  console.warn("Supabase not configured");
}

async function saveMessage(
  role: string,
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("messages").insert({
      role,
      content,
      channel: "telegram",
      bot_id: BOT_ID,
      metadata: metadata || {},
    });
  } catch (error) {
    console.error("Save error:", error);
  }
}

async function logActivity(event: string, details?: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("bot_activity_log").insert({
      bot_id: BOT_ID,
      event,
      details: details || "",
    });
  } catch (error) {
    console.error("Log error:", error);
  }
}

// ============================================================
// BOT INIT
// ============================================================

const bot = new Bot(BOT_TOKEN);

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();
  if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
    console.log(`Unauthorized: ${userId}`);
    await ctx.reply("This bot is private.");
    return;
  }
  await next();
});

// ============================================================
// CLAUDE CODE CLI
// ============================================================

async function callClaude(
  prompt: string,
  options?: { resume?: boolean; imagePath?: string }
): Promise<string> {
  const args = [CLAUDE_PATH, "-p", prompt];

  if (options?.resume && session.sessionId) {
    args.push("--resume", session.sessionId);
  }

  args.push("--output-format", "text");

  console.log(`[${BOT_ID}] Claude: ${prompt.substring(0, 80)}...`);

  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: PROJECT_DIR || undefined,
      env: { ...process.env },
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("Claude error:", stderr);
      await logActivity("claude_error", stderr.substring(0, 500));
      return `Something went wrong on my end. Give me a moment.`;
    }

    const sessionMatch = output.match(/Session ID: ([a-f0-9-]+)/i);
    if (sessionMatch) {
      session.sessionId = sessionMatch[1];
      session.lastActivity = new Date().toISOString();
      await saveSession(session);
    }

    return output.trim();
  } catch (error) {
    console.error("Spawn error:", error);
    await logActivity("spawn_error", String(error));
    return `Having trouble connecting. Try again in a sec.`;
  }
}

// ============================================================
// PROMPT BUILDER
// ============================================================

function buildPrompt(
  userMessage: string,
  relevantContext?: string,
  memoryContext?: string
): string {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: USER_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts: string[] = [];

  if (profileContext) {
    parts.push(profileContext);
  } else {
    parts.push(`You are ${BOT_ID}, an AI assistant for LaSean at Kaldr Tech.`);
  }

  parts.push(`\nCurrent time: ${timeStr}`);
  parts.push(`Speaking with ${USER_NAME} via Telegram.`);
  parts.push("Keep responses concise and conversational.");

  if (memoryContext) parts.push(`\n${memoryContext}`);
  if (relevantContext) parts.push(`\n${relevantContext}`);

  parts.push(
    "\nMEMORY MANAGEMENT:" +
      "\nWhen the user shares something worth remembering, sets goals, or completes goals, " +
      "include these tags (processed automatically, hidden from user):" +
      "\n[REMEMBER: fact to store]" +
      "\n[GOAL: goal text | DEADLINE: optional date]" +
      "\n[DONE: search text for completed goal]"
  );

  parts.push(`\nUser: ${userMessage}`);
  return parts.join("\n");
}

// ============================================================
// SEND RESPONSE
// ============================================================

async function sendResponse(ctx: Context, response: string): Promise<void> {
  const MAX_LENGTH = 4000;
  if (response.length <= MAX_LENGTH) {
    await ctx.reply(response);
    return;
  }

  const chunks: string[] = [];
  let remaining = response;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let i = remaining.lastIndexOf("\n\n", MAX_LENGTH);
    if (i === -1) i = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (i === -1) i = remaining.lastIndexOf(" ", MAX_LENGTH);
    if (i === -1) i = MAX_LENGTH;
    chunks.push(remaining.substring(0, i));
    remaining = remaining.substring(i).trim();
  }
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

// ============================================================
// HANDLERS
// ============================================================

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  console.log(`[${BOT_ID}] Msg: ${text.substring(0, 80)}...`);

  await ctx.replyWithChatAction("typing");
  await saveMessage("user", text);
  await logActivity("message_received", text.substring(0, 200));

  const [relevantContext, memoryContext] = await Promise.all([
    getRelevantContext(supabase, text),
    getMemoryContext(supabase),
  ]);

  const enrichedPrompt = buildPrompt(text, relevantContext, memoryContext);
  const rawResponse = await callClaude(enrichedPrompt, { resume: true });
  const response = await processMemoryIntents(supabase, rawResponse);

  await saveMessage("assistant", response);
  await logActivity("response_sent", response.substring(0, 200));
  await sendResponse(ctx, response);
});

bot.on("message:voice", async (ctx) => {
  const voice = ctx.message.voice;
  await ctx.replyWithChatAction("typing");

  if (!process.env.VOICE_PROVIDER) {
    await ctx.reply("Voice not configured. Set VOICE_PROVIDER in env.");
    return;
  }

  try {
    const file = await ctx.api.getFile(voice.file_id);
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const resp = await fetch(url);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const tempPath = join(TEMP_DIR, `voice_${Date.now()}.ogg`);
    await writeFile(tempPath, buffer);

    const transcription = await transcribe(tempPath);
    await unlink(tempPath).catch(() => {});

    if (!transcription) {
      await ctx.reply("Couldn't transcribe that.");
      return;
    }

    await ctx.reply(`🎤 "${transcription}"`);
    await saveMessage("user", `[Voice] ${transcription}`);

    const [relevantContext, memoryContext] = await Promise.all([
      getRelevantContext(supabase, transcription),
      getMemoryContext(supabase),
    ]);

    const enrichedPrompt = buildPrompt(transcription, relevantContext, memoryContext);
    const rawResp = await callClaude(enrichedPrompt, { resume: true });
    const cleanResp = await processMemoryIntents(supabase, rawResp);
    await saveMessage("assistant", cleanResp);
    await sendResponse(ctx, cleanResp);
  } catch (error) {
    console.error("Voice error:", error);
    await ctx.reply("Had trouble with that voice message.");
  }
});

bot.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo;
  const caption = ctx.message.caption || "What do you see in this image?";
  const largest = photo[photo.length - 1];
  await ctx.replyWithChatAction("typing");

  try {
    const file = await ctx.api.getFile(largest.file_id);
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const resp = await fetch(url);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const ext = file.file_path?.split(".").pop() || "jpg";
    const tempPath = join(UPLOADS_DIR, `photo_${Date.now()}.${ext}`);
    await writeFile(tempPath, buffer);

    await saveMessage("user", `[Photo] ${caption}`);
    const enrichedPrompt = buildPrompt(caption);
    const rawResp = await callClaude(enrichedPrompt, { imagePath: tempPath });
    const cleanResp = await processMemoryIntents(supabase, rawResp);
    await saveMessage("assistant", cleanResp);
    await sendResponse(ctx, cleanResp);
  } catch (error) {
    console.error("Photo error:", error);
    await ctx.reply("Had trouble with that image.");
  }
});

bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const caption = ctx.message.caption || `Analyze this file: ${doc.file_name}`;
  await ctx.replyWithChatAction("typing");

  try {
    const file = await ctx.api.getFile(doc.file_id);
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const resp = await fetch(url);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const tempPath = join(UPLOADS_DIR, doc.file_name || `doc_${Date.now()}`);
    await writeFile(tempPath, buffer);

    await saveMessage("user", `[Doc: ${doc.file_name}] ${caption}`);
    const enrichedPrompt = buildPrompt(`${caption}\n\nFile at: ${tempPath}`);
    const rawResp = await callClaude(enrichedPrompt);
    const cleanResp = await processMemoryIntents(supabase, rawResp);
    await saveMessage("assistant", cleanResp);
    await sendResponse(ctx, cleanResp);
  } catch (error) {
    console.error("Doc error:", error);
    await ctx.reply("Had trouble with that file.");
  }
});

// ============================================================
// START
// ============================================================

console.log(`=== ${BOT_ID.toUpperCase()} ===`);
console.log(`Bot ID: ${BOT_ID}`);
console.log(`User: ${ALLOWED_USER_ID || "ANY"}`);
console.log(`Supabase: ${supabase ? "connected" : "not configured"}`);

await logActivity("bot_started", `${BOT_ID} relay online`);

bot.start({
  onStart: () => console.log(`${BOT_ID} is online!`),
});
