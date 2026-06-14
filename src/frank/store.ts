import { sequelize } from "@/database";
import { FRANK_DUE_JOB_SCAN_LIMIT } from "@/frank/constants";
import { frankDebug } from "@/frank/debug";
import { parseJson, stringifyJson } from "@/frank/json";
import type {
  ChannelRuntimeProjection,
  FrankJobPayload,
  FrankJobType,
  MemoryCategory,
  MemoryEvidence,
  MemoryProfile,
  MemorySubjectType,
  PersistedEvent,
} from "@/frank/types";
import { DataTypes, Model, Op } from "sequelize";

const DEFAULT_RUNTIME = (
  guildId: string,
  channelId: string,
): ChannelRuntimeProjection => ({
  guildId,
  channelId,
  visibleMessages: [],
  recentEventIds: [],
  activeSnapshotId: null,
  activeJobId: null,
  lastBotMessageId: null,
  lastBotSentAt: null,
  lastMentionAt: null,
  pendingIntent: null,
  lastResponseEventId: null,
  lastHumanMessageAt: null,
});

export class FrankEventRecord extends Model {
  declare id: number;
  declare eventKey: string;
  declare eventType: string;
  declare guildId: string | null;
  declare channelId: string | null;
  declare messageId: string | null;
  declare authorId: string | null;
  declare eventTimestamp: Date;
  declare payload: string;
}

export class FrankJobRecord extends Model {
  declare id: number;
  declare jobType: FrankJobType;
  declare queueKey: string | null;
  declare guildId: string | null;
  declare channelId: string | null;
  declare payload: string;
  declare status: "pending" | "running" | "completed" | "failed";
  declare attempts: number;
  declare runAt: Date;
  declare lockedAt: Date | null;
  declare lastError: string | null;
}

export class FrankChannelRuntimeRecord extends Model {
  declare id: number;
  declare guildId: string;
  declare channelId: string;
  declare state: string;
}

export class FrankMemoryProfileRecord extends Model {
  declare id: number;
  declare guildId: string;
  declare subjectType: MemorySubjectType;
  declare subjectId: string;
  declare displayName: string;
  declare summary: string;
  declare profile: string;
  declare updatedAt: Date;
}

export class FrankMemoryEvidenceRecord extends Model {
  declare id: number;
  declare guildId: string;
  declare subjectType: MemorySubjectType;
  declare subjectId: string;
  declare category: MemoryCategory;
  declare memoryKey: string;
  declare content: string;
  declare confidence: number;
  declare salience: number;
  declare pinned: boolean;
  declare suppressed: boolean;
  declare sourceEventId: string | null;
  declare lastObservedAt: Date;
}

let initialized = false;

function isSqliteBusyError(error: unknown) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.includes("SQLITE_BUSY") || message.includes("database is locked");
}

async function withSqliteRetry<T>(
  operation: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSqliteBusyError(error) || index === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (index + 1)));
    }
  }

  throw lastError;
}

