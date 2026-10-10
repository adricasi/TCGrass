import { z } from "zod";

import type { Config } from "../config.js";
import type { Expansion } from "../../shared/expansion.js";
import { modelAnswerSchema, NO_MATCH } from "./answer.js";
import { buildSystemPrompt } from "./prompt.js";

export const IDENTIFY_TIMEOUT_MS = 30_000;
export const FLAVOR_LINE_MAX_CHARS = 140;
/** A valid answer is a few hundred characters; anything far larger is not one. */
const MAX_RESPONSE_CHARS = 64 * 1024;

export type PhotoMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface Photo {
  bytes: Uint8Array;
  mimeType: PhotoMimeType;
}

/** Token counts the endpoint reported for one call (OpenAI `usage`), for cost tracking. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Outcome of one identification. `reason` is safe to log: it never contains photo bytes,
 * model text or secrets.
 */
export type Identification = (
  | { outcome: "card"; cardId: string; confidence: number; flavorLine: string | null }
  | { outcome: "screen" }
  | { outcome: "none"; reason: "no-match" | "low-confidence" | "invalid-answer" }
  | { outcome: "retry"; reason: "timeout" | "http-error" | "network-error" }
) & { usage?: TokenUsage };

/**
 * Identifies one photo. The photo is held only for the duration of the call; callers must
 * drop their own reference in `finally` and never persist or log it (AC-004.1).
 */
export type Identifier = (photo: Photo) => Promise<Identification>;

export interface IdentifierOptions {
  config: Config;
  expansion: Expansion;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const chatCompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

/** Creates the OpenAI-compatible identification client (ADR 0003, REQ-003, REQ-012). */
export function createIdentifier(options: IdentifierOptions): Identifier {
  const { config, expansion } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? IDENTIFY_TIMEOUT_MS;
  const systemPrompt = buildSystemPrompt(expansion);
  const answerSchema = modelAnswerSchema(expansion.cards.map((card) => card.id));
  const url = `${config.inference.baseUrl}/chat/completions`;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.inference.apiKey !== undefined) {
    headers.authorization = `Bearer ${config.inference.apiKey}`;
  }

  return async function identify(photo: Photo): Promise<Identification> {
    const body = JSON.stringify({
      model: config.inference.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${photo.mimeType};base64,${toBase64(photo.bytes)}` },
            },
          ],
        },
      ],
    });

    let responseText: string;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body,
        // A redirect would resend the photo to another host (REQ-004).
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { outcome: "retry", reason: "http-error" };
      }
      responseText = await response.text();
      if (responseText.length > MAX_RESPONSE_CHARS) {
        return { outcome: "none", reason: "invalid-answer" };
      }
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return { outcome: "retry", reason: timedOut ? "timeout" : "network-error" };
    }

    const { content, usage } = parseCompletion(responseText);
    const decided = decide(content);
    return usage === undefined ? decided : { ...decided, usage };
  };

  /** Decision order of design § Identification call: invalid → screen → none/low → card. */
  function decide(content: unknown): Identification {
    const answer = content === undefined ? undefined : answerSchema.safeParse(content);
    if (answer === undefined || !answer.success) {
      return { outcome: "none", reason: "invalid-answer" };
    }
    const { card_id: cardId, confidence, is_photo_of_screen: isScreen } = answer.data;
    if (isScreen) {
      return { outcome: "screen" };
    }
    if (cardId === NO_MATCH) {
      return { outcome: "none", reason: "no-match" };
    }
    if (confidence < config.identifyMinConfidence) {
      return { outcome: "none", reason: "low-confidence" };
    }
    return {
      outcome: "card",
      cardId,
      confidence,
      flavorLine: cleanFlavorLine(answer.data.flavor_line),
    };
  }
}

/**
 * Model text that other players will see: control and bidi characters become spaces and the
 * line is cut to 140 characters (AC-006.3). Empty lines become null.
 */
function cleanFlavorLine(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "")
    .replace(/[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = Array.from(cleaned).slice(0, FLAVOR_LINE_MAX_CHARS).join("").trimEnd();
  return truncated === "" ? null : truncated;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/**
 * The parsed JSON of the first choice (undefined if any layer is malformed) and the token
 * usage, when the endpoint reports it.
 */
function parseCompletion(responseText: string): { content: unknown; usage?: TokenUsage } {
  let completion;
  try {
    completion = chatCompletionSchema.safeParse(JSON.parse(responseText));
  } catch {
    return { content: undefined };
  }
  if (!completion.success) {
    return { content: undefined };
  }
  const reported = completion.data.usage;
  const usage =
    reported === undefined
      ? undefined
      : { promptTokens: reported.prompt_tokens, completionTokens: reported.completion_tokens };
  let content: unknown;
  try {
    content = JSON.parse(stripCodeFence(completion.data.choices[0]!.message.content));
  } catch {
    // Malformed JSON from the model is an expected case: it is treated as "none" (AC-003.8).
    content = undefined;
  }
  return usage === undefined ? { content } : { content, usage };
}

/** Some servers ignore `response_format` and wrap the JSON in a Markdown code fence. */
function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return fenced?.[1] ?? text;
}
