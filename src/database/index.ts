import { prepareFrankSchemaForHardCutover } from "@/frank/queueStore";
import { initializeFrankModels } from "@/frank/store";
import chalk from "chalk";
import {
  Client,
  ForumChannel,
  NewsChannel,
  PermissionFlagsBits,
  TextChannel,
  VoiceChannel,
} from "discord.js";
import { DataTypes, Model, Op, Sequelize } from "sequelize";

// Initialize Sequelize with environment-based configuration
const isDevelopment =
  process.env.NODE_ENV === "development" || !process.env.DATABASE_URL;

export const sequelize = isDevelopment
  ? new Sequelize({
      dialect: "sqlite",
      storage: "database.sqlite",
      logging: false,
      pool: {
        max: 1,
        min: 1,
        acquire: 30000,
        idle: 10000,
      },
      retry: {
        max: 5,
      },
    })
  : new Sequelize(process.env.DATABASE_URL!, {
      dialect: "postgres",
      protocol: "postgres",
      logging: false,
      pool: {
        max: 10, // Maximum number of connections in pool
        min: 2, // Minimum number of connections in pool
        acquire: 30000, // Maximum time to try getting connection
        idle: 10000, // Maximum time a connection can be idle
        evict: 1000, // Time between eviction runs
      },
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      },
      retry: {
        max: 3, // Maximum retry attempts
      },
    });

// Store Discord client for auto-unlock functionality
let discordClient: Client | null = null;

// Set the Discord client for database operations
export function setDiscordClient(client: Client) {
  discordClient = client;
}

// Simple Cooldown Model - dead simple approach
export class Cooldown extends Model {
  declare id: number;
  declare cooldownKey: string; // Combined key: "userId:identifier:scope"
  declare expiresAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Cooldown.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    cooldownKey: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true, // Simple unique constraint on the combined key
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: "Cooldown",
    tableName: "cooldowns",
    indexes: [
      {
        fields: ["expiresAt"], // For cleanup queries
      },
    ],
  },
);

// Warning Model
export class Warning extends Model {
  declare id: number;
  declare userId: string;
  declare guildId: string;
  declare moderatorId: string;
  declare reason: string;
  declare timestamp: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

Warning.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    guildId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    moderatorId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "Warning",
    tableName: "warnings",
    indexes: [
      {
        fields: ["userId", "guildId"],
      },
      {
        fields: ["guildId"],
      },
      {
        fields: ["timestamp"],
      },
    ],
  },
);

// Locked Channel Model
export class LockedChannel extends Model {
  declare id: number;
  declare channelId: string;
  declare guildId: string;
  declare lockedBy: string;
  declare reason: string;
  declare lockedAt: Date;
  declare unlockAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

LockedChannel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    channelId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    guildId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    lockedBy: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    lockedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    unlockAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: "LockedChannel",
    tableName: "locked_channels",
    indexes: [
      {
        unique: true,
        fields: ["channelId", "guildId"],
      },
      {
        fields: ["guildId"],
      },
      {
        fields: ["unlockAt"],
      },
    ],
  },
);

// Guild Configuration Model
export class GuildConfig extends Model {
  declare id: number;
  declare guildId: string;
  declare whitelistedChannels: string | null; // JSON array of channel IDs
  declare blacklistedChannels: string | null; // JSON array of channel IDs
  declare cooldownDuration: number; // in seconds
  declare allowedMentions: boolean; // whether AI responds to mentions
  declare allowedReplies: boolean; // whether AI responds to replies
  declare attentionMode: string;
  declare opportunismLevel: number;
  declare reactionsEnabled: boolean;
  declare burstResponsesEnabled: boolean;
  declare maxBurstMessages: number;
  declare createdAt?: Date;
  declare updatedAt?: Date;
}

GuildConfig.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    guildId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    whitelistedChannels: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    blacklistedChannels: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    cooldownDuration: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },

    allowedMentions: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    allowedReplies: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    attentionMode: {
      type: DataTypes.STRING,
      defaultValue: "conversation-aware",
    },
    opportunismLevel: {
      type: DataTypes.INTEGER,
      defaultValue: 15,
    },
    reactionsEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    burstResponsesEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    maxBurstMessages: {
      type: DataTypes.INTEGER,
      defaultValue: 5,
    },
  },
  {
    sequelize,
    modelName: "GuildConfig",
    tableName: "guild_configs",
  },
);

