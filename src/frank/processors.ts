import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import z from "zod";

import {
  FRANK_ATTENTION_TIMEOUT_MS,
  FRANK_MEMORY_EXTRACTION_TIMEOUT_MS,
  FRANK_MEMORY_PROFILE_TIMEOUT_MS,
} from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import { summarizeEvidence, summarizeMessages } from "@/frank/debugView";
import { renderVisibleMessage } from "@/frank/messageContext";
import { FRANK_PROCESSOR_MODEL } from "@/frank/models";
import { logError } from "@/log";
import type {
  AttentionDecision,
  AttentionReason,
  ChannelRuntimeProjection,
  FrankGuildSettings,
  MemoryCategory,
  MemoryEvidence,
  MemoryProfile,
  MemorySubjectType,
  VisibleMessage,
} from "@/frank/types";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY || "",
});

const attentionSchema = z.object({
  shouldRespond: z.boolean(),
  reason: z.enum([
    "continuation",
    "opportunistic_question",
    "opportunistic_active_room",
    "insufficient_signal",
  ]),
  opportunismScore: z.number().min(0).max(1),
});

const memoryItemSchema = z.object({
  subjectType: z.enum(["user", "project", "relationship", "server"]),
  subjectId: z.string().min(1).max(120),
  displayName: z.string().min(1).max(120),
  category: z.enum([
    "identity",
    "preferences",
    "projects",
    "relationships",
    "habits",
    "goals",
    "recent_arc",
  ]),
  key: z.string().min(1).max(64),
  content: z.string().min(1).max(220),
  confidence: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
});

const memoryExtractionSchema = z.object({
  items: z.array(memoryItemSchema).max(12),
});

const memoryProfileSchema = z.object({
  summary: z.string().min(1).max(400),
  profile: z.object({
    identity: z.array(z.string().max(220)).max(3),
    preferences: z.array(z.string().max(220)).max(3),
    projects: z.array(z.string().max(220)).max(3),
    relationships: z.array(z.string().max(220)).max(3),
    habits: z.array(z.string().max(220)).max(3),
    goals: z.array(z.string().max(220)).max(3),
    recent_arc: z.array(z.string().max(220)).max(3),
  }),
});

function hasModelAccess() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function transcriptFromMessages(messages: VisibleMessage[]) {
  return messages
    .map((message) => {
      const rendered = renderVisibleMessage(message, messages);
      return `${rendered} (${message.authorId})`;
    })
    .join("\n");
}

export async function classifyAttentionWithModel(
  runtime: ChannelRuntimeProjection,
  latestMessage: VisibleMessage,
  settings: FrankGuildSettings,
  options: {
    abortSignal?: AbortSignal;
  } = {},
): Promise<AttentionDecision | null> {
  if (!hasModelAccess()) return null;

  frankDebug("processor", "attention.input", {
    model: FRANK_PROCESSOR_MODEL,
    attentionMode: settings.attentionMode,
    opportunismLevel: settings.opportunismLevel,
    latestMessage: summarizeMessages([latestMessage], 1)[0] ?? null,
    visibleMessages: summarizeMessages(runtime.visibleMessages.slice(-10), 6),
  });

  try {
    const { object } = await generateObject({
      model: openrouter(FRANK_PROCESSOR_MODEL, {}),
      schema: attentionSchema,
      temperature: 0.1,
      abortSignal:
        options.abortSignal ?? AbortSignal.timeout(FRANK_ATTENTION_TIMEOUT_MS),
      system: `You are a narrow Discord attention classifier for Frank.

Decide only whether Frank should join this exact chat moment.

Rules:
- Prefer not responding unless the message is actually addressable or socially natural for Frank to join.
- Frank is casual, sarcastic, and human-like, but should not intrude constantly.
- Use "continuation" if the current message clearly continues a recent Frank conversation.
- Use "opportunistic_question" if this looks like an open question or prompt Frank could naturally answer.
- Use "opportunistic_active_room" only if the room is small/engaged enough that a natural interjection fits.
- Use "insufficient_signal" if Frank should stay quiet.
- The opportunism score should reflect how justified an ambient response is, not the user's configured setting.
- If a previous message tells Frank to go away, do not respond.`,
      prompt: `Attention mode: ${settings.attentionMode}
Configured opportunism level: ${settings.opportunismLevel}

Recent transcript:
${transcriptFromMessages(runtime.visibleMessages.slice(-10))}

Current message:
${latestMessage.authorName} (${latestMessage.authorId}): ${latestMessage.content}`,
    });

    const decision = {
      shouldRespond: object.shouldRespond,
      reason: object.reason as AttentionReason,
      targetMessageId: latestMessage.id,
      opportunismScore: object.opportunismScore,
    };
    frankDebug("processor", "attention.output", decision);
    return decision;
  } catch (error) {
    logError("processor", "Attention classifier failed", error, {
      model: FRANK_PROCESSOR_MODEL,
      latestMessageId: latestMessage.id,
    });
    frankDebug("processor", "attention.error", error);
    return null;
  }
}