export function initializeFrankModels() {
  if (initialized) return;
  initialized = true;

  FrankEventRecord.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      eventKey: { type: DataTypes.STRING, allowNull: false, unique: true },
      eventType: { type: DataTypes.STRING, allowNull: false },
      guildId: { type: DataTypes.STRING, allowNull: true },
      channelId: { type: DataTypes.STRING, allowNull: true },
      messageId: { type: DataTypes.STRING, allowNull: true },
      authorId: { type: DataTypes.STRING, allowNull: true },
      eventTimestamp: { type: DataTypes.DATE, allowNull: false },
      payload: { type: DataTypes.TEXT, allowNull: false },
    },
    {
      sequelize,
      modelName: "FrankEventRecord",
      tableName: "frank_event_records",
      indexes: [
        { unique: true, fields: ["eventKey"] },
        { fields: ["channelId", "eventTimestamp"] },
        { fields: ["guildId", "eventTimestamp"] },
      ],
    },
  );

  FrankJobRecord.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      jobType: { type: DataTypes.STRING, allowNull: false },
      queueKey: { type: DataTypes.STRING, allowNull: true },
      guildId: { type: DataTypes.STRING, allowNull: true },
      channelId: { type: DataTypes.STRING, allowNull: true },
      payload: { type: DataTypes.TEXT, allowNull: false },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pending",
      },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      runAt: { type: DataTypes.DATE, allowNull: false },
      lockedAt: { type: DataTypes.DATE, allowNull: true },
      lastError: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: "FrankJobRecord",
      tableName: "frank_job_records",
      indexes: [
        { fields: ["status", "runAt"] },
        { fields: ["queueKey", "status"] },
      ],
    },
  );

  FrankChannelRuntimeRecord.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      guildId: { type: DataTypes.STRING, allowNull: false },
      channelId: { type: DataTypes.STRING, allowNull: false, unique: true },
      state: { type: DataTypes.TEXT, allowNull: false },
    },
    {
      sequelize,
      modelName: "FrankChannelRuntimeRecord",
      tableName: "frank_channel_runtime_records",
      indexes: [{ unique: true, fields: ["channelId"] }],
    },
  );

  FrankMemoryProfileRecord.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      guildId: { type: DataTypes.STRING, allowNull: false },
      subjectType: { type: DataTypes.STRING, allowNull: false },
      subjectId: { type: DataTypes.STRING, allowNull: false },
      displayName: { type: DataTypes.STRING, allowNull: false },
      summary: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
      profile: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: stringifyJson({}),
      },
    },
    {
      sequelize,
      modelName: "FrankMemoryProfileRecord",
      tableName: "frank_memory_profile_records",
      indexes: [
        { unique: true, fields: ["guildId", "subjectType", "subjectId"] },
      ],
    },
  );

  FrankMemoryEvidenceRecord.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      guildId: { type: DataTypes.STRING, allowNull: false },
      subjectType: { type: DataTypes.STRING, allowNull: false },
      subjectId: { type: DataTypes.STRING, allowNull: false },
      category: { type: DataTypes.STRING, allowNull: false },
      memoryKey: { type: DataTypes.STRING, allowNull: false },
      content: { type: DataTypes.TEXT, allowNull: false },
      confidence: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0.5 },
      salience: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0.5 },
      pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      suppressed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      sourceEventId: { type: DataTypes.STRING, allowNull: true },
      lastObservedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "FrankMemoryEvidenceRecord",
      tableName: "frank_memory_evidence_records",
      indexes: [
        { fields: ["guildId", "subjectType", "subjectId", "suppressed"] },
        { fields: ["memoryKey"] },
      ],
    },
  );
}

export async function appendFrankEvent(event: PersistedEvent): Promise<string> {
  const eventTimestamp =
    "createdAt" in event
      ? event.createdAt
      : "editedAt" in event
        ? event.editedAt
        : "deletedAt" in event
          ? event.deletedAt
          : new Date().toISOString();

  const record = await withSqliteRetry(async () => {
    const existing = await FrankEventRecord.findOne({
      where: { eventKey: event.eventKey },
    });
    if (existing) return existing;

    try {
      return await FrankEventRecord.create({
        eventKey: event.eventKey,
        eventType: event.type,
        guildId: "guildId" in event ? event.guildId : null,
        channelId: "channelId" in event ? event.channelId : null,
        messageId: "messageId" in event ? event.messageId : null,
        authorId: "authorId" in event ? event.authorId : null,
        eventTimestamp: new Date(eventTimestamp),
        payload: stringifyJson(event),
      });
    } catch (error) {
      const racedExisting = await FrankEventRecord.findOne({
        where: { eventKey: event.eventKey },
      });
      if (racedExisting) return racedExisting;
      throw error;
    }
  });

  frankDebug("store", "append_event", {
    eventId: String(record.id),
    eventKey: event.eventKey,
    eventType: event.type,
    guildId: "guildId" in event ? event.guildId : null,
    channelId: "channelId" in event ? event.channelId : null,
  });

  return String(record.id);
}

