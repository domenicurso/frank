import { sequelize } from "@/database";
import { FRANK_CHARACTER_TIMEOUT_MS, FRANK_JOB_POLL_MS } from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import { parseJson, stringifyJson } from "@/frank/json";
import type {
  ChannelControl,
  ConversationIntent,
  FrankQueueName,
  IntentStatus,
  QueueItem,
  QueueItemPayload,
  QueueItemState,
  QueueLease,
  ResponseSnapshot,
} from "@/frank/types";
import { DataTypes, Model, Op } from "sequelize";
import { randomUUID } from "node:crypto";

const DEFAULT_INTERRUPT_POLICY = "default";
const ACTIVE_INTENT_STATUSES: IntentStatus[] = ["pending", "generating", "sending"];
const ACTIVE_QUEUE_STATES: QueueItemState[] = ["pending", "leased"];

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
  declare activeIntentId: string | null;
  declare activeIntentRevision: number | null;
  declare activeSnapshotId: string | null;
  declare activeSnapshotCreatedAt: Date | null;
  declare pendingSettleAt: Date | null;
  declare updatedAt: Date;
}

export class FrankConversationIntentRecord extends Model {
  declare id: string;
  declare channelId: string;
  declare guildId: string;
  declare sourceEventId: string;
  declare sourceMessageId: string | null;
  declare channelRevision: number;
  declare snapshotId: string;
  declare snapshotCreatedAt: Date;
  declare snapshotPayload: string;
  declare status: IntentStatus;
  declare interruptPolicy: string;
  declare abortReason: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export class FrankQueueItemRecord extends Model {
  declare id: string;
  declare queueName: FrankQueueName;
  declare channelId: string | null;
  declare guildId: string | null;
  declare intentId: string | null;
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
    activeIntentId: record.activeIntentId,
    activeIntentRevision: record.activeIntentRevision,
    activeSnapshotId: record.activeSnapshotId,
    activeSnapshotCreatedAt:
      record.activeSnapshotCreatedAt?.toISOString() ?? null,
    pendingSettleAt: record.pendingSettleAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toConversationIntent(
  record: FrankConversationIntentRecord,
): ConversationIntent {
  return {
    id: record.id,
    channelId: record.channelId,
    guildId: record.guildId,
    sourceEventId: record.sourceEventId,
    sourceMessageId: record.sourceMessageId,
    channelRevision: record.channelRevision,
    snapshotId: record.snapshotId,
    snapshotCreatedAt: record.snapshotCreatedAt.toISOString(),
    snapshot: parseJson<ResponseSnapshot>(record.snapshotPayload, {
      id: record.snapshotId,
      guildId: record.guildId,
      channelId: record.channelId,
      createdAt: record.snapshotCreatedAt.toISOString(),
      anchorMessageId: null,
      visibleMessages: [],
      pendingIntent: null,
      memory: [],
      attentionDecision: {
        shouldRespond: false,
        reason: "insufficient_signal",
        targetMessageId: null,
        opportunismScore: 0,
      },
    }),
    status: record.status,
    interruptPolicy: record.interruptPolicy,
    abortReason: record.abortReason,
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
    intentId: record.intentId,
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

function getPayloadRevision(payload: QueueItemPayload) {
  if ("channelRevision" in payload && typeof payload.channelRevision === "number") {
    return payload.channelRevision;
  }
  return null;
}

function shouldReplacePayload(
  existingPayload: QueueItemPayload,
  nextPayload: QueueItemPayload,
  existingAvailableAt: Date,
  nextAvailableAt: Date,
) {
  const existingRevision = getPayloadRevision(existingPayload);
  const nextRevision = getPayloadRevision(nextPayload);

  if (existingRevision !== null || nextRevision !== null) {
    return (nextRevision ?? -1) >= (existingRevision ?? -1);
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
      activeIntentId: { type: DataTypes.STRING, allowNull: true },
      activeIntentRevision: { type: DataTypes.INTEGER, allowNull: true },
      activeSnapshotId: { type: DataTypes.STRING, allowNull: true },
      activeSnapshotCreatedAt: { type: DataTypes.DATE, allowNull: true },
      pendingSettleAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: "FrankChannelControlRecord",
      tableName: "frank_channel_controls",
      indexes: [{ unique: true, fields: ["channelId"] }, { fields: ["guildId"] }],
    },
  );

  FrankConversationIntentRecord.init(
    {
      id: { type: DataTypes.STRING, primaryKey: true },
      channelId: { type: DataTypes.STRING, allowNull: false },
      guildId: { type: DataTypes.STRING, allowNull: false },
      sourceEventId: { type: DataTypes.STRING, allowNull: false },
      sourceMessageId: { type: DataTypes.STRING, allowNull: true },
      channelRevision: { type: DataTypes.INTEGER, allowNull: false },
      snapshotId: { type: DataTypes.STRING, allowNull: false },
      snapshotCreatedAt: { type: DataTypes.DATE, allowNull: false },
      snapshotPayload: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false },
      interruptPolicy: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: DEFAULT_INTERRUPT_POLICY,
      },
      abortReason: { type: DataTypes.STRING, allowNull: true },
    },
    {
      sequelize,
      modelName: "FrankConversationIntentRecord",
      tableName: "frank_conversation_intents",
      indexes: [
        { fields: ["channelId", "status"] },
        { fields: ["guildId", "channelId", "channelRevision"] },
      ],
    },
  );

  FrankQueueItemRecord.init(
    {
      id: { type: DataTypes.STRING, primaryKey: true },
      queueName: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: true },
      guildId: { type: DataTypes.STRING, allowNull: true },
      intentId: { type: DataTypes.STRING, allowNull: true },
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
        { fields: ["intentId", "state"] },
      ],
    },
  );
}

