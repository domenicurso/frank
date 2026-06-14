import { sequelize } from "@/database";
import {
  FRANK_CHARACTER_TIMEOUT_MS,
  FRANK_CONTINUATION_WINDOW_MS,
  FRANK_JOB_POLL_MS,
} from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import { parseJson, stringifyJson } from "@/frank/json";
import type {
  BurstChunk,
  ChannelControl,
  Concern,
  ConcernSnapshot,
  ConcernStatus,
  ConversationLane,
  FrankQueueName,
  LaneKey,
  LaneStatus,
  PendingIntentContext,
  QueueItem,
  QueueItemPayload,
  QueueItemState,
  QueueLease,
  Turn,
  TurnStatus,
} from "@/frank/types";
import { DataTypes, Model, Op } from "sequelize";
import { randomUUID } from "node:crypto";

const ACTIVE_QUEUE_STATES: QueueItemState[] = ["pending", "leased"];
const OPEN_CONCERN_STATUSES: ConcernStatus[] = ["queued", "generating"];
const ACTIVE_TURN_STATUSES: TurnStatus[] = ["planned", "streaming"];
const ACTIVE_QUEUE_NAMES: FrankQueueName[] = [
  "lane_update",
  "lane_generate",
  "lane_followup",
  "memory_refresh",
];

export class FrankChannelControlRecord extends Model {
  declare id: number;
  declare channelId: string;
  declare guildId: string;
  declare channelRevision: number;
  declare lastSeenEventId: string | null;
  declare lastHumanMessageId: string | null;
  declare lastHumanMessageAt: Date | null;
  declare lastBotMessageId: string | null;
  declare lastBotSentAt: Date | null;
  declare pendingSettleAt: Date | null;
  declare updatedAt: Date;
}

export class FrankConversationLaneRecord extends Model {
  declare id: number;
  declare laneKey: string;
  declare guildId: string;
  declare channelId: string;
  declare authorId: string;
  declare replyRootMessageId: string | null;
  declare status: LaneStatus;
  declare activeConcernId: string | null;
  declare activeTurnId: string | null;
  declare lastHumanActivityAt: Date | null;
  declare lastBotActivityAt: Date | null;
  declare updatedAt: Date;
}