export async function extractMemoryWithModel(
  guildId: string,
  messages: VisibleMessage[],
  sourceEventId: string | null,
  options: {
    abortSignal?: AbortSignal;
  } = {},
): Promise<Array<
  Omit<MemoryEvidence, "id"> & {
    displayName: string;
  }
> | null> {
  if (!hasModelAccess() || messages.length === 0) return null;

  frankDebug("processor", "memory_extract.input", {
    model: FRANK_PROCESSOR_MODEL,
    guildId,
    sourceEventId,
    messageCount: messages.length,
    participants: [...new Set(messages.map((message) => message.authorName))],
    messages: summarizeMessages(messages, 4),
  });

  try {
    const participants = [
      ...new Set(
        messages.map(
          (message) => `${message.authorName} (${message.authorId})`,
        ),
      ),
    ];
    const { object } = await generateObject({
      model: openrouter(FRANK_PROCESSOR_MODEL),
      schema: memoryExtractionSchema,
      temperature: 0.1,
      abortSignal:
        options.abortSignal ??
        AbortSignal.timeout(FRANK_MEMORY_EXTRACTION_TIMEOUT_MS),
      system: `Extract durable memory from a Discord chat batch.

Return only information worth remembering later.
If nothing in this batch is worth long-term memory, return zero items.

Good memory:
- durable preferences
- active projects
- goals
- stable self-description
- relationships that matter for continuity
- meaningful recent arc when it helps future coherence

Bad memory:
- one-off jokes
- filler chatter
- temporary mood unless it clearly matters
- trivial details that should not dominate future memory
- routine use of Frank's name or obvious direct-addressing with no new information
- generic "help me", "lol", "bruh", or boilerplate banter unless it reveals a durable goal or project
- isolated weird exchanges that should not become the person's main remembered trait
- test prompts, ping checks, mention checks, reply checks, or "can you see this image" style validation chatter
- one-off moderation corrections unless they represent a repeated durable boundary
- repeated restatements of the same project or goal in slightly different words
- dev changelog details, diff summaries, cleanup notes, or implementation logs unless they reflect a genuinely new durable project state
- generic "talks to Frank", "knows Frank", or "uses Frank's name" relationship items unless there is a real social fact underneath
- image visibility checks, channel formatting checks, or message deletion cleanup requests

Subject id rules:
- For user subjects, use the exact Discord user id shown in the transcript.
- For server subjects, use the guild id: ${guildId}
- For project or relationship subjects, use concise stable ids like "frank-runtime" or "user123:partner".
- For user display names, use the participant name exactly as shown in the transcript.

Keys should be stable kebab-case and concise.

Profile realism rules:
- Be conservative. Fewer memories is better than polluted memory, only include big, relevant items.
- Usually emit 0-4 items for a batch, not the maximum.
- Prefer one strong memory item over several weak variants of the same idea.
- Avoid extracting implementation-testing behavior as a personality trait.`,
      prompt: `Guild id: ${guildId}
Participants:
${participants.join("\n")}

Transcript:
${transcriptFromMessages(messages)}`,
    });

    const items = object.items.map((item) => ({
      guildId,
      subjectType: item.subjectType as MemorySubjectType,
      subjectId: item.subjectId,
      category: item.category as MemoryCategory,
      key: item.key,
      content: item.content,
      confidence: item.confidence,
      salience: item.salience,
      pinned: false,
      suppressed: false,
      sourceEventId,
      lastObservedAt:
        messages[messages.length - 1]?.createdAt ?? new Date().toISOString(),
      displayName: item.displayName,
    }));
    frankDebug("processor", "memory_extract.output", {
      itemCount: items.length,
      subjects: [
        ...new Set(
          items.map((item) => `${item.subjectType}:${item.subjectId}`),
        ),
      ],
      categories: [...new Set(items.map((item) => item.category))],
      items: items.slice(0, 5).map((item) => ({
        category: item.category,
        subjectId: item.subjectId,
        key: item.key,
        salience: Number(item.salience.toFixed(2)),
        confidence: Number(item.confidence.toFixed(2)),
        content: item.content,
      })),
    });
    return items;
  } catch (error) {
    logError("processor", "Memory extractor failed", error, {
      model: FRANK_PROCESSOR_MODEL,
      guildId,
      sourceEventId,
    });
    frankDebug("processor", "memory_extract.error", error);
    return null;
  }
}

