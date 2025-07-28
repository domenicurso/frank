import { processScheduledMessages } from "@/database/scheduled";
import { runMemorySummarization } from "@/utils/memorySummarizer";
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
    })
  : new Sequelize(process.env.DATABASE_URL!, {
      dialect: "postgres",
      protocol: "postgres",
      logging: false,
      dialectOptions: {
        ssl: {
          require: true,
          // depending on your host you may need:
          rejectUnauthorized: false,
        },
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

// Scheduled Messages Model
export class ScheduledMessage extends Model {
  declare id: number;
  declare userId: string;
  declare guildId: string;
  declare channelId: string;
  declare targetUserIds: string; // JSON array of user IDs
  declare scheduledTime: Date;
  declare message: string;
  declare sent: boolean;
  declare recurringInterval?: number; // Interval in minutes, null for non-recurring
  declare maxOccurrences?: number; // Max number of times to send, null for infinite
  declare occurrenceCount: number; // How many times it has been sent
  declare createdAt: Date;
  declare updatedAt: Date;
}

ScheduledMessage.init(
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
    channelId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    targetUserIds: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    scheduledTime: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    sent: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    recurringInterval: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Interval in minutes for recurring messages",
    },
    maxOccurrences: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Maximum number of occurrences, null for infinite",
    },
    occurrenceCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: "Number of times this message has been sent",
    },
  },
  {
    sequelize,
    modelName: "ScheduledMessage",
    tableName: "scheduled_messages",
    indexes: [
      {
        fields: ["scheduledTime", "sent"],
      },
      {
        fields: ["guildId"],
      },
    ],
  },
);

// User Stats Model (optional, for future use)
export class UserStats extends Model {
  declare id: number;
  declare userId: string;
  declare guildId: string;
  declare commandsUsed: number;
  declare messagesCount: number;
  declare lastActive: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

UserStats.init(
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
    commandsUsed: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    messagesCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    lastActive: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "UserStats",
    tableName: "user_stats",
    indexes: [
      {
        unique: true,
        fields: ["userId", "guildId"],
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
  declare modChannelId: string | null;
  declare publicModChannelId: string | null;
  declare logBans: boolean;
  declare logKicks: boolean;
  declare logTimeouts: boolean;
  declare logWarnings: boolean;
  declare logChannelLocks: boolean;
  declare logMessageDeletes: boolean;
  declare createdAt?: Date;
  declare updatedAt?: Date;
}

// Memory Model for bot long-term memory
export class Memory extends Model {
  declare id: number;
  declare userId: string;
  declare guildId: string;
  declare key: string;
  declare content: string;
  declare createdAt?: Date;
  declare updatedAt?: Date;
}

GuildConfig.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    guildId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    modChannelId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    publicModChannelId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    logBans: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    logKicks: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    logTimeouts: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    logWarnings: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    logChannelLocks: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    logMessageDeletes: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    sequelize,
    modelName: "GuildConfig",
    tableName: "guild_configs",
    indexes: [
      {
        unique: true,
        fields: ["guildId"],
      },
    ],
  },
);

// Initialize Memory model
Memory.init(
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
    key: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: "Memory",
    tableName: "memories",
    indexes: [
      {
        fields: ["userId", "guildId"],
      },
      {
        fields: ["key"],
      },
      {
        unique: true,
        fields: ["guildId", "key"],
      },
    ],
  },
);

// Utility functions for guild config
export async function getGuildConfig(guildId: string) {
  try {
    let config = await GuildConfig.findOne({
      where: { guildId },
    });

    if (!config) {
      config = await GuildConfig.create({
        guildId,
        modChannelId: null,
        publicModChannelId: null,
        logBans: true,
        logKicks: true,
        logTimeouts: true,
        logWarnings: true,
        logChannelLocks: true,
        logMessageDeletes: true,
      });
    }

    return config;
  } catch (error) {
    console.error(chalk.red("[DB] Error fetching guild config:"), error);
    return null;
  }
}

export async function updateGuildConfig(
  guildId: string,
  updates: Partial<{
    modChannelId: string | null;
    publicModChannelId: string | null;
    logBans: boolean;
    logKicks: boolean;
    logTimeouts: boolean;
    logWarnings: boolean;
    logChannelLocks: boolean;
    logMessageDeletes: boolean;
  }>,
) {
  try {
    const config = await getGuildConfig(guildId);
    if (!config) return null;

    await config.update(updates);
    return config;
  } catch (error) {
    console.error(chalk.red("[DB] Error updating guild config:"), error);
    return null;
  }
}