export async function markLegacyFrankJobsInactive() {
  try {
    await sequelize.query(
      "UPDATE frank_job_records SET status = 'completed' WHERE status IN ('pending', 'running')",
    );
  } catch {
    // Legacy table may not exist yet in a fresh environment.
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
    activeIntentId: control.activeIntentId,
    activeIntentRevision: control.activeIntentRevision,
    activeSnapshotId: control.activeSnapshotId,
    activeSnapshotCreatedAt: control.activeSnapshotCreatedAt
      ? new Date(control.activeSnapshotCreatedAt)
      : null,
    pendingSettleAt: control.pendingSettleAt
      ? new Date(control.pendingSettleAt)
      : null,
    updatedAt: new Date(),
  });
}

export async function clearChannelActiveIntent(
  channelId: string,
  reason?: string | null,
) {
  const record = await FrankChannelControlRecord.findOne({ where: { channelId } });
  if (!record || !record.activeIntentId) {
    return null;
  }

  const clearedIntentId = record.activeIntentId;
  record.activeIntentId = null;
  record.activeIntentRevision = null;
  record.activeSnapshotId = null;
  record.activeSnapshotCreatedAt = null;
  await record.save();

  if (reason) {
    await FrankConversationIntentRecord.update(
      { status: "superseded", abortReason: reason },
      {
        where: {
          id: clearedIntentId,
          status: { [Op.in]: ACTIVE_INTENT_STATUSES },
        },
      },
    );
  }

  return clearedIntentId;
}

export async function getConversationIntent(
  intentId: string,
): Promise<ConversationIntent | null> {
  const record = await FrankConversationIntentRecord.findByPk(intentId);
  return record ? toConversationIntent(record) : null;
}

export async function createConversationIntent(options: {
  control: ChannelControl;
  sourceEventId: string;
  sourceMessageId: string | null;
  snapshot: ResponseSnapshot;
  interruptPolicy?: string;
}) {
  const created = await FrankConversationIntentRecord.create({
    id: options.snapshot.id,
    channelId: options.control.channelId,
    guildId: options.control.guildId,
    sourceEventId: options.sourceEventId,
    sourceMessageId: options.sourceMessageId,
    channelRevision: options.control.channelRevision,
    snapshotId: options.snapshot.id,
    snapshotCreatedAt: new Date(options.snapshot.createdAt),
    snapshotPayload: stringifyJson(options.snapshot),
    status: "pending",
    interruptPolicy: options.interruptPolicy ?? DEFAULT_INTERRUPT_POLICY,
    abortReason: null,
  });

  await saveChannelControl({
    ...options.control,
    activeIntentId: created.id,
    activeIntentRevision: options.control.channelRevision,
    activeSnapshotId: options.snapshot.id,
    activeSnapshotCreatedAt: options.snapshot.createdAt,
    pendingSettleAt: null,
  });

  return toConversationIntent(created);
}