export async function synthesizeProfileWithModel(
  displayName: string,
  evidence: MemoryEvidence[],
  options: {
    abortSignal?: AbortSignal;
  } = {},
): Promise<Pick<MemoryProfile, "summary" | "profile"> | null> {
  if (!hasModelAccess() || evidence.length === 0) return null;

  frankDebug("processor", "profile_synthesis.input", {
    model: FRANK_PROCESSOR_MODEL,
    displayName,
    evidenceCount: evidence.length,
    evidence: summarizeEvidence(evidence, 4),
  });

  try {
    const { object } = await generateObject({
      model: openrouter(FRANK_PROCESSOR_MODEL),
      schema: memoryProfileSchema,
      temperature: 0.2,
      abortSignal:
        options.abortSignal ??
        AbortSignal.timeout(FRANK_MEMORY_PROFILE_TIMEOUT_MS),
      system: `You are synthesizing a human-like memory profile for a Discord character bot.

Goal:
- produce a compact, coherent profile that feels like what a person would remember
- emphasize durable, important details
- avoid over-weighting minor trivia
- prefer ongoing goals, projects, and stable preferences over one-off recent arcs
- only include recent-arc material if it still matters for continuity or is unusually salient
- keep each bullet concrete and natural
- do not repeat the same theme across projects, goals, and recent_arc
- if two evidence items say nearly the same thing, merge them into one cleaner memory
- use preferences for durable tastes or boundaries, not every isolated correction or annoyance
- keep the summary and buckets feeling like a person's mental model, not a changelog
- avoid relationship bullets that only say the user talks to Frank or knows Frank
- avoid recent_arc bullets that just summarize code diffs, cleanup, or debugging unless that state truly matters later
- prefer leaving a bucket empty over filling it with weak or noisy trivia
- summarize the person, not the transcript
- do not invent facts beyond the evidence`,
      prompt: `Subject: ${displayName}

Evidence:
${evidence
  .map(
    (item) =>
      `- [${item.category}] ${item.content} (salience=${item.salience.toFixed(2)}, confidence=${item.confidence.toFixed(2)}, pinned=${item.pinned})`,
  )
  .join("\n")}`,
    });

    frankDebug("processor", "profile_synthesis.output", {
      summary: object.summary,
      bucketCounts: Object.fromEntries(
        Object.entries(object.profile).map(([key, values]) => [
          key,
          values.length,
        ]),
      ),
    });
    return object;
  } catch (error) {
    logError("processor", "Profile synthesis failed", error, {
      model: FRANK_PROCESSOR_MODEL,
      displayName,
    });
    frankDebug("processor", "profile_synthesis.error", error);
    return null;
  }
}
