import { RED } from "@/constants";
import { Cooldown } from "@/database/index";
import { createEmbed } from "@/utils/embeds";
import { ChatInputCommandInteraction, Message, MessageFlags } from "discord.js";
import { Op } from "sequelize";

export interface CooldownOptions {
  /** Duration in milliseconds */
  duration: number;
  /** Whether to send a cooldown message to the user */
  sendMessage?: boolean;
  /** Custom cooldown message template. Use {timeLeft} for remaining time */
  message?: string;
  /** Whether the cooldown message should be ephemeral (slash commands only) */
  ephemeral?: boolean;
  /** Custom identifier for the cooldown (defaults to command name) */
  identifier?: string;
  /** Cooldown scope - determines who the cooldown affects */
  scope?: "user" | "global" | "guild" | "channel";
}

export interface CooldownResult {
  /** Whether the user is on cooldown */
  onCooldown: boolean;
  /** Remaining time in milliseconds (if on cooldown) */
  timeLeft?: number;
  /** Formatted time left string */
  timeLeftFormatted?: string;
}

export class CooldownManager {
  /**
   * Create a simple key for cooldown storage
   */
  private static createKey(
    userId: string,
    identifier: string,
    scope: string,
    guildId?: string,
    channelId?: string,
  ): string {
    switch (scope) {
      case "user":
        return `user:${userId}:${identifier}`;
      case "global":
        return `global:${identifier}`;
      case "guild":
        return `guild:${guildId || "unknown"}:${identifier}`;
      case "channel":
        return `channel:${channelId || "unknown"}:${identifier}`;
      default:
        return `user:${userId}:${identifier}`;
    }
  }

  /**
   * Check if a cooldown is active
   */
  static async checkCooldown(
    userId: string,
    identifier: string,
    scope: string = "user",
    guildId?: string,
    channelId?: string,
  ): Promise<CooldownResult> {
    try {
      const key = this.createKey(userId, identifier, scope, guildId, channelId);

      const cooldown = await Cooldown.findOne({
        where: { cooldownKey: key },
      });

      if (!cooldown) {
        return { onCooldown: false };
      }

      const now = new Date();
      const expiresAt = new Date(cooldown.expiresAt);

      if (now >= expiresAt) {
        // Cooldown expired, remove it
        await cooldown.destroy();
        return { onCooldown: false };
      }

      const timeLeft = Math.max(0, expiresAt.getTime() - now.getTime());
      const timeLeftFormatted = this.formatTime(timeLeft);

      return {
        onCooldown: true,
        timeLeft,
        timeLeftFormatted,
      };
    } catch (error) {
      console.error("Error checking cooldown:", error);
      // Return false to allow operation if database fails
      return { onCooldown: false };
    }
  }

  /**
   * Set a cooldown
   */
  static async setCooldown(
    userId: string,
    identifier: string,
    duration: number,
    scope: string = "user",
    guildId?: string,
    channelId?: string,
  ): Promise<void> {
    try {
      const key = this.createKey(userId, identifier, scope, guildId, channelId);
      const expiresAt = new Date(Date.now() + duration);

      // Delete existing cooldown if it exists
      await Cooldown.destroy({
        where: { cooldownKey: key },
      });

      // Create new cooldown
      await Cooldown.create({
        cooldownKey: key,
        expiresAt,
      });
    } catch (error) {
      console.error("Error setting cooldown:", error);
      // Don't throw - just log and continue
    }
  }

  /**
   * Remove a cooldown
   */
  static async removeCooldown(
    userId: string,
    identifier: string,
    scope: string = "user",
    guildId?: string,
    channelId?: string,
  ): Promise<boolean> {
    try {
      const key = this.createKey(userId, identifier, scope, guildId, channelId);

      const result = await Cooldown.destroy({
        where: { cooldownKey: key },
      });

      return result > 0;
    } catch (error) {
      console.error("Error removing cooldown:", error);
      return false;
    }
  }