export async function updateConversationIntent(
  intentId: string,
  updates: Partial<
    Pick<ConversationIntent, "status" | "abortReason" | "snapshot" | "snapshotCreatedAt">
  >,
) {
  const record = await FrankConversationIntentRecord.findByPk(intentId);
  if (!record) return null;

  if (updates.status) {
    record.status = updates.status;
  }
  if (updates.abortReason !== undefined) {
    record.abortReason = updates.abortReason;
  }
  if (updates.snapshot) {
    record.snapshotPayload = stringifyJson(updates.snapshot);
    record.snapshotId = updates.snapshot.id;
    record.snapshotCreatedAt = new Date(updates.snapshot.createdAt);
  } else if (updates.snapshotCreatedAt) {
    record.snapshotCreatedAt = new Date(updates.snapshotCreatedAt);
  }

  await record.save();
  return toConversationIntent(record);
}

export async function markIntentStatus(
  intentId: string,
  status: IntentStatus,
  abortReason?: string | null,
) {
  await FrankConversationIntentRecord.update(
    {
      status,
      abortReason: abortReason ?? null,
    },
    { where: { id: intentId } },
  );
}

export async function recordSentBurstOnControl(options: {
  channelId: string;
  sentAt: string;
  lastBotMessageId: string | null;
}) {
  const record = await FrankChannelControlRecord.findOne({
    where: { channelId: options.channelId },
  });
  if (!record) return;

  record.lastBotMessageId = options.lastBotMessageId;
  record.lastBotSentAt = new Date(options.sentAt);
  record.activeIntentId = null;
  record.activeIntentRevision = null;
  record.activeSnapshotId = null;
  record.activeSnapshotCreatedAt = null;
  record.pendingSettleAt = null;
  await record.save();
}

