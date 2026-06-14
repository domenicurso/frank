export const FRANK_JOB_TYPES = [
  "runtime_update",
  "response_decision",
  "character_generation",
  "memory_extraction",
] as const;

export type FrankJobType = (typeof FRANK_JOB_TYPES)[number];

export const FRANK_QUEUE_NAMES = [
  "runtime_update",
  "settle_channel",
  "generate_intent",
  "memory_extraction",
] as const;

export type FrankQueueName = (typeof FRANK_QUEUE_NAMES)[number];
export type QueueItemState = "pending" | "leased" | "completed" | "cancelled";
export type IntentStatus =
  | "pending"
  | "generating"
  | "sending"
  | "sent"
  | "superseded"
  | "aborted"
  | "invalidated";
export type InterruptPolicy = "default";

export type DiscordEvent =
  | {
      type: "message_create";
      eventKey: string;
      guildId: string;
      channelId: string;
      messageId: string;
      authorId: string;
      authorName: string;
      authorUsername: string;
      content: string;
      mentionsBot: boolean;
      mentionsUserIds: string[];
      mentionedUsers: Array<{
        id: string;
        username: string;
        displayName: string;
      }>;
      mentionedChannels: Array<{ id: string; name: string }>;
      replyToMessageId: string | null;
      replyPreview: {
        authorName: string;
        authorUsername: string;
        content: string;
      } | null;
      createdAt: string;
      attachments: Array<{ name: string; url: string; contentType: string }>;
    }
  | {
      type: "message_update";
      eventKey: string;
      guildId: string;
      channelId: string;
      messageId: string;
      oldContent: string | null;
      newContent: string;
      editedAt: string;
    }
  | {
      type: "message_delete";
      eventKey: string;
      guildId: string;
      channelId: string;
      messageId: string;
      authorId: string | null;
      deletedAt: string;
    }
  | {
      type: "reaction_add";
      eventKey: string;
      guildId: string;
      channelId: string;
      messageId: string;
      userId: string;
      emoji: string;
      createdAt: string;
    };

export type SystemEvent =
  | {
      type: "response_decision";
      eventKey: string;
      channelId: string;
      decision: AttentionDecision;
      snapshotId: string | null;
      createdAt: string;
    }
  | {
      type: "burst_generated";
      eventKey: string;
      channelId: string;
      snapshotId: string;
      burstPlan: BurstPlan;
      createdAt: string;
    }
  | {
      type: "burst_sent";
      eventKey: string;
      channelId: string;
      snapshotId: string;
      messageIds: string[];
      createdAt: string;
    }
  | {
      type: "burst_aborted";
      eventKey: string;
      channelId: string;
      snapshotId: string;
      remainingChunks: string[];
      reason: InvalidationReason;
      createdAt: string;
    }
  | {
      type: "memory_corrected";
      eventKey: string;
      guildId: string;
      subjectType: MemorySubjectType;
      subjectId: string;
      evidenceId: string | null;
      action: "pin" | "suppress" | "forget" | "correct";
      createdAt: string;
    };

export type PersistedEvent = DiscordEvent | SystemEvent;

export type VisibleMessage = {
  id: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  content: string;
  mentionsBot: boolean;
  mentionedUsers?: Array<{
    id: string;
    username: string;
    displayName: string;
  }>;
  mentionedChannels?: Array<{ id: string; name: string }>;
  replyToMessageId: string | null;
  replyPreview?: {
    authorName: string;
    authorUsername: string;
    content: string;
  } | null;
  attachments?: Array<{ name: string; contentType: string; url: string }>;
  createdAt: string;
  fromBot: boolean;
};

export type PendingIntentContext = {
  snapshotId: string;
  anchorMessageId: string | null;
  interruptedAt: string;
  remainingChunks: string[];
};

export type ChannelRuntimeProjection = {
  guildId: string;
  channelId: string;
  visibleMessages: VisibleMessage[];
  recentEventIds: string[];
  activeIntentId: string | null;
  activeIntentRevision: number | null;
  activeSnapshotId: string | null;
  activeSnapshotCreatedAt: string | null;
  activeJobId: string | null;
  lastBotMessageId: string | null;
  lastBotSentAt: string | null;
  lastMentionAt: string | null;
  pendingIntent: PendingIntentContext | null;
  lastResponseEventId: string | null;
  lastHumanMessageAt: string | null;
};

export type ChannelControl = {
  guildId: string;
  channelId: string;
  channelRevision: number;
  lastSeenEventId: string | null;
  lastHumanMessageId: string | null;
  lastHumanMessageAt: string | null;
  lastBotMessageId: string | null;
  lastBotSentAt: string | null;
  activeIntentId: string | null;
  activeIntentRevision: number | null;
  activeSnapshotId: string | null;
  activeSnapshotCreatedAt: string | null;
  pendingSettleAt: string | null;
  updatedAt: string;
};