export class FrankConcernRecord extends Model {
  declare id: string;
  declare laneKey: string;
  declare guildId: string;
  declare channelId: string;
  declare sourceEventIds: string;
  declare sourceMessageIds: string;
  declare focusAuthorId: string;
  declare anchorMessageId: string | null;
  declare status: ConcernStatus;
  declare supersededByConcernId: string | null;
  declare reasonCode: string;
  declare attemptCount: number;
  declare snapshotId: string | null;
  declare snapshotCreatedAt: Date | null;
  declare snapshotPayload: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export class FrankTurnRecord extends Model {
  declare id: string;
  declare concernId: string;
  declare laneKey: string;
  declare guildId: string;
  declare channelId: string;
  declare status: TurnStatus;
  declare plannedChunks: string;
  declare sentChunkCount: number;
  declare pendingIntentContext: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export class FrankQueueItemRecord extends Model {
  declare id: string;
  declare queueName: FrankQueueName;
  declare channelId: string | null;
  declare guildId: string | null;
  declare laneKey: string | null;
  declare concernId: string | null;
  declare turnId: string | null;
  declare dedupeKey: string | null;
  declare state: QueueItemState;
  declare availableAt: Date;
  declare leaseOwner: string | null;
  declare leaseExpiresAt: Date | null;
  declare attempts: number;
  declare payload: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

let initialized = false;

function defaultChannelControl(guildId: string, channelId: string): ChannelControl {
  return {
    guildId,
    channelId,
    channelRevision: 0,
    lastSeenEventId: null,
    lastHumanMessageId: null,
    lastHumanMessageAt: null,
    lastBotMessageId: null,
    lastBotSentAt: null,
    activeIntentId: null,
    activeIntentRevision: null,
    activeSnapshotId: null,
    activeSnapshotCreatedAt: null,
    pendingSettleAt: null,
    updatedAt: new Date().toISOString(),
  };
}

function toChannelControl(record: FrankChannelControlRecord): ChannelControl {
  return {
    guildId: record.guildId,
    channelId: record.channelId,
    channelRevision: record.channelRevision,
    lastSeenEventId: record.lastSeenEventId,
    lastHumanMessageId: record.lastHumanMessageId,
    lastHumanMessageAt: record.lastHumanMessageAt?.toISOString() ?? null,
    lastBotMessageId: record.lastBotMessageId,
    lastBotSentAt: record.lastBotSentAt?.toISOString() ?? null,
    activeIntentId: null,
    activeIntentRevision: null,
    activeSnapshotId: null,
    activeSnapshotCreatedAt: null,
    pendingSettleAt: record.pendingSettleAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toLane(record: FrankConversationLaneRecord): ConversationLane {
  return {
    laneKey: record.laneKey,
    guildId: record.guildId,
    channelId: record.channelId,
    authorId: record.authorId,
    replyRootMessageId: record.replyRootMessageId,
    status: record.status,
    activeConcernId: record.activeConcernId,
    activeTurnId: record.activeTurnId,
    lastHumanActivityAt: record.lastHumanActivityAt?.toISOString() ?? null,
    lastBotActivityAt: record.lastBotActivityAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toConcern(record: FrankConcernRecord): Concern {
  return {
    id: record.id,
    laneKey: record.laneKey,
    guildId: record.guildId,
    channelId: record.channelId,
    sourceEventIds: parseJson<string[]>(record.sourceEventIds, []),
    sourceMessageIds: parseJson<string[]>(record.sourceMessageIds, []),
    focusAuthorId: record.focusAuthorId,
    anchorMessageId: record.anchorMessageId,
    status: record.status,
    supersededByConcernId: record.supersededByConcernId,
    reasonCode: record.reasonCode as Concern["reasonCode"],
    attemptCount: record.attemptCount,
    snapshotId: record.snapshotId,
    snapshotCreatedAt: record.snapshotCreatedAt?.toISOString() ?? null,
    snapshot: record.snapshotPayload
      ? parseJson<ConcernSnapshot | null>(record.snapshotPayload, null)
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toTurn(record: FrankTurnRecord): Turn {
  return {
    id: record.id,
    concernId: record.concernId,
    laneKey: record.laneKey,
    guildId: record.guildId,
    channelId: record.channelId,
    status: record.status,
    plannedChunks: parseJson<BurstChunk[]>(record.plannedChunks, []),
    sentChunkCount: record.sentChunkCount,
    pendingIntentContext: record.pendingIntentContext
      ? parseJson<PendingIntentContext | null>(record.pendingIntentContext, null)
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toQueueItem(record: FrankQueueItemRecord): QueueItem {
  return {
    id: record.id,
    queueName: record.queueName,
    channelId: record.channelId,
    guildId: record.guildId,
    laneKey: record.laneKey,
    concernId: record.concernId,
    turnId: record.turnId,
    intentId: null,
    dedupeKey: record.dedupeKey,
    state: record.state,
    availableAt: record.availableAt.toISOString(),
    leaseOwner: record.leaseOwner,
    leaseExpiresAt: record.leaseExpiresAt?.toISOString() ?? null,
    attempts: record.attempts,
    payload: parseJson<QueueItemPayload>(record.payload, {} as QueueItemPayload),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function getPayloadFreshness(payload: QueueItemPayload) {
  if ("decisionCompletedAt" in payload) {
    return new Date(payload.decisionCompletedAt).getTime();
  }
  if ("sourceEventId" in payload && typeof payload.sourceEventId === "string") {
    return 0;
  }
  return 0;
}

function shouldReplacePayload(
  existingPayload: QueueItemPayload,
  nextPayload: QueueItemPayload,
  existingAvailableAt: Date,
  nextAvailableAt: Date,
) {
  const existingFreshness = getPayloadFreshness(existingPayload);
  const nextFreshness = getPayloadFreshness(nextPayload);
  if (nextFreshness !== existingFreshness) {
    return nextFreshness >= existingFreshness;
  }
  return nextAvailableAt.getTime() >= existingAvailableAt.getTime();
}

export function initializeFrankQueueModels() {
  if (initialized) return;
  initialized = true;

  FrankChannelControlRecord.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      channelId: { type: DataTypes.STRING, allowNull: false, unique: true },
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelRevision: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lastSeenEventId: { type: DataTypes.STRING, allowNull: true },
      lastHumanMessageId: { type: DataTypes.STRING, allowNull: true },
      lastHumanMessageAt: { type: DataTypes.DATE, allowNull: true },
      lastBotMessageId: { type: DataTypes.STRING, allowNull: true },
      lastBotSentAt: { type: DataTypes.DATE, allowNull: true },
      pendingSettleAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: "FrankChannelControlRecord",
      tableName: "frank_channel_controls",
      indexes: [{ unique: true, fields: ["channelId"] }, { fields: ["guildId"] }],
    },
  );

  FrankConversationLaneRecord.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      laneKey: { type: DataTypes.STRING, allowNull: false },
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false },
      authorId: { type: DataTypes.STRING, allowNull: false },
      replyRootMessageId: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "idle" },
      activeConcernId: { type: DataTypes.STRING, allowNull: true },
      activeTurnId: { type: DataTypes.STRING, allowNull: true },
      lastHumanActivityAt: { type: DataTypes.DATE, allowNull: true },
      lastBotActivityAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: "FrankConversationLaneRecord",
      tableName: "frank_conversation_lanes",
      indexes: [
        { unique: true, fields: ["channelId", "laneKey"] },
        { fields: ["channelId", "authorId", "updatedAt"] },
        { fields: ["channelId", "status"] },
      ],
    },
  );

  FrankConcernRecord.init(
    {
      id: { type: DataTypes.STRING, primaryKey: true },
      laneKey: { type: DataTypes.STRING, allowNull: false },
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false },
      sourceEventIds: { type: DataTypes.TEXT, allowNull: false, defaultValue: "[]" },
      sourceMessageIds: { type: DataTypes.TEXT, allowNull: false, defaultValue: "[]" },
      focusAuthorId: { type: DataTypes.STRING, allowNull: false },
      anchorMessageId: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false },
      supersededByConcernId: { type: DataTypes.STRING, allowNull: true },
      reasonCode: { type: DataTypes.STRING, allowNull: false },
      attemptCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      snapshotId: { type: DataTypes.STRING, allowNull: true },
      snapshotCreatedAt: { type: DataTypes.DATE, allowNull: true },
      snapshotPayload: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: "FrankConcernRecord",
      tableName: "frank_concerns",
      indexes: [
        { fields: ["channelId", "laneKey", "status"] },
        { fields: ["channelId", "focusAuthorId", "updatedAt"] },
      ],
    },
  );

  FrankTurnRecord.init(
    {
      id: { type: DataTypes.STRING, primaryKey: true },
      concernId: { type: DataTypes.STRING, allowNull: false },
      laneKey: { type: DataTypes.STRING, allowNull: false },
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false },
      plannedChunks: { type: DataTypes.TEXT, allowNull: false, defaultValue: "[]" },
      sentChunkCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      pendingIntentContext: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: "FrankTurnRecord",
      tableName: "frank_turns",
      indexes: [
        { fields: ["channelId", "laneKey", "updatedAt"] },
        { fields: ["concernId", "status"] },
      ],
    },
  );

  FrankQueueItemRecord.init(
    {
      id: { type: DataTypes.STRING, primaryKey: true },
      queueName: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: true },
      guildId: { type: DataTypes.STRING, allowNull: true },
      laneKey: { type: DataTypes.STRING, allowNull: true },
      concernId: { type: DataTypes.STRING, allowNull: true },
      turnId: { type: DataTypes.STRING, allowNull: true },
      dedupeKey: { type: DataTypes.STRING, allowNull: true },
      state: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pending",
      },
      availableAt: { type: DataTypes.DATE, allowNull: false },
      leaseOwner: { type: DataTypes.STRING, allowNull: true },
      leaseExpiresAt: { type: DataTypes.DATE, allowNull: true },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      payload: { type: DataTypes.TEXT, allowNull: false },
    },
    {
      sequelize,
      modelName: "FrankQueueItemRecord",
      tableName: "frank_queue_items",
      indexes: [
        { fields: ["queueName", "state", "availableAt"] },
        { fields: ["dedupeKey", "state"] },
        { fields: ["channelId", "laneKey", "state"] },
        { fields: ["concernId", "state"] },
      ],
    },
  );
}

async function safeDescribeTable(tableName: string) {
  try {
    return await sequelize.getQueryInterface().describeTable(tableName);
  } catch {
    return null;
  }
}

async function safeDropTable(tableName: string) {
  try {
    await sequelize.getQueryInterface().dropTable(tableName);
  } catch {
    // Ignore missing/locked legacy tables during cutover prep.
  }
}

export async function prepareFrankSchemaForHardCutover() {
  const queueTable = await safeDescribeTable("frank_queue_items");
  if (queueTable && !("laneKey" in queueTable)) {
    await safeDropTable("frank_queue_items");
  }

  const laneTable = await safeDescribeTable("frank_conversation_lanes");
  if (laneTable && !("laneKey" in laneTable)) {
    await safeDropTable("frank_conversation_lanes");
  }

  const concernTable = await safeDescribeTable("frank_concerns");
  if (concernTable && !("laneKey" in concernTable)) {
    await safeDropTable("frank_concerns");
  }

  const turnTable = await safeDescribeTable("frank_turns");
  if (turnTable && !("laneKey" in turnTable)) {
    await safeDropTable("frank_turns");
  }

  // Hard cutover: the old intent table is obsolete and should not survive
  // into the lane runtime as a live source of truth.
  await safeDropTable("frank_conversation_intents");
}

export async function markLegacyFrankJobsInactive() {
  try {
    await sequelize.query(
      "UPDATE frank_job_records SET status = 'completed' WHERE status IN ('pending', 'running')",
    );
  } catch {
    // Legacy table may not exist yet.
  }
}

export async function getChannelControl(
  guildId: string,
  channelId: string,
): Promise<ChannelControl> {
  const existing = await FrankChannelControlRecord.findOne({ where: { channelId } });
  if (existing) {
    return toChannelControl(existing);
  }

  const created = await FrankChannelControlRecord.create({
    guildId,
    channelId,
    channelRevision: 0,
  });

  return toChannelControl(created);
}

export async function saveChannelControl(control: ChannelControl) {
  await FrankChannelControlRecord.upsert({
    guildId: control.guildId,
    channelId: control.channelId,
    channelRevision: control.channelRevision,
    lastSeenEventId: control.lastSeenEventId,
    lastHumanMessageId: control.lastHumanMessageId,
    lastHumanMessageAt: control.lastHumanMessageAt
      ? new Date(control.lastHumanMessageAt)
      : null,
    lastBotMessageId: control.lastBotMessageId,
    lastBotSentAt: control.lastBotSentAt ? new Date(control.lastBotSentAt) : null,
    pendingSettleAt: control.pendingSettleAt ? new Date(control.pendingSettleAt) : null,
    updatedAt: new Date(),
  });
}

export async function getLane(
  guildId: string,
  channelId: string,
  laneKey: LaneKey,
): Promise<ConversationLane | null> {
  const record = await FrankConversationLaneRecord.findOne({
    where: { guildId, channelId, laneKey },
  });
  return record ? toLane(record) : null;
}

export async function upsertLane(input: {
  guildId: string;
  channelId: string;
  laneKey: LaneKey;
  authorId: string;
  replyRootMessageId?: string | null;
  status?: LaneStatus;
  activeConcernId?: string | null;
  activeTurnId?: string | null;
  lastHumanActivityAt?: string | null;
  lastBotActivityAt?: string | null;
}) {
  const existing = await FrankConversationLaneRecord.findOne({
    where: {
      guildId: input.guildId,
      channelId: input.channelId,
      laneKey: input.laneKey,
    },
  });

  if (!existing) {
    const created = await FrankConversationLaneRecord.create({
      laneKey: input.laneKey,
      guildId: input.guildId,
      channelId: input.channelId,
      authorId: input.authorId,
      replyRootMessageId: input.replyRootMessageId ?? null,
      status: input.status ?? "idle",
      activeConcernId: input.activeConcernId ?? null,
      activeTurnId: input.activeTurnId ?? null,
      lastHumanActivityAt: input.lastHumanActivityAt
        ? new Date(input.lastHumanActivityAt)
        : null,
      lastBotActivityAt: input.lastBotActivityAt
        ? new Date(input.lastBotActivityAt)
        : null,
    });
    return toLane(created);
  }

  existing.authorId = input.authorId;
  existing.replyRootMessageId =
    input.replyRootMessageId !== undefined
      ? input.replyRootMessageId
      : existing.replyRootMessageId;
  existing.status = input.status ?? existing.status;
  existing.activeConcernId =
    input.activeConcernId !== undefined
      ? input.activeConcernId
      : existing.activeConcernId;
  existing.activeTurnId =
    input.activeTurnId !== undefined ? input.activeTurnId : existing.activeTurnId;
  existing.lastHumanActivityAt =
    input.lastHumanActivityAt !== undefined
      ? input.lastHumanActivityAt
        ? new Date(input.lastHumanActivityAt)
        : null
      : existing.lastHumanActivityAt;
  existing.lastBotActivityAt =
    input.lastBotActivityAt !== undefined
      ? input.lastBotActivityAt
        ? new Date(input.lastBotActivityAt)
        : null
      : existing.lastBotActivityAt;
  await existing.save();
  return toLane(existing);
}

export async function listOpenLanesForAuthor(
  guildId: string,
  channelId: string,
  authorId: string,
) {
  const lanes = await FrankConversationLaneRecord.findAll({
    where: {
      guildId,
      channelId,
      authorId,
      status: { [Op.ne]: "idle" },
    },
    order: [["updatedAt", "DESC"]],
  });
  return lanes.map(toLane);
}

export async function getConcern(concernId: string) {
  const record = await FrankConcernRecord.findByPk(concernId);
  return record ? toConcern(record) : null;
}

export async function createConcern(input: {
  guildId: string;
  channelId: string;
  laneKey: LaneKey;
  sourceEventIds: string[];
  sourceMessageIds: string[];
  focusAuthorId: string;
  anchorMessageId: string | null;
  status: ConcernStatus;
  reasonCode: Concern["reasonCode"];
}) {
  const created = await FrankConcernRecord.create({
    id: randomUUID(),
    guildId: input.guildId,
    channelId: input.channelId,
    laneKey: input.laneKey,
    sourceEventIds: stringifyJson(input.sourceEventIds),
    sourceMessageIds: stringifyJson(input.sourceMessageIds),
    focusAuthorId: input.focusAuthorId,
    anchorMessageId: input.anchorMessageId,
    status: input.status,
    supersededByConcernId: null,
    reasonCode: input.reasonCode,
    attemptCount: 0,
    snapshotId: null,
    snapshotCreatedAt: null,
    snapshotPayload: null,
  });

  return toConcern(created);
}

export async function updateConcern(
  concernId: string,
  updates: Partial<{
    sourceEventIds: string[];
    sourceMessageIds: string[];
    anchorMessageId: string | null;
    status: ConcernStatus;
    supersededByConcernId: string | null;
    reasonCode: Concern["reasonCode"];
    attemptCount: number;
    snapshotId: string | null;
    snapshotCreatedAt: string | null;
    snapshot: ConcernSnapshot | null;
  }>,
) {
  const record = await FrankConcernRecord.findByPk(concernId);
  if (!record) return null;

  if (updates.sourceEventIds) {
    record.sourceEventIds = stringifyJson(updates.sourceEventIds);
  }
  if (updates.sourceMessageIds) {
    record.sourceMessageIds = stringifyJson(updates.sourceMessageIds);
  }
  if (updates.anchorMessageId !== undefined) {
    record.anchorMessageId = updates.anchorMessageId;
  }
  if (updates.status) {
    record.status = updates.status;
  }
  if (updates.supersededByConcernId !== undefined) {
    record.supersededByConcernId = updates.supersededByConcernId;
  }
  if (updates.reasonCode) {
    record.reasonCode = updates.reasonCode;
  }
  if (updates.attemptCount !== undefined) {
    record.attemptCount = updates.attemptCount;
  }
  if (updates.snapshotId !== undefined) {
    record.snapshotId = updates.snapshotId;
  }
  if (updates.snapshotCreatedAt !== undefined) {
    record.snapshotCreatedAt = updates.snapshotCreatedAt
      ? new Date(updates.snapshotCreatedAt)
      : null;
  }
  if (updates.snapshot !== undefined) {
    record.snapshotPayload = updates.snapshot ? stringifyJson(updates.snapshot) : null;
  }

  await record.save();
  return toConcern(record);
}

export async function listOpenConcernsForLane(
  guildId: string,
  channelId: string,
  laneKey: LaneKey,
) {
  const records = await FrankConcernRecord.findAll({
    where: {
      guildId,
      channelId,
      laneKey,
      status: { [Op.in]: [...OPEN_CONCERN_STATUSES, "sent"] },
    },
    order: [["createdAt", "ASC"]],
  });
  return records.map(toConcern);
}

export async function getQueuedConcernForLane(
  guildId: string,
  channelId: string,
  laneKey: LaneKey,
) {
  const record = await FrankConcernRecord.findOne({
    where: {
      guildId,
      channelId,
      laneKey,
      status: "queued",
    },
    order: [["createdAt", "ASC"]],
  });
  return record ? toConcern(record) : null;
}

export async function listRelevantConcernsForMessage(
  guildId: string,
  channelId: string,
  messageId: string,
  options: {
    includeSent?: boolean;
  } = {},
) {
  const records = await FrankConcernRecord.findAll({
    where: {
      guildId,
      channelId,
      status: {
        [Op.in]: options.includeSent
          ? [...OPEN_CONCERN_STATUSES, "sent"]
          : OPEN_CONCERN_STATUSES,
      },
    },
    order: [["updatedAt", "DESC"]],
  });

  const concerns = records
    .map(toConcern)
    .filter((concern) => concern.sourceMessageIds.includes(messageId));
  const latestByLane = new Map<LaneKey, Concern>();

  for (const concern of concerns) {
    if (!latestByLane.has(concern.laneKey)) {
      latestByLane.set(concern.laneKey, concern);
    }
  }

  return [...latestByLane.values()];
}

export async function createTurn(input: {
  concernId: string;
  laneKey: LaneKey;
  guildId: string;
  channelId: string;
}) {
  const created = await FrankTurnRecord.create({
    id: randomUUID(),
    concernId: input.concernId,
    laneKey: input.laneKey,
    guildId: input.guildId,
    channelId: input.channelId,
    status: "planned",
    plannedChunks: stringifyJson([]),
    sentChunkCount: 0,
    pendingIntentContext: null,
  });
  return toTurn(created);
}

export async function getTurn(turnId: string) {
  const record = await FrankTurnRecord.findByPk(turnId);
  return record ? toTurn(record) : null;
}

export async function updateTurn(
  turnId: string,
  updates: Partial<{
    status: TurnStatus;
    plannedChunks: BurstChunk[];
    sentChunkCount: number;
    pendingIntentContext: PendingIntentContext | null;
  }>,
) {
  const record = await FrankTurnRecord.findByPk(turnId);
  if (!record) return null;

  if (updates.status) {
    record.status = updates.status;
  }
  if (updates.plannedChunks) {
    record.plannedChunks = stringifyJson(updates.plannedChunks);
  }
  if (updates.sentChunkCount !== undefined) {
    record.sentChunkCount = updates.sentChunkCount;
  }
  if (updates.pendingIntentContext !== undefined) {
    record.pendingIntentContext = updates.pendingIntentContext
      ? stringifyJson(updates.pendingIntentContext)
      : null;
  }

  await record.save();
  return toTurn(record);
}

export async function getLatestPendingIntentForLane(
  guildId: string,
  channelId: string,
  laneKey: LaneKey,
) {
  if (!initialized || !FrankTurnRecord.sequelize) {
    return null;
  }

  const record = await FrankTurnRecord.findOne({
    where: {
      guildId,
      channelId,
      laneKey,
      status: { [Op.in]: ["aborted", "failed", "sent", ...ACTIVE_TURN_STATUSES] },
      pendingIntentContext: { [Op.ne]: null },
    },
    order: [["updatedAt", "DESC"]],
  });

  if (!record || !record.pendingIntentContext) {
    return null;
  }

  return parseJson<PendingIntentContext | null>(record.pendingIntentContext, null);
}

export async function recordLaneSent(options: {
  guildId: string;
  channelId: string;
  laneKey: LaneKey;
  concernId: string;
  turnId: string;
  sentAt: string;
  lastBotMessageId: string | null;
  plannedChunks: BurstChunk[];
  sentChunkCount: number;
}) {
  await updateTurn(options.turnId, {
    status: "sent",
    plannedChunks: options.plannedChunks,
    sentChunkCount: options.sentChunkCount,
    pendingIntentContext: null,
  });
  await updateConcern(options.concernId, { status: "sent" });
  await upsertLane({
    guildId: options.guildId,
    channelId: options.channelId,
    laneKey: options.laneKey,
    authorId: (await getLane(options.guildId, options.channelId, options.laneKey))?.authorId ?? "",
    status: "idle",
    activeConcernId: null,
    activeTurnId: null,
    lastBotActivityAt: options.sentAt,
  });

  const control = await getChannelControl(options.guildId, options.channelId);
  await saveChannelControl({
    ...control,
    lastBotMessageId: options.lastBotMessageId,
    lastBotSentAt: options.sentAt,
    pendingSettleAt: null,
  });
}

export async function upsertLaneWork(
  queueName: FrankQueueName,
  payload: QueueItemPayload,
  options: {
    guildId?: string | null;
    channelId?: string | null;
    laneKey?: LaneKey | null;
    concernId?: string | null;
    turnId?: string | null;
    dedupeKey?: string | null;
    availableAt?: Date;
  } = {},
) {
  const availableAt = options.availableAt ?? new Date();

  if (options.dedupeKey) {
    const existing = await FrankQueueItemRecord.findOne({
      where: {
        dedupeKey: options.dedupeKey,
        queueName,
        state: { [Op.in]: ACTIVE_QUEUE_STATES },
      },
      order: [["updatedAt", "DESC"], ["createdAt", "DESC"]],
    });

    if (existing) {
      const existingPayload = parseJson<QueueItemPayload>(existing.payload, payload);
      if (
        shouldReplacePayload(existingPayload, payload, existing.availableAt, availableAt)
      ) {
        existing.payload = stringifyJson(payload);
      }
      existing.availableAt = new Date(
        Math.max(existing.availableAt.getTime(), availableAt.getTime()),
      );
      existing.guildId = options.guildId ?? existing.guildId;
      existing.channelId = options.channelId ?? existing.channelId;
      existing.laneKey = options.laneKey ?? existing.laneKey;
      existing.concernId = options.concernId ?? existing.concernId;
      existing.turnId = options.turnId ?? existing.turnId;

      if (existing.state === "leased") {
        await existing.save();
        frankDebug("store", "queue.upsert.leased_refreshed", {
          queueName,
          queueItemId: existing.id,
          dedupeKey: options.dedupeKey,
        });
        return toQueueItem(existing);
      }

      existing.state = "pending";
      existing.leaseOwner = null;
      existing.leaseExpiresAt = null;
      await existing.save();

      frankDebug("store", "queue.upsert.updated", {
        queueName,
        queueItemId: existing.id,
        dedupeKey: options.dedupeKey,
        availableAt: existing.availableAt.toISOString(),
      });

      return toQueueItem(existing);
    }
  }

  const created = await FrankQueueItemRecord.create({
    id: randomUUID(),
    queueName,
    guildId: options.guildId ?? null,
    channelId: options.channelId ?? null,
    laneKey: options.laneKey ?? null,
    concernId: options.concernId ?? null,
    turnId: options.turnId ?? null,
    dedupeKey: options.dedupeKey ?? null,
    state: "pending",
    availableAt,
    leaseOwner: null,
    leaseExpiresAt: null,
    attempts: 0,
    payload: stringifyJson(payload),
  });

  frankDebug("store", "queue.upsert.created", {
    queueName,
    queueItemId: created.id,
    laneKey: created.laneKey,
    concernId: created.concernId,
    dedupeKey: created.dedupeKey,
  });

  return toQueueItem(created);
}

export async function claimLaneWork(
  queueName: FrankQueueName,
  workerId: string,
  limit: number,
  leaseMs: number,
): Promise<QueueLease[]> {
  const now = new Date();
  const due = await FrankQueueItemRecord.findAll({
    where: {
      queueName,
      state: "pending",
      availableAt: { [Op.lte]: now },
    },
    order: [["availableAt", "ASC"], ["createdAt", "ASC"]],
    limit,
  });

  const leases: QueueLease[] = [];

  for (const item of due) {
    const leaseOwner = `${workerId}:${item.id}:${Date.now()}`;
    const leaseExpiresAt = new Date(Date.now() + leaseMs);
    const [affected] = await FrankQueueItemRecord.update(
      {
        state: "leased",
        leaseOwner,
        leaseExpiresAt,
        attempts: item.attempts + 1,
      },
      {
        where: {
          id: item.id,
          state: "pending",
        },
      },
    );

    if (affected === 0) {
      continue;
    }

    item.state = "leased";
    item.leaseOwner = leaseOwner;
    item.leaseExpiresAt = leaseExpiresAt;
    item.attempts += 1;

    leases.push({
      ...toQueueItem(item),
      leaseOwner,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    });
  }

  if (leases.length > 0) {
    frankDebug("store", "queue.claimed", {
      queueName,
      count: leases.length,
      items: leases.map((item) => ({
        id: item.id,
        channelId: item.channelId,
        laneKey: item.laneKey,
        concernId: item.concernId,
      })),
    });
  }

  return leases;
}

export async function isQueueLeaseCurrent(itemId: string, leaseOwner: string) {
  const count = await FrankQueueItemRecord.count({
    where: {
      id: itemId,
      state: "leased",
      leaseOwner,
      leaseExpiresAt: { [Op.gt]: new Date() },
    },
  });
  return count > 0;
}

export async function completeLaneWork(itemId: string, leaseOwner: string) {
  const [affected] = await FrankQueueItemRecord.update(
    {
      state: "completed",
      leaseOwner: null,
      leaseExpiresAt: null,
    },
    {
      where: {
        id: itemId,
        state: "leased",
        leaseOwner,
      },
    },
  );
  return affected > 0;
}

export async function cancelLaneWork(itemId: string) {
  const [affected] = await FrankQueueItemRecord.update(
    {
      state: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
    },
    {
      where: {
        id: itemId,
        state: { [Op.in]: ACTIVE_QUEUE_STATES },
      },
    },
  );
  return affected > 0;
}

export async function cancelLaneWorkForConcern(concernId: string) {
  const [cancelled] = await FrankQueueItemRecord.update(
    {
      state: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
    },
    {
      where: {
        concernId,
        state: { [Op.in]: ACTIVE_QUEUE_STATES },
      },
    },
  );
  return cancelled;
}

export async function requeueExpiredLeases(
  queueNames: FrankQueueName[],
  now = new Date(),
) {
  const expired = await FrankQueueItemRecord.findAll({
    where: {
      queueName: { [Op.in]: queueNames },
      state: "leased",
      leaseExpiresAt: { [Op.lte]: now },
    },
  });

  let requeued = 0;

  for (const item of expired) {
    const concern = item.concernId ? await getConcern(item.concernId) : null;
    if (item.concernId && (!concern || !OPEN_CONCERN_STATUSES.includes(concern.status))) {
      item.state = "cancelled";
      item.leaseOwner = null;
      item.leaseExpiresAt = null;
      await item.save();
      continue;
    }

    item.state = "pending";
    item.leaseOwner = null;
    item.leaseExpiresAt = null;
    item.availableAt = now;
    await item.save();
    requeued += 1;
  }

  if (requeued > 0) {
    frankDebug("store", "queue.requeued_expired", {
      queueNames,
      requeued,
    });
  }

  return requeued;
}

export async function reconcileLaneRuntime() {
  await markLegacyFrankJobsInactive();

  await FrankQueueItemRecord.update(
    {
      state: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
    },
    {
      where: {
        queueName: {
          [Op.notIn]: ACTIVE_QUEUE_NAMES,
        },
        state: { [Op.in]: ACTIVE_QUEUE_STATES },
      },
    },
  );

  await requeueExpiredLeases(ACTIVE_QUEUE_NAMES, new Date());

  const lanes = await FrankConversationLaneRecord.findAll();
  for (const laneRecord of lanes) {
    if (!laneRecord.activeConcernId) {
      continue;
    }

    const concern = await getConcern(laneRecord.activeConcernId);
    const turn = laneRecord.activeTurnId ? await getTurn(laneRecord.activeTurnId) : null;
    const hasActiveWork = await FrankQueueItemRecord.count({
      where: {
        laneKey: laneRecord.laneKey,
        state: { [Op.in]: ACTIVE_QUEUE_STATES },
      },
    });

    const validConcern = concern && OPEN_CONCERN_STATUSES.includes(concern.status);
    const validTurn =
      !laneRecord.activeTurnId ||
      (turn && ACTIVE_TURN_STATUSES.includes(turn.status));

    if (validConcern && validTurn && hasActiveWork > 0) {
      continue;
    }

    laneRecord.status = "idle";
    laneRecord.activeConcernId = null;
    laneRecord.activeTurnId = null;
    await laneRecord.save();

    if (concern && OPEN_CONCERN_STATUSES.includes(concern.status)) {
      await updateConcern(concern.id, { status: "failed" });
    }
    if (turn && ACTIVE_TURN_STATUSES.includes(turn.status)) {
      await updateTurn(turn.id, { status: "aborted" });
    }
  }
}

export async function getDefaultOpenLaneForAuthor(
  guildId: string,
  channelId: string,
  authorId: string,
) {
  const lanes = await listOpenLanesForAuthor(guildId, channelId, authorId);
  return lanes[0] ?? null;
}

export async function getDefaultRelevantLaneForAuthor(
  guildId: string,
  channelId: string,
  authorId: string,
) {
  const openLane = await getDefaultOpenLaneForAuthor(guildId, channelId, authorId);
  if (openLane) {
    return openLane;
  }

  const cutoff = new Date(Date.now() - FRANK_CONTINUATION_WINDOW_MS);
  const records = await FrankConversationLaneRecord.findAll({
    where: {
      guildId,
      channelId,
      authorId,
      status: "idle",
      lastBotActivityAt: { [Op.gte]: cutoff },
    },
    order: [["lastBotActivityAt", "DESC"], ["updatedAt", "DESC"]],
    limit: 3,
  });

  return records.map(toLane)[0] ?? null;
}

export async function getCurrentQueuedItemsForLane(
  guildId: string,
  channelId: string,
  laneKey: LaneKey,
  queueNames?: FrankQueueName[],
) {
  const items = await FrankQueueItemRecord.findAll({
    where: {
      guildId,
      channelId,
      laneKey,
      ...(queueNames && queueNames.length > 0
        ? { queueName: { [Op.in]: queueNames } }
        : {}),
      state: { [Op.in]: ACTIVE_QUEUE_STATES },
    },
    order: [["availableAt", "ASC"], ["createdAt", "ASC"]],
  });
  return items.map(toQueueItem);
}

export function getDefaultQueueLeaseMs(queueName: FrankQueueName) {
  switch (queueName) {
    case "lane_generate":
      return FRANK_CHARACTER_TIMEOUT_MS + 4_000;
    case "memory_refresh":
      return 20_000;
    default:
      return Math.max(4_000, FRANK_JOB_POLL_MS * 20);
  }
}
