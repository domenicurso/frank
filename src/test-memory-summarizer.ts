import { client } from "@/client";
import {
  createMemory,
  getGuildMemories,
  initializeDatabase,
  Memory,
} from "@/database";
import {
  getMemoryStatistics,
  summarizeGuildMemories,
} from "@/utils/memorySummarizer";
import chalk from "chalk";

// Test data
const testGuildId = "test-guild-123";
const testUserId = "test-user-456";

async function createTestMemories(): Promise<void> {
  console.log(chalk.blue("Creating test memories..."));

  const testMemories = [
    {
      key: "favorite_food",
      content:
        "User loves pizza, especially pepperoni with extra cheese. They mentioned ordering from Tony's Pizza every Friday night.",
    },
    {
      key: "gaming_preferences",
      content:
        "Plays mostly FPS games like Valorant and CS2. Mentioned being ranked Diamond in Valorant and wanting to reach Immortal.",
    },
    {
      key: "work_schedule",
      content:
        "Works remote as a software engineer. Usually online between 9 AM - 5 PM EST. Takes lunch around 12:30 PM.",
    },
    {
      key: "pet_info",
      content:
        "Has a golden retriever named Max who is 3 years old. Often talks about taking Max for walks in the park.",
    },
    {
      key: "music_taste",
      content:
        "Listens to indie rock and electronic music. Favorite artists include Tame Impala, ODESZA, and Radiohead.",
    },
    {
      key: "travel_plans",
      content:
        "Planning a trip to Japan next summer. Wants to visit Tokyo, Kyoto, and Osaka. Interested in trying authentic ramen.",
    },
    {
      key: "hobby_photography",
      content:
        "Amateur photographer who enjoys landscape photography. Uses a Canon EOS R5 and often shoots during golden hour.",
    },
    {
      key: "fitness_routine",
      content:
        "Goes to the gym 4 times a week. Focuses on strength training and some cardio. Prefers morning workouts around 7 AM.",
    },
  ];

  for (const memory of testMemories) {
    // Create memories with old timestamps (8 days ago) to trigger summarization
    const createdMemory = await createMemory(
      testUserId,
      testGuildId,
      memory.key,
      memory.content,
    );

    if (createdMemory) {
      // Manually update the timestamp to make it old (8 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 8);

      // Force update the timestamps using raw SQL to bypass Sequelize's auto-update
      const { sequelize } = Memory;
      await sequelize.query(
        'UPDATE memories SET "updatedAt" = ?, "createdAt" = ? WHERE id = ?',
        {
          replacements: [oldDate, oldDate, createdMemory.id],
          type: sequelize.QueryTypes.UPDATE,
        },
      );

      console.log(
        chalk.green(
          `✓ Created memory: ${memory.key} (set to ${oldDate.toLocaleDateString()})`,
        ),
      );
    } else {
      console.log(chalk.red(`✗ Failed to create memory: ${memory.key}`));
    }
  }

  // Debug: Check what timestamps are actually in the database
  console.log(chalk.blue("\nDEBUG: Checking actual database timestamps..."));
  const allMemories = await getGuildMemories(testGuildId);
  for (const memory of allMemories) {
    const age = Date.now() - (memory.updatedAt?.getTime() || 0);
    const daysAgo = Math.floor(age / (24 * 60 * 60 * 1000));
    console.log(
      chalk.gray(
        `${memory.key}: updatedAt=${memory.updatedAt?.toISOString()}, ${daysAgo} days ago`,
      ),
    );
  }
}

async function displayMemories(title: string): Promise<void> {
  console.log(chalk.cyan(`\n${title}`));
  console.log(chalk.cyan("=".repeat(title.length)));

  const memories = await getGuildMemories(testGuildId);

  if (memories.length === 0) {
    console.log(chalk.gray("No memories found."));
    return;
  }

  for (const memory of memories) {
    const isSummary = memory.key.startsWith("summary_");
    const color = isSummary ? chalk.yellow : chalk.white;
    const prefix = isSummary ? "📄 [SUMMARY]" : "📝 [MEMORY]";

    const age = Date.now() - (memory.updatedAt?.getTime() || 0);
    const daysAgo = Math.floor(age / (24 * 60 * 60 * 1000));

    console.log(color(`${prefix} ${memory.key}`));
    console.log(
      color(
        `   Content: ${memory.content.substring(0, 100)}${memory.content.length > 100 ? "..." : ""}`,
      ),
    );
    console.log(
      color(
        `   Updated: ${memory.updatedAt?.toLocaleDateString()} (${daysAgo} days ago)`,
      ),
    );
    console.log();
  }
}

async function displayStatistics(): Promise<void> {
  console.log(chalk.magenta("\nMemory Statistics"));
  console.log(chalk.magenta("=================="));

  const stats = await getMemoryStatistics(testGuildId);

  console.log(`Total Memories: ${stats.totalMemories}`);
  console.log(`Regular Memories: ${stats.regularMemories}`);
  console.log(`Summary Memories: ${stats.summaryMemories}`);
  console.log(`Old Memories: ${stats.oldMemories}`);
  console.log(`Average Content Length: ${stats.avgContentLength} characters`);
}

async function cleanupTestData(): Promise<void> {
  console.log(chalk.blue("\nCleaning up test data..."));

  const memories = await getGuildMemories(testGuildId);
  for (const memory of memories) {
    await Memory.destroy({ where: { id: memory.id } });
  }

  console.log(chalk.green(`✓ Cleaned up ${memories.length} test memories`));
}

async function runTest(): Promise<void> {
  try {
    console.log(chalk.cyan.bold("🧪 Memory Summarizer Test Script"));
    console.log(chalk.cyan.bold("==================================\n"));

    // Initialize database
    console.log(chalk.blue("Initializing database..."));
    await initializeDatabase();
    console.log(chalk.green("✓ Database initialized\n"));

    // Clean up any existing test data
    await cleanupTestData();

    // Create test memories
    await createTestMemories();

    // Display initial state
    await displayMemories("Initial Memories (Before Summarization)");
    await displayStatistics();

    // Run summarization
    console.log(chalk.cyan.bold("\n🔄 Running Memory Summarization"));
    console.log(chalk.cyan.bold("================================="));
    await summarizeGuildMemories(testGuildId);

    // Display results
    await displayMemories("Final Memories (After Summarization)");
    await displayStatistics();

    // Test the statistics function with all guilds
    console.log(chalk.magenta("\nGlobal Statistics"));
    console.log(chalk.magenta("=================="));
    const globalStats = await getMemoryStatistics();
    console.log(`Global Total Memories: ${globalStats.totalMemories}`);
    console.log(`Global Summary Memories: ${globalStats.summaryMemories}`);

    // Clean up
    await cleanupTestData();

    console.log(chalk.green.bold("\n✅ Test completed successfully!"));
  } catch (error) {
    console.error(chalk.red.bold("❌ Test failed:"), error);
  } finally {
    // Exit the process
    process.exit(0);
  }
}

// Mock client for testing (since we don't want to connect to Discord)
if (!client.user) {
  // @ts-ignore - Mock the client for testing
  client.user = { id: "test-bot-id" };
  client.users = {
    fetch: async (userId: string) => ({
      id: userId,
      username: `TestUser${userId.slice(-3)}`,
      displayName: `Test User ${userId.slice(-3)}`,
    }),
  };
  client.guilds = {
    cache: new Map([[testGuildId, { name: "Test Guild", id: testGuildId }]]),
  };
}

// Run the test
if (import.meta.main) {
  runTest();
}

export { cleanupTestData, createTestMemories, runTest };
