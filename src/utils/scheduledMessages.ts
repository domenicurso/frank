import { ScheduledMessage } from "@/database/index";
import chalk from "chalk";
import { Op } from "sequelize";

export interface ScheduledMessageData {
  userId: string;
  guildId: string;
  channelId: string;
  targetUserIds: string[];
  scheduledTime: Date;
  message: string;
}

export async function createScheduledMessage(data: ScheduledMessageData) {
  try {
    const scheduledMessage = await ScheduledMessage.create({
      userId: data.userId,
      guildId: data.guildId,
      channelId: data.channelId,
      targetUserIds: JSON.stringify(data.targetUserIds),
      scheduledTime: data.scheduledTime,
      message: data.message,
      sent: false,
    });

    return scheduledMessage;
  } catch (error) {
    console.error(chalk.red("[DB] Error creating scheduled message:"), error);
    throw error;
  }
}

export async function getUserScheduledMessages(
  userId: string,
  guildId?: string,
) {
  try {
    const where: any = {
      userId,
      sent: false,
    };

    if (guildId) {
      where.guildId = guildId;
    }

    const messages = await ScheduledMessage.findAll({
      where,
      order: [["scheduledTime", "ASC"]],
    });

    return messages.map((msg) => ({
      id: msg.id,
      guildId: msg.guildId,
      channelId: msg.channelId,
      targetUserIds: JSON.parse(msg.targetUserIds),
      scheduledTime: msg.scheduledTime,
      message: msg.message,
      createdAt: msg.createdAt,
    }));
  } catch (error) {
    console.error(
      chalk.red("[DB] Error fetching user scheduled messages:"),
      error,
    );
    return [];
  }
}

export async function cancelScheduledMessage(
  messageId: number,
  userId: string,
) {
  try {
    await ScheduledMessage.destroy({
      where: {
        id: messageId,
        userId, // Only allow users to cancel their own messages
        sent: false,
      },
    });

    return true;
  } catch (error) {
    console.error(chalk.red("[DB] Error cancelling scheduled message:"), error);
    return false;
  }
}

export async function getGuildScheduledMessages(guildId: string) {
  try {
    const messages = await ScheduledMessage.findAll({
      where: {
        guildId,
        sent: false,
      },
      order: [["scheduledTime", "ASC"]],
    });

    return messages.map((msg) => ({
      id: msg.id,
      userId: msg.userId,
      channelId: msg.channelId,
      targetUserIds: JSON.parse(msg.targetUserIds),
      scheduledTime: msg.scheduledTime,
      message: msg.message,
      createdAt: msg.createdAt,
    }));
  } catch (error) {
    console.error(
      chalk.red("[DB] Error fetching guild scheduled messages:"),
      error,
    );
    return [];
  }
}

export async function cleanupOldScheduledMessages(olderThanDays = 30) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const deleted = await ScheduledMessage.destroy({
      where: {
        sent: true,
        updatedAt: {
          [Op.lt]: cutoffDate,
        },
      },
    });

    if (deleted > 0) {
      console.log(
        chalk.green(`[DB] Cleaned up ${deleted} old scheduled messages`),
      );
    }

    return deleted;
  } catch (error) {
    console.error(
      chalk.red("[DB] Error cleaning up old scheduled messages:"),
      error,
    );
    return 0;
  }
}

export function formatScheduledTime(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

export function getTimeUntilScheduled(scheduledTime: Date): string {
  // Get current time in Eastern timezone
  const easternTimeString = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
  });
  const now = new Date(easternTimeString);
  const diff = scheduledTime.getTime() - now.getTime();

  if (diff <= 0) {
    return "Overdue";
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(" ");
}
