import { FRANK_MEMORY_BATCH_SIZE } from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import { summarizeEvidence, summarizeMessages } from "@/frank/debugView";
import {
  extractMemoryWithModel,
  synthesizeProfileWithModel,
} from "@/frank/processors";
import {
  getMemoryProfile,
  listFrankEventsForChannel,
  listMemoryEvidence,
  listProfilesForUsers,
  upsertMemoryEvidence,
  upsertMemoryProfile,
} from "@/frank/store";
import type {
  DiscordEvent,
  MemoryEvidence,
  MemoryCategory,
  MemoryProfile,
  MemorySubjectType,
  PersistedEvent,
  VisibleMessage,
} from "@/frank/types";

function uniqueMessagesById(events: Array<Extract<DiscordEvent, { type: "message_create" }>>) {
  const byId = new Map<string, Extract<DiscordEvent, { type: "message_create" }>>();

  for (const event of events) {
    byId.set(event.messageId, event);
  }

  return [...byId.values()];
}

function relevanceWords(input: string) {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((word) => word.length >= 3);
}

function scoreMemoryFact(
  category: MemoryCategory,
  content: string,
  recentWords: Set<string>,
) {
  const baseWeights: Record<MemoryCategory, number> = {
    goals: 1.45,
    projects: 1.35,
    preferences: 1.1,
    relationships: 0.9,
    habits: 0.8,
    identity: 0.6,
    recent_arc: 0.35,
  };

  const contentWords = relevanceWords(content);
  const overlap = contentWords.filter((word) => recentWords.has(word)).length;
  const overlapBoost = overlap > 0 ? 1.25 + overlap * 0.2 : 0;
  const helpBoost =
    (recentWords.has("help") ||
      recentWords.has("finals") ||
      recentWords.has("study") ||
      recentWords.has("class") ||
      recentWords.has("week")) &&
    (category === "goals" || category === "projects")
      ? 0.9
      : 0;

  return baseWeights[category] + overlapBoost + helpBoost;
}

function buildRetrievalSummary(
  profile: MemoryProfile,
  recentWords: Set<string>,
) {
  const facts = Object.entries(profile.profile)
    .flatMap(([category, values]) =>
      values.map((value) => ({
        category: category as MemoryCategory,
        value,
        score: scoreMemoryFact(category as MemoryCategory, value, recentWords),
      })),
    )
    .sort((left, right) => right.score - left.score);

  const topFacts = facts
    .filter((fact, index, array) => array.findIndex((entry) => entry.value === fact.value) === index)
    .slice(0, 2)
    .map((fact) => fact.value);

  if (topFacts.length === 0) {
    return profile.summary;
  }

  return topFacts.join(" ");
}

function decayedEvidenceScore(item: MemoryEvidence) {
  const ageMs = Date.now() - new Date(item.lastObservedAt).getTime();
  const ageDays = Math.max(0, ageMs / 86_400_000);
  const decayRate =
    item.category === "recent_arc"
      ? 0.18
      : item.category === "relationships"
        ? 0.1
        : 0.05;
  const recencyMultiplier = Math.max(0.35, 1 - ageDays * decayRate);
  const pinBoost = item.pinned ? 0.35 : 0;

  return item.salience * recencyMultiplier + item.confidence * 0.2 + pinBoost;
}

export async function extractMemoryFromChannel(
  guildId: string,
  channelId: string,
  sourceEventId: string,
) {
  const recentEvents = await listFrankEventsForChannel(
    channelId,
    FRANK_MEMORY_BATCH_SIZE,
  );

  const messages = uniqueMessagesById(
    recentEvents
    .filter(
      (
        event,
      ): event is Extract<DiscordEvent, { type: "message_create" }> =>
        event.type === "message_create",
    )
  )
    .map((event) => ({
      id: event.messageId,
      authorId: event.authorId,
      authorName: event.authorName,
      content: event.content,
      mentionsBot: event.mentionsBot,
      replyToMessageId: event.replyToMessageId,
      createdAt: event.createdAt,
      fromBot: false,
    }));

  frankDebug("memory", "channel_extract.input", {
    guildId,
    channelId,
    sourceEventId,
    recentEventCount: recentEvents.length,
    messageCount: messages.length,
    messages: summarizeMessages(messages, 6),
  });

  const modelEvidence = await extractMemoryWithModel(
    guildId,
    messages,
    sourceEventId,
  );

  if (!modelEvidence || modelEvidence.length === 0) {
    frankDebug("memory", "channel_extract.output", {
      guildId,
      channelId,
      sourceEventId,
      modelEvidence: [],
    });
    return;
  }

  for (const evidence of modelEvidence) {
    await upsertMemoryEvidence(evidence);
  }

  const subjects = modelEvidence
    ? [...new Set(modelEvidence.map((item) => `${item.subjectType}:${item.subjectId}`))]
    : [...new Set(messages.map((message) => `user:${message.authorId}`))];

  for (const subject of subjects) {
    const [subjectType, subjectId] = subject.split(":", 2);
    if (!subjectType || !subjectId) continue;
    await refreshSubjectProfile(
      guildId,
      subjectType as MemorySubjectType,
      subjectId,
    );
  }

  frankDebug("memory", "channel_extract.output", {
    guildId,
    channelId,
    sourceEventId,
    evidenceCount: modelEvidence.length,
    subjects,
  });
}