  /**
   * Get all cooldowns for a user
   */
  static async getUserCooldowns(userId: string): Promise<Cooldown[]> {
    try {
      return await Cooldown.findAll({
        where: {
          cooldownKey: {
            [Op.like]: `user:${userId}:%`,
          },
        },
      });
    } catch (error) {
      console.error("Error fetching user cooldowns:", error);
      return [];
    }
  }

  /**
   * Get all cooldowns for a channel
   */
  static async getChannelCooldowns(channelId: string): Promise<Cooldown[]> {
    try {
      return await Cooldown.findAll({
        where: {
          cooldownKey: {
            [Op.like]: `channel:${channelId}:%`,
          },
        },
      });
    } catch (error) {
      console.error("Error fetching channel cooldowns:", error);
      return [];
    }
  }

  /**
   * Get all cooldowns for a guild
   */
  static async getGuildCooldowns(guildId: string): Promise<Cooldown[]> {
    try {
      return await Cooldown.findAll({
        where: {
          cooldownKey: {
            [Op.like]: `guild:${guildId}:%`,
          },
        },
      });
    } catch (error) {
      console.error("Error fetching guild cooldowns:", error);
      return [];
    }
  }

  /**
   * Get all global cooldowns
   */
  static async getGlobalCooldowns(): Promise<Cooldown[]> {
    try {
      return await Cooldown.findAll({
        where: {
          cooldownKey: {
            [Op.like]: `global:%`,
          },
        },
      });
    } catch (error) {
      console.error("Error fetching global cooldowns:", error);
      return [];
    }
  }

  /**
   * Clear all cooldowns for a user
   */
  static async clearUserCooldowns(userId: string): Promise<number> {
    try {
      const deleted = await Cooldown.destroy({
        where: {
          cooldownKey: {
            [Op.like]: `user:${userId}:%`,
          },
        },
      });
      return deleted;
    } catch (error) {
      console.error("Error clearing user cooldowns:", error);
      return 0;
    }
  }

  /**
   * Clear all cooldowns for a channel
   */
  static async clearChannelCooldowns(channelId: string): Promise<number> {
    try {
      const deleted = await Cooldown.destroy({
        where: {
          cooldownKey: {
            [Op.like]: `channel:${channelId}:%`,
          },
        },
      });
      return deleted;
    } catch (error) {
      console.error("Error clearing channel cooldowns:", error);
      return 0;
    }
  }

  /**
   * Clear all cooldowns for a guild
   */
  static async clearGuildCooldowns(guildId: string): Promise<number> {
    try {
      const deleted = await Cooldown.destroy({
        where: {
          cooldownKey: {
            [Op.like]: `guild:${guildId}:%`,
          },
        },
      });
      return deleted;
    } catch (error) {
      console.error("Error clearing guild cooldowns:", error);
      return 0;
    }
  }

  /**
   * Clear all global cooldowns
   */
  static async clearGlobalCooldowns(): Promise<number> {
    try {
      const deleted = await Cooldown.destroy({
        where: {
          cooldownKey: {
            [Op.like]: `global:%`,
          },
        },
      });
      return deleted;
    } catch (error) {
      console.error("Error clearing global cooldowns:", error);
      return 0;
    }
  }

  /**
   * Format milliseconds into a human-readable time string
   */
  static formatTime(ms: number): string {
    if (isNaN(ms) || ms < 0) {
      return "0s";
    }

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Parse duration strings like "5s", "10m", "1h", "2d" into milliseconds
   */
  static parseDuration(duration: string): number {
    // Map units to milliseconds
    const unitToMs: Record<string, number> = {
      d: 24 * 60 * 60 * 1000,
      h: 60 * 60 * 1000,
      m: 60 * 1000,
      s: 1000,
    };

    const regex = /(\d+)([dhms])/g;
    let totalMs = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(duration))) {
      const value = parseInt(match[1] || "0", 10);
      const unit = match[2] || 0;
      const ms = unitToMs[unit];
      if (ms) {
        totalMs += value * ms;
      }
    }

