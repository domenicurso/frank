import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamObject } from "ai";
import z from "zod";

import { validateBurstPlan } from "@/frank/burst";
import { FRANK_MAX_BURST_MESSAGES } from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import { summarizeBurstPlan, summarizeSnapshot } from "@/frank/debugView";
import { FRANK_CHARACTER_MODEL } from "@/frank/models";
import { buildCharacterSystemPrompt, buildCharacterUserPrompt } from "@/frank/prompt";
import type { ResponseSnapshot } from "@/frank/types";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY || "",
});

const burstPlanSchema = z.object({
  chunks: z
    .array(
      z.object({
        text: z.string().min(1),
        pauseMs: z.number().int().min(0).max(4000).optional(),
      }),
    )
    .min(1)
    .max(FRANK_MAX_BURST_MESSAGES),
  reactionEmoji: z.string().max(24).nullable().optional(),
});

export function createBurstPlanStream(
  snapshot: ResponseSnapshot,
  maxBurstMessages: number,
) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY missing");
  }

  const systemPrompt = buildCharacterSystemPrompt();
  const userPrompt = buildCharacterUserPrompt(snapshot);

  frankDebug("character", "stream.input", {
    model: FRANK_CHARACTER_MODEL,
    maxBurstMessages,
    snapshot: summarizeSnapshot(snapshot),
    systemPromptLines: systemPrompt.split("\n"),
    userPromptLines: userPrompt.split("\n"),
  });

  const result = streamObject({
    model: openrouter(FRANK_CHARACTER_MODEL),
    schema: burstPlanSchema,
    temperature: 0.8,
    system: systemPrompt,
    prompt: userPrompt,
  });

  return Object.assign(result, {
    finalPlan: result.object.then((object) => {
      const plan = validateBurstPlan(object, maxBurstMessages);
      frankDebug("character", "stream.output", {
        rawObject: summarizeBurstPlan(plan),
        finalPlan: summarizeBurstPlan(plan),
      });
      return plan;
    }),
  });
}
