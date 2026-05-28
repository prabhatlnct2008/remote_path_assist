import { anthropic } from "@ai-sdk/anthropic";
import { env } from "@/lib/env";

// Model pin — ARCHITECTURE §8.1 / §15 (confirm latest Sonnet at build time).
export const AI_MODEL = process.env.AI_MODEL || "claude-sonnet-4-5-20250929";
export const VOYAGE_MODEL = "voyage-3-large";
export const EMBEDDING_DIMS = 1024;

export const model = anthropic(AI_MODEL);

export function hasAnthropic(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function hasVoyage(): boolean {
  return Boolean(env.VOYAGE_API_KEY);
}