// Utility functions for guild config
export async function getGuildConfig(
  guildId: string,
): Promise<GuildConfig | null> {
  try {
    let config = await GuildConfig.findOne({
      where: { guildId },
    });

    // Create default config if it doesn't exist
    if (!config) {
      config = await GuildConfig.create({
        guildId,
        whitelistedChannels: null,
        blacklistedChannels: null,
        cooldownDuration: 0,
        allowedMentions: true,
        allowedReplies: true,
        attentionMode: "conversation-aware",
        opportunismLevel: 15,
        reactionsEnabled: true,
        burstResponsesEnabled: true,
        maxBurstMessages: 5,
      });
    }

    return config;
  } catch (error) {
    console.error("Error getting guild config:", error);
    return null;
  }
}

export async function updateGuildConfig(
  guildId: string,
  updates: Partial<
    Omit<GuildConfig, "id" | "guildId" | "createdAt" | "updatedAt">
  >,
): Promise<boolean> {
  try {
    const [affectedCount] = await GuildConfig.update(updates, {
      where: { guildId },
    });

    // If no rows were affected, create a new config
    if (affectedCount === 0) {
      await GuildConfig.create({
        guildId,
        whitelistedChannels: null,
        blacklistedChannels: null,
        cooldownDuration: 30,
        allowedMentions: true,
        allowedReplies: true,
        attentionMode: "conversation-aware",
        opportunismLevel: 15,
        reactionsEnabled: true,
        burstResponsesEnabled: true,
        maxBurstMessages: 5,
        ...updates,
      });
    }

    return true;
  } catch (error) {
    console.error("Error updating guild config:", error);
    return false;
  }
}

// Initialize database
export async function initializeDatabase() {
  try {
    initializeFrankModels();
    await sequelize.authenticate();
    const isDevelopment =
      process.env.NODE_ENV === "development" || !process.env.DATABASE_URL;

    console.log(
      chalk.green(
        `[DB] ${isDevelopment ? "SQLite" : "PostgreSQL"} connection established successfully.`,
      ),
    );

    if (isDevelopment) {
      await applyDevelopmentSqlitePragmas();
      await prepareFrankSchemaForHardCutover();
    }

    // Simple sync - create tables if they don't exist
    await sequelize.sync();
    await migrateGuildConfigSchema();
    console.log(chalk.green("[DB] Database synchronized successfully."));

    // Clean up expired cooldowns on startup
    await cleanupExpiredCooldowns();

    // Clean up expired locked channels on startup
    await cleanupExpiredLockedChannels();

    // Start background maintenance tasks
    startBackgroundTasks();
  } catch (error) {
    console.error(chalk.red("[DB] Unable to connect to the database:"), error);
    throw error;
  }
}

async function applyDevelopmentSqlitePragmas() {
  try {
    await sequelize.query("PRAGMA journal_mode = WAL");
    await sequelize.query("PRAGMA synchronous = NORMAL");
    await sequelize.query("PRAGMA busy_timeout = 5000");
  } catch (error) {
    console.error(chalk.yellow("[DB] Failed to apply SQLite pragmas:"), error);
  }
}

async function migrateGuildConfigSchema() {
  const queryInterface = sequelize.getQueryInterface();

  let table;
  try {
    table = await queryInterface.describeTable("guild_configs");
  } catch {
    return;
  }

  const missingColumns = [
    ["attentionMode", { type: DataTypes.STRING, defaultValue: "conversation-aware" }],
    ["opportunismLevel", { type: DataTypes.INTEGER, defaultValue: 15 }],
    ["reactionsEnabled", { type: DataTypes.BOOLEAN, defaultValue: true }],
    ["burstResponsesEnabled", { type: DataTypes.BOOLEAN, defaultValue: true }],
    ["maxBurstMessages", { type: DataTypes.INTEGER, defaultValue: 5 }],
  ] as const;

  for (const [name, definition] of missingColumns) {
    if (!(name in table)) {
      await queryInterface.addColumn("guild_configs", name, definition);
    }
  }
}