export async function refreshSubjectProfile(
  guildId: string,
  subjectType: MemorySubjectType,
  subjectId: string,
) {
  frankDebug("memory", "refresh_profile.input", {
    guildId,
    subjectType,
    subjectId,
  });

  const evidenceRecords = await listMemoryEvidence(guildId, subjectType, subjectId);
  const active = evidenceRecords.filter((record) => !record.suppressed);
  if (active.length === 0) return null;

  const displayName =
    subjectType === "user"
      ? active[0]?.content.split(" ")[0] ?? subjectId
      : active[0]?.subjectId ?? subjectId;

  const fallbackProfile = buildProfileFromEvidence(
    guildId,
    subjectType,
    subjectId,
    displayName,
    active.map((record) => ({
      id: String(record.id),
      guildId: record.guildId,
      subjectType: record.subjectType,
      subjectId: record.subjectId,
      category: record.category,
      key: record.memoryKey,
      content: record.content,
      confidence: record.confidence,
      salience: record.salience,
      pinned: record.pinned,
      suppressed: record.suppressed,
      sourceEventId: record.sourceEventId,
      lastObservedAt: record.lastObservedAt.toISOString(),
    })),
  );

  const synthesized = await synthesizeProfileWithModel(
    displayName,
    fallbackProfile.topEvidence,
  );

  const profile = synthesized
    ? {
        ...fallbackProfile,
        summary: synthesized.summary,
        profile: synthesized.profile,
      }
    : fallbackProfile;

  await upsertMemoryProfile(profile);
  frankDebug("memory", "refresh_profile.output", {
    guildId: profile.guildId,
    subjectType: profile.subjectType,
    subjectId: profile.subjectId,
    displayName: profile.displayName,
    summary: profile.summary,
    profile: profile.profile,
    topEvidence: summarizeEvidence(profile.topEvidence),
    updatedAt: profile.updatedAt,
  });
  return profile;
}

export function buildProfileFromEvidence(
  guildId: string,
  subjectType: MemorySubjectType,
  subjectId: string,
  displayName: string,
  evidence: MemoryEvidence[],
): MemoryProfile {
  const sorted = [...evidence].sort((left, right) => {
    const pinScore = Number(right.pinned) - Number(left.pinned);
    if (pinScore !== 0) return pinScore;
    return decayedEvidenceScore(right) - decayedEvidenceScore(left);
  });

  const profile = {
    identity: [] as string[],
    preferences: [] as string[],
    projects: [] as string[],
    relationships: [] as string[],
    habits: [] as string[],
    goals: [] as string[],
    recent_arc: [] as string[],
  };

  for (const item of sorted) {
    const bucket = profile[item.category];
    if (!bucket.includes(item.content) && bucket.length < 3) {
      bucket.push(item.content);
    }
  }

  const summaryParts = [
    profile.identity[0],
    profile.projects[0],
    profile.preferences[0],
    profile.goals[0],
  ].filter(Boolean);

  const summary =
    summaryParts.length > 0
      ? summaryParts.join(". ")
      : `${displayName} has a light profile built from recent conversation.`;

  return {
    guildId,
    subjectType,
    subjectId,
    displayName,
    summary,
    profile,
    topEvidence: sorted.slice(0, 6),
    updatedAt: new Date().toISOString(),
  };
}

export async function retrieveProfileMemory(
  guildId: string,
  visibleMessages: VisibleMessage[],
) {
  const userIds = [
    ...new Set(
      visibleMessages
        .filter((message) => !message.fromBot)
        .map((message) => message.authorId),
    ),
  ];
  const profiles = await listProfilesForUsers(guildId, userIds);
  const recentWords = new Set(
    visibleMessages
      .slice(-6)
      .flatMap((message) => relevanceWords(message.content)),
  );

  return profiles
    .map((profile) => ({
      profile,
      summary: buildRetrievalSummary(profile, recentWords),
      score: Math.max(
        ...Object.entries(profile.profile).flatMap(([category, values]) =>
          values.map((value) =>
            scoreMemoryFact(category as MemoryCategory, value, recentWords),
          ),
        ),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ profile, summary }) => ({
      subject: profile.displayName,
      summary,
    }));
}

export async function getProfileForCommand(
  guildId: string,
  subjectType: MemorySubjectType,
  subjectId: string,
) {
  const existing = await getMemoryProfile(guildId, subjectType, subjectId);
  if (existing) return existing;
  return refreshSubjectProfile(guildId, subjectType, subjectId);
}

export function compactProfileLines(profile: MemoryProfile) {
  const lines = [
    profile.summary,
    ...Object.entries(profile.profile)
      .flatMap(([category, values]) =>
        values.slice(0, 2).map((value) => `${category}: ${value}`),
      )
      .slice(0, 6),
  ];

  return lines.filter(Boolean);
}

export function isDiscordMessageEvent(event: PersistedEvent): event is DiscordEvent {
  return (
    event.type === "message_create" ||
    event.type === "message_update" ||
    event.type === "message_delete" ||
    event.type === "reaction_add"
  );
}
