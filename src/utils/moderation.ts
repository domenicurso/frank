import { BLUE, GREEN, RED, YELLOW } from "@/constants";
import { getGuildConfig } from "@/database";
import { createEmbed } from "@/utils/embeds";
import {
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  TextChannel,
  User,
} from "discord.js";

export interface ModLogData {
  action: string;
  target: User | GuildMember;
  moderator?: User | GuildMember;
  reason?: string;
  duration?: string;
  additional?: Record<string, string | number | boolean>;
  color?: number;
}

export interface PublicNotificationData {
  action: string;
  target?: User | GuildMember;
  moderator?: User | GuildMember;
  message: string;
  color?: number;
}

/**
 * Send a mod log to the configured private mod channel
 */
export async function sendModLog(
  client: Client,
  guild: Guild,
  data: ModLogData,
): Promise<boolean> {
  try {
    const config = await getGuildConfig(guild.id);
    if (!config || !config.modChannelId) {
      return false;
    }

    const modChannel = guild.channels.cache.get(
      config.modChannelId,
    ) as TextChannel;
    if (!modChannel) {
      return false;
    }

    // Check if bot can send messages
    const botMember = guild.members.cache.get(client.user!.id);
    if (
      !botMember ||
      !modChannel.permissionsFor(botMember)?.has(["SendMessages", "EmbedLinks"])
    ) {
      return false;
    }

    const embed = createModLogEmbed(data);
    await modChannel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    console.error("[ModLog] Error sending mod log:", error);
    return false;
  }
}

/**
 * Send a public notification to the configured public mod channel
 */
export async function sendPublicNotification(
  client: Client,
  guild: Guild,
  data: PublicNotificationData,
): Promise<boolean> {
  try {
    const config = await getGuildConfig(guild.id);
    if (!config || !config.publicModChannelId) {
      return false;
    }

    const publicChannel = guild.channels.cache.get(
      config.publicModChannelId,
    ) as TextChannel;
    if (!publicChannel) {
      return false;
    }

    // Check if bot can send messages
    const botMember = guild.members.cache.get(client.user!.id);
    if (
      !botMember ||
      !publicChannel
        .permissionsFor(botMember)
        ?.has(["SendMessages", "EmbedLinks"])
    ) {
      return false;
    }

    const embed = createPublicNotificationEmbed(data);
    await publicChannel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    console.error("[ModLog] Error sending public notification:", error);
    return false;
  }
}

/**
 * Check if logging is enabled for a specific action
 */
export async function isLoggingEnabled(
  guildId: string,
  action:
    | "bans"
    | "kicks"
    | "timeouts"
    | "warnings"
    | "channel_locks"
    | "message_deletes",
): Promise<boolean> {
  try {
    const config = await getGuildConfig(guildId);
    if (!config) return false;

    switch (action) {
      case "bans":
        return config.logBans;
      case "kicks":
        return config.logKicks;
      case "timeouts":
        return config.logTimeouts;
      case "warnings":
        return config.logWarnings;
      case "channel_locks":
        return config.logChannelLocks;
      case "message_deletes":
        return config.logMessageDeletes;
      default:
        return false;
    }
  } catch (error) {
    console.error("[ModLog] Error checking logging config:", error);
    return false;
  }
}

/**
 * Create a detailed mod log embed
 */
function createModLogEmbed(data: ModLogData): EmbedBuilder {
  const color = data.color || getActionColor(data.action);
  const target = data.target;
  const moderator = data.moderator;

  let description = `**Action:** ${data.action}\n`;
  description += `**Target:** ${target.toString()} (${target instanceof User ? target.tag : target.user.tag})\n`;
  description += `**Target ID:** ${target.id}\n`;
  if (data.moderator) {
    description += `**Moderator:** ${moderator!.toString()} (${moderator instanceof User ? moderator.tag : moderator!.user.tag})\n`;
  }

  if (data.reason) {
    description += `**Reason:** ${data.reason}\n`;
  }

  if (data.duration) {
    description += `**Duration:** ${data.duration}\n`;
  }

  if (data.additional) {
    for (const [key, value] of Object.entries(data.additional)) {
      const formattedKey = key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase());
      description += `**${formattedKey}:** ${value}\n`;
    }
  }

  description += `**Timestamp:** <t:${Math.floor(Date.now() / 1000)}:F>`;

  return createEmbed(
    color,
    `Moderation Log - ${data.action}`,
    description,
  ).setFooter({ text: `Case ID: ${Date.now()}` });
}

/**
 * Create a public notification embed
 */
function createPublicNotificationEmbed(
  data: PublicNotificationData,
): EmbedBuilder {
  const color = data.color || getActionColor(data.action);

  let description = data.message;

  if (data.target && data.moderator) {
    description += `\n\n**Target:** ${data.target.toString()}\n`;
    description += `**Moderator:** ${data.moderator.toString()}`;
  }

  return createEmbed(color, data.action, description);
}

/**
 * Get appropriate color for different mod actions
 */
function getActionColor(action: string): number {
  const lowerAction = action.toLowerCase();

  if (lowerAction.includes("ban") || lowerAction.includes("kick")) {
    return RED;
  } else if (
    lowerAction.includes("timeout") ||
    lowerAction.includes("warn") ||
    lowerAction.includes("lock")
  ) {
    return YELLOW;
  } else if (
    lowerAction.includes("unban") ||
    lowerAction.includes("untimeout") ||
    lowerAction.includes("unlock")
  ) {
    return GREEN;
  } else {
    return BLUE;
  }
}

/**
 * Send both mod log and public notification if configured
 */
export async function logModerationAction(
  client: Client,
  guild: Guild,
  action:
    | "bans"
    | "kicks"
    | "timeouts"
    | "warnings"
    | "channel_locks"
    | "message_deletes",
  modLogData: ModLogData,
  publicNotificationData?: PublicNotificationData,
): Promise<{ modLogSent: boolean; publicNotificationSent: boolean }> {
  const loggingEnabled = await isLoggingEnabled(guild.id, action);

  let modLogSent = false;
  let publicNotificationSent = false;

  if (loggingEnabled) {
    modLogSent = await sendModLog(client, guild, modLogData);
  }

  if (publicNotificationData) {
    publicNotificationSent = await sendPublicNotification(
      client,
      guild,
      publicNotificationData,
    );
  }

  return { modLogSent, publicNotificationSent };
}

/**
 * Format duration from milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
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

/**
 * Send a DM to a user with error handling
 */
export async function sendUserDM(
  user: User,
  embed: EmbedBuilder,
): Promise<boolean> {
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch (error) {
    // User has DMs disabled or blocked bot
    return false;
  }
}

/**
 * Create a standardized DM embed for moderation actions
 */
export function createModerationDMEmbed(
  action: string,
  guildName: string,
  moderator: User | GuildMember,
  reason: string,
  additional?: Record<string, string>,
): EmbedBuilder {
  const color = getActionColor(action);
  const moderatorTag =
    moderator instanceof User ? moderator.tag : moderator.user.tag;

  let description = `**Server:** ${guildName}\n`;
  description += `**Action:** ${action}\n`;
  description += `**Reason:** ${reason}\n`;
  description += `**Moderator:** ${moderatorTag}`;

  if (additional) {
    for (const [key, value] of Object.entries(additional)) {
      const formattedKey = key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase());
      description += `\n**${formattedKey}:** ${value}`;
    }
  }

  return createEmbed(color, `${action} - ${guildName}`, description);
}
