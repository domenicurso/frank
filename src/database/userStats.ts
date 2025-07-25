import { UserStats } from "@/database/index";
import chalk from "chalk";

/**
 * Get or create user stats for a specific user in a guild
 */
export async function getOrCreateUserStats(
  userId: string,
  guildId: string,
): Promise<UserStats> {
  try {
    const [userStats] = await UserStats.findOrCreate({
      where: { userId, guildId },
      defaults: {
        userId,
        guildId,
        commandsUsed: 0,
        messagesCount: 0,
        lastActive: new Date(),
      },
    });
    return userStats;
  } catch (error) {
    console.error(chalk.red("[DB] Error getting/creating user stats:"), error);
    throw error;
  }
}

/**
 * Update user stats when a command is used
 */
export async function trackCommandUsage(
  userId: string,
  guildId: string,
): Promise<void> {
  try {
    const [userStats, created] = await UserStats.findOrCreate({
      where: { userId, guildId },
      defaults: {
        userId,
        guildId,
        commandsUsed: 1,
        messagesCount: 0,
        lastActive: new Date(),
      },
    });

    if (!created) {
      // User exists, increment command count and update lastActive
      await userStats.increment("commandsUsed", { by: 1 });
      await userStats.update({ lastActive: new Date() });
    }
  } catch (error) {
    console.error(chalk.red("[DB] Error tracking command usage:"), error);
    // Don't throw - we don't want command execution to fail due to stats tracking
  }
}

/**
 * Update user stats when a message is sent
 */
export async function trackMessageSent(
  userId: string,
  guildId: string,
): Promise<void> {
  try {
    const [userStats, created] = await UserStats.findOrCreate({
      where: { userId, guildId },
      defaults: {
        userId,
        guildId,
        commandsUsed: 0,
        messagesCount: 1,
        lastActive: new Date(),
      },
    });

    if (!created) {
      // User exists, increment message count and update lastActive
      await userStats.increment("messagesCount", { by: 1 });
      await userStats.update({ lastActive: new Date() });
    }
  } catch (error) {
    console.error(chalk.red("[DB] Error tracking message sent:"), error);
    // Don't throw - we don't want message handling to fail due to stats tracking
  }
}

/**
 * Update user stats when a message is deleted
 */
export async function trackMessageDeleted(
  userId: string,
  guildId: string,
): Promise<void> {
  try {
    const userStats = await UserStats.findOne({
      where: { userId, guildId },
    });

    if (userStats && userStats.messagesCount > 0) {
      // Decrement message count and update lastActive
      await userStats.decrement("messagesCount", { by: 1 });
      await userStats.update({ lastActive: new Date() });
    }
  } catch (error) {
    console.error(chalk.red("[DB] Error tracking message deleted:"), error);
    // Don't throw - we don't want message handling to fail due to stats tracking
  }
}

/**
 * Get user stats for a specific user in a guild
 */
export async function getUserStats(
  userId: string,
  guildId: string,
): Promise<UserStats | null> {
  try {
    return await UserStats.findOne({
      where: { userId, guildId },
    });
  } catch (error) {
    console.error(chalk.red("[DB] Error getting user stats:"), error);
    return null;
  }
}

/**
 * Get top users by command usage in a guild
 */
export async function getTopCommandUsers(
  guildId: string,
  limit: number = 10,
): Promise<UserStats[]> {
  try {
    return await UserStats.findAll({
      where: { guildId },
      order: [["commandsUsed", "DESC"]],
      limit,
    });
  } catch (error) {
    console.error(chalk.red("[DB] Error getting top command users:"), error);
    return [];
  }
}

/**
 * Get top users by message count in a guild
 */
export async function getTopMessageUsers(
  guildId: string,
  limit: number = 10,
): Promise<UserStats[]> {
  try {
    return await UserStats.findAll({
      where: { guildId },
      order: [["messagesCount", "DESC"]],
      limit,
    });
  } catch (error) {
    console.error(chalk.red("[DB] Error getting top message users:"), error);
    return [];
  }
}

/**
 * Get recently active users in a guild sorted by lastActive
 */
export async function getRecentlyActiveUsers(
  guildId: string,
  limit: number = 20,
): Promise<UserStats[]> {
  try {
    return await UserStats.findAll({
      where: { guildId },
      order: [["lastActive", "DESC"]],
      limit,
    });
  } catch (error) {
    console.error(
      chalk.red("[DB] Error getting recently active users:"),
      error,
    );
    return [];
  }
}

/**
 * Get total stats for a guild
 */
export async function getGuildStats(guildId: string): Promise<{
  totalUsers: number;
  totalCommands: number;
  totalMessages: number;
}> {
  try {
    const stats = await UserStats.findAll({
      where: { guildId },
      attributes: [
        [
          UserStats.sequelize!.fn("COUNT", UserStats.sequelize!.col("id")),
          "totalUsers",
        ],
        [
          UserStats.sequelize!.fn(
            "SUM",
            UserStats.sequelize!.col("commandsUsed"),
          ),
          "totalCommands",
        ],
        [
          UserStats.sequelize!.fn(
            "SUM",
            UserStats.sequelize!.col("messagesCount"),
          ),
          "totalMessages",
        ],
      ],
      raw: true,
    });

    const result = stats[0] as any;
    return {
      totalUsers: parseInt(result.totalUsers) || 0,
      totalCommands: parseInt(result.totalCommands) || 0,
      totalMessages: parseInt(result.totalMessages) || 0,
    };
  } catch (error) {
    console.error(chalk.red("[DB] Error getting guild stats:"), error);
    return {
      totalUsers: 0,
      totalCommands: 0,
      totalMessages: 0,
    };
  }
}