export async function getFrankEventById(id: string): Promise<PersistedEvent | null> {
  const record = await FrankEventRecord.findByPk(id);
  if (!record) return null;
  return parseJson<PersistedEvent | null>(record.payload, null);
}

export async function listFrankEventsForChannel(
  channelId: string,
  limit: number,
): Promise<PersistedEvent[]> {
  const records = await FrankEventRecord.findAll({
    where: { channelId },
    order: [["eventTimestamp", "DESC"]],
    limit,
  });

  return records
    .reverse()
    .map((record) => parseJson<PersistedEvent | null>(record.payload, null))
    .filter((event): event is PersistedEvent => event !== null);
}

export async function enqueueFrankJob(
  jobType: FrankJobType,
  payload: FrankJobPayload,
  options: {
    queueKey?: string;
    guildId?: string | null;
    channelId?: string | null;
    runAt?: Date;
  } = {},
) {
  const runAt = options.runAt ?? new Date();
  const pendingMatches =
    options.queueKey
      ? await withSqliteRetry(() =>
          FrankJobRecord.findAll({
            where: {
              queueKey: options.queueKey,
              jobType,
              status: "pending",
            },
            order: [["runAt", "DESC"], ["id", "DESC"]],
          }),
        )
      : [];
  const [existing, ...stalePending] = pendingMatches;

  if (stalePending.length > 0) {
    await withSqliteRetry(() =>
      FrankJobRecord.destroy({
        where: {
          id: {
            [Op.in]: stalePending.map((job) => job.id),
          },
        },
      }),
    );
    frankDebug("store", "enqueue_job.pruned_duplicates", {
      jobType,
      queueKey: options.queueKey ?? null,
      prunedJobIds: stalePending.map((job) => job.id),
    });
  }

  if (existing) {
    existing.payload = stringifyJson(payload);
    existing.runAt = runAt;
    await withSqliteRetry(() => existing.save());
    frankDebug("store", "enqueue_job.updated", {
      jobId: existing.id,
      jobType,
      queueKey: options.queueKey ?? null,
      guildId: options.guildId ?? null,
      channelId: options.channelId ?? null,
      runAt: runAt.toISOString(),
    });
    return existing;
  }

  const created = await withSqliteRetry(() =>
    FrankJobRecord.create({
      jobType,
      queueKey: options.queueKey ?? null,
      guildId: options.guildId ?? null,
      channelId: options.channelId ?? null,
      payload: stringifyJson(payload),
      runAt,
    }),
  );

  frankDebug("store", "enqueue_job.created", {
    jobId: created.id,
    jobType,
    queueKey: options.queueKey ?? null,
    guildId: options.guildId ?? null,
    channelId: options.channelId ?? null,
    runAt: runAt.toISOString(),
  });

  return created;
}

export async function claimFrankJobs(limit: number): Promise<FrankJobRecord[]> {
  return claimFrankJobsByType(limit, null);
}