// Cleanup expired cooldowns
export async function cleanupExpiredCooldowns() {
  try {
    const deleted = await Cooldown.destroy({
      where: {
        expiresAt: {
          [Op.lt]: new Date(),
        },
      },
    });
    if (deleted > 0) {
      console.log(chalk.green(`[DB] Cleaned up ${deleted} expired cooldowns.`));
    }
  } catch (error) {
    console.error(
      chalk.red("[DB] Error cleaning up expired cooldowns:"),
      error,
    );
  }
}

// Cleanup and auto-unlock expired locked channels
export async function cleanupExpiredLockedChannels() {
  try {
    const now = new Date();
    const expiredLocks = await LockedChannel.findAll({
      where: {
        unlockAt: {
          [Op.lte]: now,
          [Op.not]: null,
        },
      },
    });

    if (expiredLocks.length > 0) {
      console.log(
        chalk.yellow(
          `[DB] Found ${expiredLocks.length} expired channel locks to process.`,
        ),
      );

      for (const lock of expiredLocks) {
        await autoUnlockChannel(lock);
      }
    }
  } catch (error) {
    console.error(
      chalk.red("[DB] Error cleaning up expired locked channels:"),
      error,
    );
  }
}

// Auto-unlock a channel and remove from database
async function autoUnlockChannel(lockInfo: any) {
  try {
    if (!discordClient) {
      console.error(
        chalk.red("[DB] Discord client not available for auto-unlock"),
      );
      return;
    }

    const guild = discordClient.guilds.cache.get(lockInfo.guildId);
    if (!guild) {
      console.error(
        chalk.red(`[DB] Guild ${lockInfo.guildId} not found for auto-unlock`),
      );
      // Remove the lock from database since guild is not accessible
      await LockedChannel.destroy({
        where: { id: lockInfo.id },
      });
      return;
    }

    const channel = guild.channels.cache.get(lockInfo.channelId) as
      | TextChannel
      | VoiceChannel
      | ForumChannel
      | NewsChannel;

    if (!channel) {
      console.error(
        chalk.red(
          `[DB] Channel ${lockInfo.channelId} not found for auto-unlock`,
        ),
      );
      // Remove the lock from database since channel is not accessible
      await LockedChannel.destroy({
        where: { id: lockInfo.id },
      });
      return;
    }

    // Check if bot has permission to manage the channel
    const botMember = await guild.members.fetch(discordClient.user!.id);
    if (
      !channel
        .permissionsFor(botMember)
        ?.has(PermissionFlagsBits.ManageChannels)
    ) {
      console.error(
        chalk.red(
          `[DB] Bot missing permissions to unlock channel ${lockInfo.channelId}`,
        ),
      );
      // Remove the lock from database since we can't unlock it
      await LockedChannel.destroy({
        where: { id: lockInfo.id },
      });
      return;
    }

    // Get the @everyone role
    const everyoneRole = guild.roles.everyone;

    // Unlock the channel by removing the permission overwrites
    await channel.permissionOverwrites.edit(everyoneRole, {
      SendMessages: null,
      AddReactions: null,
      CreatePublicThreads: null,
      CreatePrivateThreads: null,
    });

    // Remove the lock from database
    await LockedChannel.destroy({
      where: { id: lockInfo.id },
    });

    console.log(
      chalk.green(
        `[DB] Auto-unlocked channel ${channel.name} (${lockInfo.channelId})`,
      ),
    );

    // Send a notification to the channel if it supports messages
    if (channel instanceof TextChannel || channel instanceof NewsChannel) {
      try {
        const lockDuration = Date.now() - lockInfo.lockedAt.getTime();
        const formattedDuration = formatLockDuration(lockDuration);

        await channel.send({
          embeds: [
            {
              color: 0x00ff00, // Green
              title: "🔓 Channel Auto-Unlocked",
              description: `This channel was automatically unlocked after ${formattedDuration}.\n**Originally locked by:** <@${lockInfo.lockedBy}>`,
              timestamp: new Date().toISOString(),
            },
          ],
        });
      } catch (error) {
        // Ignore errors sending notification
        console.error(
          chalk.yellow(
            `[DB] Failed to send unlock notification to ${channel.name}`,
          ),
        );
      }
    }
  } catch (error) {
    console.error(chalk.red("[DB] Error auto-unlocking channel:"), error);
    // Remove the problematic lock from database
    try {
      await LockedChannel.destroy({
        where: { id: lockInfo.id },
      });
    } catch (dbError) {
      console.error(
        chalk.red("[DB] Error removing problematic lock:"),
        dbError,
      );
    }
  }
}

