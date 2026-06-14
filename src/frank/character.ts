import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ModelMessage } from "ai";
import { streamObject } from "ai";
import z from "zod";

import { validateBurstPlan } from "@/frank/burst";
import {
  FRANK_CHARACTER_TIMEOUT_MS,
  FRANK_MAX_BURST_MESSAGES,
} from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import { summarizeBurstPlan, summarizeSnapshot } from "@/frank/debugView";
import { humanizedUserToken } from "@/frank/messageContext";
import { FRANK_CHARACTER_MODEL } from "@/frank/models";
import { buildCharacterSystemPrompt, buildCharacterUserPrompt } from "@/frank/prompt";
import type { ResponseSnapshot, VisibleMessage } from "@/frank/types";

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

const MAX_MEDIA_PARTS = 4;

function inferContentType(attachment: { name: string; contentType?: string }) {
  const explicit = attachment.contentType?.toLowerCase();
  if (explicit && explicit !== "unknown") {
    return explicit;
  }

  const lowerName = attachment.name.toLowerCase();
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".avif")) return "image/avif";
  return "unknown";
}

function collectRecentVisualMedia(messages: VisibleMessage[]) {
  const media = messages
    .flatMap((message) =>
      (message.attachments ?? []).map((attachment) => {
        const contentType = inferContentType(attachment);
        return {
          authorToken: humanizedUserToken({
            username: message.authorUsername,
            displayName: message.authorName,
          }),
          content: message.content,
          name: attachment.name,
          url:
            typeof attachment.url === "string" && attachment.url.length > 0
              ? attachment.url
              : null,
          contentType,
        };
      }),
    )
    .filter((attachment) => attachment.url?.startsWith("http"))
    .filter((attachment) => attachment.contentType.startsWith("image/"))
    .slice(-MAX_MEDIA_PARTS);

  return media;
}

function buildCharacterUserMessages(snapshot: ResponseSnapshot): ModelMessage[] {
  const userPrompt = buildCharacterUserPrompt(snapshot);
  const media = collectRecentVisualMedia(snapshot.visibleMessages);
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: URL; mediaType?: string }
  > = [{ type: "text", text: userPrompt }];

  for (const attachment of media) {
    userContent.push({
      type: "text",
      text: `Recent visual from ${attachment.authorToken}: ${attachment.name}${attachment.content ? ` | message: ${attachment.content}` : ""}`,
    });
    if (!attachment.url) {
      userContent.push({
        type: "text",
        text: `Visual was referenced but had no usable URL: ${attachment.name}`,
      });
      continue;
    }
    try {
      userContent.push({
        type: "image",
        image: new URL(attachment.url),
        mediaType: attachment.contentType,
      });
    } catch {
      userContent.push({
        type: "text",
        text: `Unable to attach visual URL directly: ${attachment.name}`,
      });
    }
  }

  return [
    { role: "user", content: userContent },
  ];
}

export function createBurstPlanStream(
  snapshot: ResponseSnapshot,
  maxBurstMessages: number,
  options: {
    abortSignal?: AbortSignal;
  } = {},
) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY missing");
  }

  const systemPrompt = buildCharacterSystemPrompt();
  const messages = buildCharacterUserMessages(snapshot);
  const userPrompt = buildCharacterUserPrompt(snapshot);

  frankDebug("character", "stream.input", {
    model: FRANK_CHARACTER_MODEL,
    maxBurstMessages,
    snapshot: summarizeSnapshot(snapshot),
    attachedVisualCount: collectRecentVisualMedia(snapshot.visibleMessages).length,
    systemPromptLines: systemPrompt.split("\n"),
    userPromptLines: userPrompt.split("\n"),
  });

  const result = streamObject({
    model: openrouter(FRANK_CHARACTER_MODEL),
    schema: burstPlanSchema,
    temperature: 0.8,
    system: systemPrompt,
    abortSignal:
      options.abortSignal ?? AbortSignal.timeout(FRANK_CHARACTER_TIMEOUT_MS),
    messages,
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