export async function claimFrankJobsByType(
  limit: number,
  jobTypes: FrankJobType[] | null,
): Promise<FrankJobRecord[]> {
  const jobPriority: Record<FrankJobType, number> = {
    runtime_update: 0,
    response_decision: 1,
    character_generation: 2,
    memory_extraction: 3,
  };

  const dueJobs = await FrankJobRecord.findAll({
    where: {
      status: "pending",
      runAt: { [Op.lte]: new Date() },
      ...(jobTypes && jobTypes.length > 0
        ? { jobType: { [Op.in]: jobTypes } }
        : {}),
    },
    order: [["runAt", "ASC"]],
    limit: Math.max(limit, FRANK_DUE_JOB_SCAN_LIMIT),
  });

  dueJobs.sort((left, right) => {
    const priorityDelta =
      jobPriority[left.jobType] - jobPriority[right.jobType];
    if (priorityDelta !== 0) return priorityDelta;
    return left.runAt.getTime() - right.runAt.getTime();
  });

  const claimed: FrankJobRecord[] = [];

  for (const job of dueJobs) {
    if (claimed.length >= limit) break;

    const [affected] = await FrankJobRecord.update(
      {
        status: "running",
        lockedAt: new Date(),
        attempts: job.attempts + 1,
      },
      {
        where: {
          id: job.id,
          status: "pending",
        },
      },
    );

    if (affected > 0) {
      job.status = "running";
      job.lockedAt = new Date();
      job.attempts += 1;
      claimed.push(job);
    }
  }

  if (claimed.length > 0) {
    frankDebug("store", "claim_jobs", {
      count: claimed.length,
      jobs: claimed.map((job) => ({
        id: job.id,
        type: job.jobType,
        channelId: job.channelId,
        guildId: job.guildId,
      })),
    });
  }

  return claimed;
}

export async function releaseStaleFrankJobs(
  jobTypes: FrankJobType[],
  staleMs: number,
) {
  const cutoff = new Date(Date.now() - staleMs);
  const [released] = await FrankJobRecord.update(
    {
      status: "pending",
      lockedAt: null,
      lastError: "Released stale running job lock",
      runAt: new Date(),
    },
    {
      where: {
        status: "running",
        lockedAt: {
          [Op.lte]: cutoff,
        },
        jobType: {
          [Op.in]: jobTypes,
        },
      },
    },
  );

  if (released > 0) {
    frankDebug("store", "release_stale_jobs", {
      jobTypes,
      released,
      staleMs,
    });
  }

  return released;
}

export function getFrankJobPayload<T extends FrankJobPayload>(job: FrankJobRecord): T {
  return parseJson<T>(job.payload, {} as T);
}

export async function completeFrankJob(jobId: number) {
  await FrankJobRecord.update(
    {
      status: "completed",
      lockedAt: null,
    },
    {
      where: { id: jobId },
    },
  );
}

export async function failFrankJob(
  jobId: number,
  error: unknown,
  retryDelayMs = 2_500,
) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  await FrankJobRecord.update(
    {
      status: "pending",
      lockedAt: null,
      lastError: message,
      runAt: new Date(Date.now() + retryDelayMs),
    },
    {
      where: { id: jobId },
    },
  );
}

export async function getChannelRuntime(
  guildId: string,
  channelId: string,
): Promise<ChannelRuntimeProjection> {
  const record = await withSqliteRetry(async () => {
    const existing = await FrankChannelRuntimeRecord.findOne({
      where: { channelId },
    });
    if (existing) return existing;

    return FrankChannelRuntimeRecord.create({
      guildId,
      channelId,
      state: stringifyJson(DEFAULT_RUNTIME(guildId, channelId)),
    });
  });

  return parseJson<ChannelRuntimeProjection>(
    record.state,
    DEFAULT_RUNTIME(guildId, channelId),
  );
}

export async function saveChannelRuntime(runtime: ChannelRuntimeProjection) {
  await withSqliteRetry(() =>
    FrankChannelRuntimeRecord.upsert({
      guildId: runtime.guildId,
      channelId: runtime.channelId,
      state: stringifyJson(runtime),
    }),
  );
}

