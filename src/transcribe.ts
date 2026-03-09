/**
 * Voice Transcription - Groq (cloud) or local whisper.cpp
 * Set VOICE_PROVIDER=groq or VOICE_PROVIDER=local
 */

import Groq from "groq-sdk";
import { spawn } from "bun";
import { readFile } from "fs/promises";

const VOICE_PROVIDER = process.env.VOICE_PROVIDER || "";

export async function transcribe(audioPath: string): Promise<string | null> {
  if (VOICE_PROVIDER === "groq") return transcribeGroq(audioPath);
  if (VOICE_PROVIDER === "local") return transcribeLocal(audioPath);
  return null;
}

async function transcribeGroq(audioPath: string): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) { console.error("GROQ_API_KEY not set"); return null; }

  try {
    const groq = new Groq({ apiKey });
    const file = await readFile(audioPath);
    const blob = new Blob([file], { type: "audio/ogg" });

    const result = await groq.audio.transcriptions.create({
      file: new File([blob], "audio.ogg", { type: "audio/ogg" }),
      model: "whisper-large-v3-turbo",
      language: "en",
    });
    return result.text || null;
  } catch (error) {
    console.error("Groq error:", error);
    return null;
  }
}

async function transcribeLocal(audioPath: string): Promise<string | null> {
  const whisperBinary = process.env.WHISPER_BINARY || "whisper-cpp";
  const modelPath = process.env.WHISPER_MODEL_PATH || "";
  if (!modelPath) { console.error("WHISPER_MODEL_PATH not set"); return null; }

  try {
    const proc = spawn(
      [whisperBinary, "-m", modelPath, "-f", audioPath, "--no-timestamps"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return output.trim() || null;
  } catch (error) {
    console.error("Whisper error:", error);
    return null;
  }
}