    return totalMs;
  }

  /**
   * Extract context information from interaction or message
   */
  static extractContext(interactionOrMessage: any): {
    userId: string;
    guildId?: string;
    channelId?: string;
  } {
    if (interactionOrMessage.user) {
      // ChatInputCommandInteraction
      return {
        userId: interactionOrMessage.user.id,
        guildId: interactionOrMessage.guildId,
        channelId: interactionOrMessage.channelId,
      };
    } else if (interactionOrMessage.author) {
      // Message
      return {
        userId: interactionOrMessage.author.id,
        guildId: interactionOrMessage.guildId,
        channelId: interactionOrMessage.channelId,
      };
    } else {
      // Fallback
      return {
        userId: "unknown",
      };
    }
  }

  /**
   * Helper methods for specific scopes
   */
  static async checkUserCooldown(
    userId: string,
    identifier: string,
  ): Promise<CooldownResult> {
    return this.checkCooldown(userId, identifier, "user");
  }

  static async setUserCooldown(
    userId: string,
    identifier: string,
    duration: number,
  ): Promise<void> {
    return this.setCooldown(userId, identifier, duration, "user");
  }

  static async checkGlobalCooldown(
    identifier: string,
  ): Promise<CooldownResult> {
    return this.checkCooldown("global", identifier, "global");
  }

  static async setGlobalCooldown(
    identifier: string,
    duration: number,
  ): Promise<void> {
    return this.setCooldown("global", identifier, duration, "global");
  }

  static async checkGuildCooldown(
    guildId: string,
    identifier: string,
  ): Promise<CooldownResult> {
    return this.checkCooldown("guild", identifier, "guild", guildId);
  }

  static async setGuildCooldown(
    guildId: string,
    identifier: string,
    duration: number,
  ): Promise<void> {
    return this.setCooldown("guild", identifier, duration, "guild", guildId);
  }

  static async checkChannelCooldown(
    channelId: string,
    identifier: string,
  ): Promise<CooldownResult> {
    return this.checkCooldown(
      "channel",
      identifier,
      "channel",
      undefined,
      channelId,
    );
  }

  static async setChannelCooldown(
    channelId: string,
    identifier: string,
    duration: number,
  ): Promise<void> {
    return this.setCooldown(
      "channel",
      identifier,
      duration,
      "channel",
      undefined,
      channelId,
    );
  }
}

/**
 * Apply cooldown to a function
 */
export async function applyCooldown<T extends any[]>(
  fn: (...args: T) => Promise<any>,
  options: CooldownOptions,
  ...args: T
): Promise<any> {
  const [interactionOrMessage] = args;
  const context = CooldownManager.extractContext(interactionOrMessage);
  const scope = options.scope || "user";
  const identifier =
    options.identifier ||
    (interactionOrMessage instanceof ChatInputCommandInteraction
      ? interactionOrMessage.commandName
      : "event");

  // Check cooldown
  const cooldownResult = await CooldownManager.checkCooldown(
    context.userId,
    identifier,
    scope,
    context.guildId,
    context.channelId,
  );

  if (cooldownResult.onCooldown) {
    if (options.sendMessage !== false) {
      const message =
        options.message?.replace(
          "{timeLeft}",
          cooldownResult.timeLeftFormatted || "unknown",
        ) ||
        `You're on cooldown! Try again in **${cooldownResult.timeLeftFormatted}**.`;

      if (interactionOrMessage instanceof ChatInputCommandInteraction) {
        await interactionOrMessage.reply({
          embeds: [createEmbed(RED, "Cooldown Active", message)],
          flags:
            options.ephemeral !== false ? MessageFlags.Ephemeral : undefined,
        });
      } else if (interactionOrMessage instanceof Message) {
        await interactionOrMessage.reply(message);
      }
    }
    return;
  }

  // Set cooldown before executing
  await CooldownManager.setCooldown(
    context.userId,
    identifier,
    options.duration,
    scope,
    context.guildId,
    context.channelId,
  );

  // Execute function
  return fn(...args);
}
