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

export function buildRetrievalSummary(profile: MemoryProfile) {
  return profile.summary;
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
  options: {
    abortSignal?: AbortSignal;
  } = {},
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
      authorUsername: event.authorUsername,
      content: event.content,
      mentionsBot: event.mentionsBot,
      mentionedUsers: event.mentionedUsers,
      mentionedChannels: event.mentionedChannels,
      replyToMessageId: event.replyToMessageId,
      replyPreview: event.replyPreview,
      attachments: event.attachments.map((attachment) => ({
        name: attachment.name,
        contentType: attachment.contentType,
        url: attachment.url,
      })),
      createdAt: event.createdAt,
      fromBot: false,
    }));

  frankDebug("memory", "channel_extract.input", {
    guildId,
    channelId,
    sourceEventId,
    recentEventCount: recentEvents.length,
    messageCount: messages.length,
    messages: summarizeMessages(messages, 4),
  });

  const modelEvidence = await extractMemoryWithModel(
    guildId,
    messages,
    sourceEventId,
    {
      abortSignal: options.abortSignal,
    },
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

  const preferredDisplayNames = new Map(
    modelEvidence.map((item) => [
      `${item.subjectType}:${item.subjectId}`,
      item.displayName,
    ]),
  );
  const subjects = modelEvidence
    ? [...new Set(modelEvidence.map((item) => `${item.subjectType}:${item.subjectId}`))]
    : [...new Set(messages.map((message) => `user:${message.authorId}`))];

  for (const subject of subjects) {
    if (options.abortSignal?.aborted) {
      throw new Error(String(options.abortSignal.reason || "aborted"));
    }
    const [subjectType, subjectId] = subject.split(":", 2);
    if (!subjectType || !subjectId) continue;
    await refreshSubjectProfile(
      guildId,
      subjectType as MemorySubjectType,
      subjectId,
      preferredDisplayNames.get(subject),
      {
        abortSignal: options.abortSignal,
      },
    );
  }

  frankDebug("memory", "channel_extract.output", {
    guildId,
    channelId,
    sourceEventId,
    evidenceCount: modelEvidence.length,
    subjectCount: subjects.length,
    subjects,
  });
}

export async function refreshSubjectProfile(
  guildId: string,
  subjectType: MemorySubjectType,
  subjectId: string,
  preferredDisplayName?: string,
  options: {
    abortSignal?: AbortSignal;
  } = {},
) {
  frankDebug("memory", "refresh_profile.input", {
    guildId,
    subjectType,
    subjectId,
  });

  const evidenceRecords = await listMemoryEvidence(guildId, subjectType, subjectId);
  const active = evidenceRecords.filter((record) => !record.suppressed);
  if (active.length === 0) return null;

  const existingProfile = await getMemoryProfile(guildId, subjectType, subjectId);
  const displayName =
    preferredDisplayName ||
    existingProfile?.displayName ||
    subjectId;

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
    {
      abortSignal: options.abortSignal,
    },
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
    bucketCounts: Object.fromEntries(
      Object.entries(profile.profile).map(([key, values]) => [key, values.length]),
    ),
    topEvidence: summarizeEvidence(profile.topEvidence, 3),
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
  const sortedEvidence = [...evidence].sort((left, right) => {
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

  for (const item of sortedEvidence) {
    const bucket = profile[item.category];
    if (!bucket.includes(item.content) && bucket.length < 3) {
      bucket.push(item.content);
    }
  }

  const summaryParts: string[] = [];
  for (const candidate of [
    profile.identity[0],
    profile.projects[0],
    profile.preferences[0],
    profile.goals[0],
  ]) {
    if (candidate) {
      summaryParts.push(candidate.trim().replace(/[. ]+$/g, ""));
    }
  }

  const summary =
    summaryParts.length > 0
      ? `${summaryParts.join(". ")}.`
      : `${displayName} has a light profile built from recent conversation.`;

  return {
    guildId,
    subjectType,
    subjectId,
    displayName,
    summary,
    profile,
    topEvidence: sortedEvidence.slice(0, 8),
    updatedAt: new Date().toISOString(),
  };
}

export async function retrieveProfileMemory(
  guildId: string,
  visibleMessages: VisibleMessage[],
  options: {
    focusUserId?: string | null;
  } = {},
) {
  try {
  const fallbackRecentUserIds = [
    ...new Set(
      [...visibleMessages]
        .reverse()
        .filter((message) => !message.fromBot)
        .map((message) => message.authorId),
    ),
  ].slice(0, 3);
  const recentUserIds = options.focusUserId
    ? [options.focusUserId]
    : fallbackRecentUserIds;
  const profiles = await listProfilesForUsers(guildId, recentUserIds);
  const profilesById = new Map(
    profiles.map((profile) => [profile.subjectId, profile]),
  );

  return recentUserIds
    .map((userId) => profilesById.get(userId))
    .filter((profile): profile is MemoryProfile => Boolean(profile))
    .map((profile) => ({
      subject: profile.displayName,
      summary: buildRetrievalSummary(profile),
    }));
  } catch {
    return [];
  }
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