// Format lock duration for display
function formatLockDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days !== 1 ? "s" : ""}`;
  } else if (hours > 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  } else {
    return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  }
}

// Get locked channels that need to be unlocked
export async function getExpiredLockedChannels() {
  try {
    const now = new Date();
    const expiredLocks = await LockedChannel.findAll({
      where: {
        unlockAt: {
          [Op.lte]: now,
          [Op.not]: null,
        },
      },
    });
    return expiredLocks;
  } catch (error) {
    console.error(
      chalk.red("[DB] Error fetching expired locked channels:"),
      error,
    );
    return [];
  }
}

// Check if a channel is locked
export async function isChannelLocked(channelId: string, guildId: string) {
  try {
    const lock = await LockedChannel.findOne({
      where: {
        channelId,
        guildId,
      },
    });
    return lock !== null;
  } catch (error) {
    console.error(chalk.red("[DB] Error checking channel lock:"), error);
    return false;
  }
}

// Get all locked channels for a guild
export async function getGuildLockedChannels(guildId: string) {
  try {
    const locks = await LockedChannel.findAll({
      where: {
        guildId,
      },
      order: [["lockedAt", "DESC"]],
    });
    return locks;
  } catch (error) {
    console.error(
      chalk.red("[DB] Error fetching guild locked channels:"),
      error,
    );
    return [];
  }
}

// Remove a channel lock (for manual unlock)
export async function removeChannelLock(channelId: string, guildId: string) {
  try {
    const deleted = await LockedChannel.destroy({
      where: {
        channelId,
        guildId,
      },
    });
    return deleted > 0;
  } catch (error) {
    console.error(chalk.red("[DB] Error removing channel lock:"), error);
    return false;
  }
}

// Store interval IDs for cleanup
let cleanupIntervals: {
  cooldownCleanup?: NodeJS.Timeout;
  channelUnlock?: NodeJS.Timeout;
  initialTimeout?: NodeJS.Timeout;
} = {};

/**
 * Clear all existing intervals to prevent accumulation
 */
function clearExistingIntervals() {
  if (cleanupIntervals.cooldownCleanup) {
    clearInterval(cleanupIntervals.cooldownCleanup);
  }
  if (cleanupIntervals.channelUnlock) {
    clearInterval(cleanupIntervals.channelUnlock);
  }
  if (cleanupIntervals.initialTimeout) {
    clearTimeout(cleanupIntervals.initialTimeout);
  }
  cleanupIntervals = {};
}

/**
 * Start background tasks with proper cleanup
 */
function startBackgroundTasks() {
  // Clear any existing intervals first
  clearExistingIntervals();

  console.log(chalk.blue("[DB] Starting background maintenance tasks..."));

  // Periodic cleanup (run every 5 minutes)
  cleanupIntervals.cooldownCleanup = setInterval(
    cleanupExpiredCooldowns,
    5 * 60 * 1000,
  );

  // Start channel unlocking with proper timing
  cleanupIntervals.initialTimeout = setTimeout(
    function () {
      cleanupIntervals.channelUnlock = setInterval(
        cleanupExpiredLockedChannels,
        60 * 1000,
      );

      // Run initial cleanup
      cleanupExpiredLockedChannels();
    },
    (60 - new Date().getSeconds()) * 1000,
  );
}

/**
 * Stop all background tasks
 */
export function stopBackgroundTasks() {
  console.log(chalk.yellow("[DB] Stopping background maintenance tasks..."));
  clearExistingIntervals();
}

// Export the start function as well
export { startBackgroundTasks };