export async function upsertQueueItem(
  queueName: FrankQueueName,
  payload: QueueItemPayload,
  options: {
    dedupeKey?: string | null;
    channelId?: string | null;
    guildId?: string | null;
    intentId?: string | null;
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
      if (existing.state === "leased") {
        frankDebug("store", "queue.upsert.leased_conflict", {
          queueName,
          queueItemId: existing.id,
          dedupeKey: options.dedupeKey,
        });
      } else {
        const existingPayload = parseJson<QueueItemPayload>(
          existing.payload,
          payload,
        );
        if (
          shouldReplacePayload(
            existingPayload,
            payload,
            existing.availableAt,
            availableAt,
          )
        ) {
          existing.payload = stringifyJson(payload);
        }
        existing.availableAt = new Date(
          Math.max(existing.availableAt.getTime(), availableAt.getTime()),
        );
        existing.channelId = options.channelId ?? existing.channelId;
        existing.guildId = options.guildId ?? existing.guildId;
        existing.intentId = options.intentId ?? existing.intentId;
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
  }

  const created = await FrankQueueItemRecord.create({
    id: randomUUID(),
    queueName,
    channelId: options.channelId ?? null,
    guildId: options.guildId ?? null,
    intentId: options.intentId ?? null,
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
    dedupeKey: options.dedupeKey ?? null,
    availableAt: created.availableAt.toISOString(),
  });

  return toQueueItem(created);
}

export async function claimQueueItems(
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
        intentId: item.intentId,
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

export async function completeQueueItem(itemId: string, leaseOwner: string) {
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

export async function cancelQueueItemsForIntent(intentId: string) {
  const [cancelled] = await FrankQueueItemRecord.update(
    {
      state: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
    },
    {
      where: {
        intentId,
        state: { [Op.in]: ACTIVE_QUEUE_STATES },
      },
    },
  );
  return cancelled;
}

export async function cancelQueueItemByDedupeKey(
  dedupeKey: string,
  queueName?: FrankQueueName,
) {
  const [cancelled] = await FrankQueueItemRecord.update(
    {
      state: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
    },
    {
      where: {
        dedupeKey,
        ...(queueName ? { queueName } : {}),
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
    if (item.intentId) {
      const control = item.channelId
        ? await FrankChannelControlRecord.findOne({
            where: { channelId: item.channelId },
          })
        : null;
      const intent = await FrankConversationIntentRecord.findByPk(item.intentId);
      const isCurrent =
        !!control &&
        !!intent &&
        control.activeIntentId === item.intentId &&
        ACTIVE_INTENT_STATUSES.includes(intent.status);

      if (!isCurrent) {
        item.state = "cancelled";
        item.leaseOwner = null;
        item.leaseExpiresAt = null;
        await item.save();
        continue;
      }
    }

    item.state = "pending";
    item.leaseOwner = null;
    item.leaseExpiresAt = null;
    item.availableAt = new Date(now);
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

export async function getQueueItemsForChannel(
  channelId: string,
  queueNames?: FrankQueueName[],
) {
  const items = await FrankQueueItemRecord.findAll({
    where: {
      channelId,
      ...(queueNames && queueNames.length > 0
        ? { queueName: { [Op.in]: queueNames } }
        : {}),
      state: { [Op.in]: ACTIVE_QUEUE_STATES },
    },
    order: [["availableAt", "ASC"], ["createdAt", "ASC"]],
  });

  return items.map(toQueueItem);
}

export async function reconcileFrankQueueState() {
  await markLegacyFrankJobsInactive();
  await requeueExpiredLeases(
    ["runtime_update", "settle_channel", "generate_intent", "memory_extraction"],
    new Date(),
  );

  const controls = await FrankChannelControlRecord.findAll();
  for (const record of controls) {
    if (!record.activeIntentId) {
      continue;
    }

    const intent = await FrankConversationIntentRecord.findByPk(record.activeIntentId);
    const queueItems = await FrankQueueItemRecord.count({
      where: {
        intentId: record.activeIntentId,
        state: { [Op.in]: ACTIVE_QUEUE_STATES },
      },
    });

    const canRecoverPendingIntent =
      !!intent && intent.status === "pending" && queueItems > 0;

    if (!canRecoverPendingIntent) {
      if (intent && ACTIVE_INTENT_STATUSES.includes(intent.status)) {
        intent.status = "aborted";
        intent.abortReason = "restart_reconcile";
        await intent.save();
      }
      record.activeIntentId = null;
      record.activeIntentRevision = null;
      record.activeSnapshotId = null;
      record.activeSnapshotCreatedAt = null;
      await record.save();

      if (record.lastSeenEventId && record.pendingSettleAt) {
        await upsertQueueItem(
          "settle_channel",
          {
            guildId: record.guildId,
            channelId: record.channelId,
            sourceEventId: record.lastSeenEventId,
            channelRevision: record.channelRevision,
          },
          {
            dedupeKey: `settle:${record.channelId}`,
            guildId: record.guildId,
            channelId: record.channelId,
            availableAt: new Date(record.pendingSettleAt),
          },
        );
      }
    }
  }
}

export async function supersedeActiveIntent(options: {
  guildId: string;
  channelId: string;
  reason: string;
  nextSettleAt?: Date | null;
}) {
  const control = await getChannelControl(options.guildId, options.channelId);
  if (!control.activeIntentId) {
    if (options.nextSettleAt) {
      await saveChannelControl({
        ...control,
        pendingSettleAt: options.nextSettleAt.toISOString(),
      });
    }
    return null;
  }

  const nextStatus =
    options.reason === "message_deleted" || options.reason === "message_edited"
      ? "invalidated"
      : "superseded";
  await markIntentStatus(control.activeIntentId, nextStatus, options.reason);
  await cancelQueueItemsForIntent(control.activeIntentId);
  await saveChannelControl({
    ...control,
    activeIntentId: null,
    activeIntentRevision: null,
    activeSnapshotId: null,
    activeSnapshotCreatedAt: null,
    pendingSettleAt: options.nextSettleAt?.toISOString() ?? control.pendingSettleAt,
  });

  return control.activeIntentId;
}

export async function getActiveIntentForChannel(
  guildId: string,
  channelId: string,
) {
  const control = await getChannelControl(guildId, channelId);
  if (!control.activeIntentId) {
    return { control, intent: null };
  }

  const intent = await getConversationIntent(control.activeIntentId);
  if (!intent) {
    return { control, intent: null };
  }

  return { control, intent };
}

export function getDefaultQueueLeaseMs(queueName: FrankQueueName) {
  switch (queueName) {
    case "generate_intent":
      return FRANK_CHARACTER_TIMEOUT_MS + 4_000;
    case "memory_extraction":
      return 20_000;
    default:
      return Math.max(4_000, FRANK_JOB_POLL_MS * 20);
  }
}