export type AttentionMode = "conversation-aware" | "opportunistic";

export type AttentionReason =
  | "direct_mention"
  | "reply_to_bot"
  | "continuation"
  | "opportunistic_question"
  | "opportunistic_active_room"
  | "cooldown"
  | "insufficient_signal"
  | "disabled";

export type AttentionDecision = {
  shouldRespond: boolean;
  reason: AttentionReason;
  targetMessageId: string | null;
  opportunismScore: number;
};

export type MemorySubjectType =
  | "user"
  | "project"
  | "relationship"
  | "server";

export type MemoryCategory =
  | "identity"
  | "preferences"
  | "projects"
  | "relationships"
  | "habits"
  | "goals"
  | "recent_arc";

export type MemorySubject = {
  subjectType: MemorySubjectType;
  subjectId: string;
  guildId: string;
  displayName: string;
};

export type MemoryEvidence = {
  id: string;
  guildId: string;
  subjectType: MemorySubjectType;
  subjectId: string;
  category: MemoryCategory;
  key: string;
  content: string;
  confidence: number;
  salience: number;
  pinned: boolean;
  suppressed: boolean;
  sourceEventId: string | null;
  lastObservedAt: string;
};

export type ProfileSummary = {
  headline: string;
  bullets: string[];
};

export type MemoryProfile = MemorySubject & {
  summary: string;
  profile: Record<MemoryCategory, string[]>;
  topEvidence: MemoryEvidence[];
  updatedAt: string;
};

export type MemoryCorrection = {
  guildId: string;
  subjectType: MemorySubjectType;
  subjectId: string;
  evidenceId: string | null;
  action: "pin" | "suppress" | "forget" | "correct";
  replacementContent?: string;
};

export type SnapshotMemoryBlock = {
  subject: string;
  summary: string;
};

export type ResponseSnapshot = {
  id: string;
  guildId: string;
  channelId: string;
  createdAt: string;
  anchorMessageId: string | null;
  visibleMessages: VisibleMessage[];
  pendingIntent: PendingIntentContext | null;
  memory: SnapshotMemoryBlock[];
  attentionDecision: AttentionDecision;
};

export type ConversationIntent = {
  id: string;
  channelId: string;
  guildId: string;
  sourceEventId: string;
  sourceMessageId: string | null;
  channelRevision: number;
  snapshotId: string;
  snapshotCreatedAt: string;
  snapshot: ResponseSnapshot;
  status: IntentStatus;
  interruptPolicy: InterruptPolicy | string;
  abortReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BurstChunk = {
  text: string;
  pauseMs?: number;
};

export type BurstPlan = {
  chunks: BurstChunk[];
  reactionEmoji?: string | null;
};

export type BurstExecutionState = {
  snapshotId: string;
  sentMessageIds: string[];
  currentChunkIndex: number;
  totalChunks: number;
};

export type InvalidationReason =
  | "message_deleted"
  | "message_edited"
  | "new_direct_message"
  | "new_reply"
  | "channel_shift"
  | "manual_abort"
  | "worker_timeout"
  | "worker_shutdown";

export type RuntimeUpdateJob = {
  eventId: string;
};

export type ResponseDecisionJob = {
  channelId: string;
  guildId: string;
  sourceEventId: string;
};

export type CharacterGenerationJob = {
  snapshot: ResponseSnapshot;
  responseDecisionAt: string;
};

export type MemoryExtractionJob = {
  guildId: string;
  channelId: string;
  sourceEventId: string;
};

export type SettleChannelJob = {
  guildId: string;
  channelId: string;
  sourceEventId: string;
  channelRevision: number;
};

export type GenerateIntentJob = {
  guildId: string;
  channelId: string;
  intentId: string;
  channelRevision: number;
  responseDecisionAt: string;
};

export type QueueItemPayload =
  | RuntimeUpdateJob
  | SettleChannelJob
  | GenerateIntentJob
  | MemoryExtractionJob;

export type QueueItem = {
  id: string;
  queueName: FrankQueueName;
  channelId: string | null;
  guildId: string | null;
  intentId: string | null;
  dedupeKey: string | null;
  state: QueueItemState;
  availableAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attempts: number;
  payload: QueueItemPayload;
  createdAt: string;
  updatedAt: string;
};

export type QueueLease = QueueItem & {
  leaseOwner: string;
  leaseExpiresAt: string;
};

export type FrankJobPayload =
  | RuntimeUpdateJob
  | ResponseDecisionJob
  | CharacterGenerationJob
  | MemoryExtractionJob;

export type FrankGuildSettings = {
  enabled: boolean;
  attentionMode: AttentionMode;
  opportunismLevel: number;
  reactionsEnabled: boolean;
  burstResponsesEnabled: boolean;
  maxBurstMessages: number;
  cooldownSeconds: number;
  allowedMentions: boolean;
  allowedReplies: boolean;
};