// Initialize database
export async function initializeDatabase() {
  try {
    await sequelize.authenticate();
    const isDevelopment =
      process.env.NODE_ENV === "development" || !process.env.DATABASE_URL;

    console.log(
      chalk.green(
        `[DB] ${isDevelopment ? "SQLite" : "PostgreSQL"} connection established successfully.`,
      ),
    );

    // Simple sync - create tables if they don't exist, don't alter existing ones
    await sequelize.sync();
    console.log(chalk.green("[DB] Database synchronized successfully."));

    // Clean up expired cooldowns on startup
    await cleanupExpiredCooldowns();

    // Clean up expired locked channels on startup
    await cleanupExpiredLockedChannels();
  } catch (error) {
    console.error(chalk.red("[DB] Unable to connect to the database:"), error);
    throw error;
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

// Check for pending scheduled messages
export async function checkScheduledMessages() {
  try {
    const pendingMessages = await ScheduledMessage.findAll({
      where: {
        scheduledTime: {
          [Op.lte]: new Date(),
        },
        sent: false,
      },
    });

    return pendingMessages;
  } catch (error) {
    console.error(chalk.red("[DB] Error checking scheduled messages:"), error);
    return [];
  }
}

// Mark scheduled message as sent
export async function markMessageAsSent(messageId: number) {
  try {
    await ScheduledMessage.update({ sent: true }, { where: { id: messageId } });
    console.log(chalk.green(`[DB] Marked message ${messageId} as sent.`));
  } catch (error) {
    console.error(chalk.red("[DB] Error marking message as sent:"), error);
  }
}

// Cleanup old sent scheduled messages (older than 30 days)
export async function cleanupOldScheduledMessages() {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deleted = await ScheduledMessage.destroy({
      where: {
        sent: true,
        updatedAt: {
          [Op.lt]: thirtyDaysAgo,
        },
      },
    });

    if (deleted > 0) {
      console.log(
        chalk.green(`[DB] Cleaned up ${deleted} old scheduled messages.`),
      );
    }
  } catch (error) {
    console.error(
      chalk.red("[DB] Error cleaning up old scheduled messages:"),
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

// Memory utility functions
/**
 * Check if a memory key is already taken in a guild
 */
export async function isMemoryKeyTaken(
  guildId: string,
  key: string,
): Promise<boolean> {
  try {
    const existingMemory = await Memory.findOne({
      where: { guildId, key },
    });
    return existingMemory !== null;
  } catch (error) {
    console.error(chalk.red("[DB] Error checking memory key:"), error);
    return false;
  }
}

export async function createMemory(
  userId: string,
  guildId: string,
  key: string,
  content: string,
) {
  try {
    // Check if key already exists in this guild
    const keyTaken = await isMemoryKeyTaken(guildId, key);
    if (keyTaken) {
      console.error(chalk.red("[DB] Memory key already exists in guild:"), key);
      return null;
    }

    // Create new memory
    const memory = await Memory.create({
      userId,
      guildId,
      key,
      content,
    });
    return memory;
  } catch (error) {
    console.error(chalk.red("[DB] Error creating memory:"), error);
    return null;
  }
}

export async function updateMemory(
  userId: string,
  guildId: string,
  key: string,
  content: string,
) {
  try {
    // First try to find existing memory by key in guild
    const existingMemory = await Memory.findOne({
      where: { guildId, key },
    });

    if (existingMemory) {
      // Update existing memory (regardless of who created it)
      existingMemory.content = content;
      existingMemory.userId = userId; // Update the userId to current user
      await existingMemory.save();
      return existingMemory;
    } else {
      // Create new memory if none exists
      const memory = await Memory.create({
        userId,
        guildId,
        key,
        content,
      });
      return memory;
    }
  } catch (error) {
    console.error(chalk.red("[DB] Error updating memory:"), error);
    return null;
  }
}

export async function deleteMemory(
  userId: string,
  guildId: string,
  key: string,
) {
  try {
    const deleted = await Memory.destroy({
      where: { guildId, key },
    });
    return deleted > 0;
  } catch (error) {
    console.error(chalk.red("[DB] Error deleting memory:"), error);
    return false;
  }
}

export async function getAllMemories(userId: string, guildId: string) {
  try {
    const memories = await Memory.findAll({
      where: { userId, guildId },
      order: [["updatedAt", "DESC"]],
    });
    return memories;
  } catch (error) {
    console.error(chalk.red("[DB] Error fetching memories:"), error);
    return [];
  }
}

export async function getGuildMemories(guildId: string) {
  try {
    const memories = await Memory.findAll({
      where: { guildId },
      order: [["updatedAt", "DESC"]],
    });
    return memories;
  } catch (error) {
    console.error(chalk.red("[DB] Error fetching guild memories:"), error);
    return [];
  }
}

// Periodic cleanup (run every 5 minutes)
setInterval(cleanupExpiredCooldowns, 5 * 60 * 1000);

// Cleanup old scheduled messages daily
setInterval(cleanupOldScheduledMessages, 24 * 60 * 60 * 1000);

setTimeout(
  function () {
    setInterval(processScheduledMessages, 60 * 1000);
    setInterval(cleanupExpiredLockedChannels, 60 * 1000);
    processScheduledMessages();
    cleanupExpiredLockedChannels();

    // Start memory summarization scheduler (runs every 3 hours)
    console.log(
      chalk.green(
        "[Memory Summarizer] Scheduler started - will run every 3 hours",
      ),
    );
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

    // Run memory summarization after 30 seconds on startup
    setTimeout(() => {
      runMemorySummarization();
    }, 30 * 1000);

    // Schedule recurring runs every 3 hours
    setInterval(() => {
      runMemorySummarization();
    }, THREE_HOURS_MS);
  },
  (60 - new Date().getSeconds()) * 1000,
);
