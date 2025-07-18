#!/usr/bin/env bun
import { UserStats, initializeDatabase } from "@/database/index";
import chalk from "chalk";

/**
 * Bulk update user message counts
 * @param userData Array of [userId, messageCount] pairs
 * @param guildId The guild ID to update stats for
 */
async function updateMessageCounts(
  userData: [string, number][],
  guildId: string,
): Promise<void> {
  console.log(
    chalk.blue(
      `[SCRIPT] Starting bulk update for ${userData.length} users in guild ${guildId}`,
    ),
  );

  let successCount = 0;
  let errorCount = 0;

  for (const [userId, messageCount] of userData) {
    try {
      // Validate inputs
      if (!userId || typeof userId !== "string") {
        console.error(chalk.red(`[SCRIPT] Invalid userId: ${userId}`));
        errorCount++;
        continue;
      }

      if (typeof messageCount !== "number" || messageCount < 0) {
        console.error(
          chalk.red(
            `[SCRIPT] Invalid message count for user ${userId}: ${messageCount}`,
          ),
        );
        errorCount++;
        continue;
      }

      // Find or create user stats
      const [userStats, created] = await UserStats.findOrCreate({
        where: { userId, guildId },
        defaults: {
          userId,
          guildId,
          commandsUsed: 0,
          messagesCount: messageCount,
          lastActive: new Date(),
        },
      });

      if (!created) {
        // Update existing user's message count
        await userStats.update({
          messagesCount: messageCount,
          lastActive: new Date(),
        });
        console.log(
          chalk.green(
            `[SCRIPT] Updated user ${userId}: ${userStats.messagesCount} -> ${messageCount} messages`,
          ),
        );
      } else {
        console.log(
          chalk.green(
            `[SCRIPT] Created new user ${userId} with ${messageCount} messages`,
          ),
        );
      }

      successCount++;
    } catch (error) {
      console.error(
        chalk.red(`[SCRIPT] Error updating user ${userId}:`),
        error,
      );
      errorCount++;
    }
  }

  console.log(chalk.blue(`[SCRIPT] Bulk update completed:`));
  console.log(chalk.green(`  ✅ Successfully updated: ${successCount} users`));
  if (errorCount > 0) {
    console.log(chalk.red(`  ❌ Errors: ${errorCount} users`));
  }
}

/**
 * Main script execution
 */
async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    console.log(chalk.green("[SCRIPT] Database initialized"));

    // Replace with your guild ID
    const guildId = process.env.GUILD_ID || "";

    // Uncomment and modify this section to use your actual data:
    const userData: [string, number][] = [
      // Add your [userId, messageCount] pairs here
      ["904173998437441538", 3889],
      ["1108513363979403355", 2604],
      ["1164686378056028270", 1293],
      ["1134870427135651970", 1257],
      ["766033923137732658", 1377],
      ["712380405923184811", 413],
      ["387776395918704640", 24],
      ["616594708319305749", 136],
      ["821746178914779156", 131],
    ];

    await updateMessageCounts(userData, guildId);

    // For now, show example usage
    console.log(chalk.yellow("\n[SCRIPT] Example usage:"));
    console.log(
      chalk.yellow("1. Replace 'YOUR_GUILD_ID_HERE' with your actual guild ID"),
    );
    console.log(
      chalk.yellow("2. Replace exampleData with your actual user data"),
    );
    console.log(
      chalk.yellow("3. Uncomment the userData section and add your data"),
    );
    console.log(chalk.yellow("\nExample data format:"));
    console.log(chalk.cyan("const userData: [string, number][] = ["));
    console.log(chalk.cyan('  ["123456789012345678", 150],'));
    console.log(chalk.cyan('  ["987654321098765432", 75],'));
    console.log(chalk.cyan('  ["456789012345678901", 200]'));
    console.log(chalk.cyan("];"));

    console.log(
      chalk.yellow("\nTo run with example data, uncomment the line below:"),
    );
    console.log(
      chalk.gray("// await updateMessageCounts(exampleData, guildId);"),
    );
  } catch (error) {
    console.error(chalk.red("[SCRIPT] Fatal error:"), error);
    process.exit(1);
  }
}

// Helper function to validate input data format
export function validateUserData(data: any[]): data is [string, number][] {
  return data.every(
    (item) =>
      Array.isArray(item) &&
      item.length === 2 &&
      typeof item[0] === "string" &&
      typeof item[1] === "number" &&
      item[1] >= 0,
  );
}

// Export the main function for potential reuse
export { updateMessageCounts };

// Run the script if called directly
if (import.meta.main) {
  main().catch(console.error);
}