export async function upsertMemoryEvidence(
  evidence: Omit<MemoryEvidence, "id">,
) {
  const existing = await FrankMemoryEvidenceRecord.findOne({
    where: {
      guildId: evidence.guildId,
      subjectType: evidence.subjectType,
      subjectId: evidence.subjectId,
      memoryKey: evidence.key,
      suppressed: false,
    },
  });

  if (existing) {
    existing.content = evidence.content;
    existing.category = evidence.category;
    existing.confidence = Math.max(existing.confidence, evidence.confidence);
    existing.salience = Math.max(existing.salience * 0.85, evidence.salience);
    existing.pinned = existing.pinned || evidence.pinned;
    existing.sourceEventId = evidence.sourceEventId;
    existing.lastObservedAt = new Date(evidence.lastObservedAt);
    await existing.save();
    return existing;
  }

  return FrankMemoryEvidenceRecord.create({
    guildId: evidence.guildId,
    subjectType: evidence.subjectType,
    subjectId: evidence.subjectId,
    category: evidence.category,
    memoryKey: evidence.key,
    content: evidence.content,
    confidence: evidence.confidence,
    salience: evidence.salience,
    pinned: evidence.pinned,
    suppressed: evidence.suppressed,
    sourceEventId: evidence.sourceEventId,
    lastObservedAt: new Date(evidence.lastObservedAt),
  });
}

export async function listMemoryEvidence(
  guildId: string,
  subjectType: MemorySubjectType,
  subjectId: string,
) {
  return FrankMemoryEvidenceRecord.findAll({
    where: {
      guildId,
      subjectType,
      subjectId,
    },
    order: [
      ["pinned", "DESC"],
      ["salience", "DESC"],
      ["lastObservedAt", "DESC"],
    ],
  });
}

export async function upsertMemoryProfile(profile: MemoryProfile) {
  await FrankMemoryProfileRecord.upsert({
    guildId: profile.guildId,
    subjectType: profile.subjectType,
    subjectId: profile.subjectId,
    displayName: profile.displayName,
    summary: profile.summary,
    profile: stringifyJson(profile.profile),
  });
}

export async function getMemoryProfile(
  guildId: string,
  subjectType: MemorySubjectType,
  subjectId: string,
): Promise<MemoryProfile | null> {
  const record = await FrankMemoryProfileRecord.findOne({
    where: { guildId, subjectType, subjectId },
  });
  if (!record) return null;

  const evidenceRecords = await listMemoryEvidence(guildId, subjectType, subjectId);
  const topEvidence = evidenceRecords
    .filter((item) => !item.suppressed)
    .slice(0, 6)
    .map(mapEvidenceRecord);

  return {
    guildId,
    subjectType,
    subjectId,
    displayName: record.displayName,
    summary: record.summary,
    profile: parseJson(record.profile, {} as MemoryProfile["profile"]),
    topEvidence,
    updatedAt: record.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function listProfilesForUsers(
  guildId: string,
  userIds: string[],
): Promise<MemoryProfile[]> {
  if (userIds.length === 0) return [];

  const records = await FrankMemoryProfileRecord.findAll({
    where: {
      guildId,
      subjectType: "user",
      subjectId: { [Op.in]: userIds },
    },
    limit: 6,
  });

  const profiles = await Promise.all(
    records.map((record) =>
      getMemoryProfile(guildId, record.subjectType, record.subjectId),
    ),
  );

  return profiles.filter(Boolean) as MemoryProfile[];
}

export async function setMemoryEvidenceState(
  id: string,
  action: "pin" | "suppress",
) {
  const evidence = await FrankMemoryEvidenceRecord.findByPk(id);
  if (!evidence) return null;

  if (action === "pin") {
    evidence.pinned = true;
  } else {
    evidence.suppressed = true;
  }

  await evidence.save();
  return evidence;
}

export async function correctMemoryEvidence(id: string, content: string) {
  const evidence = await FrankMemoryEvidenceRecord.findByPk(id);
  if (!evidence) return null;
  evidence.content = content;
  evidence.pinned = true;
  evidence.suppressed = false;
  evidence.salience = Math.max(0.85, evidence.salience);
  evidence.lastObservedAt = new Date();
  await evidence.save();
  return evidence;
}

function mapEvidenceRecord(record: FrankMemoryEvidenceRecord): MemoryEvidence {
  return {
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
  };
}
