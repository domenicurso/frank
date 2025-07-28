import { client } from "@/client";
import { createMemory, deleteMemory, Memory } from "@/database";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import chalk from "chalk";
import { Op } from "sequelize";

// Configure OpenRouter with API key
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

interface MemoryChunk {
  guildId: string;
  memories: Memory[];
  timeRange: string;
  userGroup: string;
}

/**
 * Get memories that are older than the threshold and need summarization
 */
async function getMemoriesForSummarization(
  guildId: string,
  hoursOld: number = 8,
): Promise<Memory[]> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hoursOld);

    const oldMemories = await Memory.findAll({
      where: {
        guildId,
        updatedAt: {
          [Op.lt]: cutoffDate,
        },
        // Don't summarize memories that are already summaries
        key: {
          [Op.notLike]: "summary_%",
        },
      },
      order: [["updatedAt", "ASC"]],
    });

    return oldMemories;
  } catch (error) {
    console.error(
      chalk.red("[Memory Summarizer] Error fetching old memories:"),
      error,
    );
    return [];
  }
}

/**
 * Group memories into logical chunks for summarization
 */
function chunkMemories(memories: Memory[]): MemoryChunk[] {
  const chunks: MemoryChunk[] = [];
  const memoryGroups = new Map<string, Memory[]>();

  // Group by user first
  for (const memory of memories) {
    const key = memory.userId;
    if (!memoryGroups.has(key)) {
      memoryGroups.set(key, []);
    }
    memoryGroups.get(key)!.push(memory);
  }

  // Create chunks from user groups, splitting large groups by time
  for (const [userId, userMemories] of memoryGroups.entries()) {
    if (userMemories.length <= 3) {
      // Small groups - keep as single chunk
      chunks.push({
        guildId: userMemories[0]!.guildId,
        memories: userMemories,
        timeRange: getTimeRange(userMemories),
        userGroup: userId,
      });
    } else {
      // Large groups - split into chunks of 8-10 memories
      const chunkSize = 8;
      for (let i = 0; i < userMemories.length; i += chunkSize) {
        const chunkMemories = userMemories.slice(i, i + chunkSize);
        chunks.push({
          guildId: chunkMemories[0]!.guildId,
          memories: chunkMemories,
          timeRange: getTimeRange(chunkMemories),
          userGroup: userId,
        });
      }
    }
  }

  return chunks.filter((chunk) => chunk.memories.length >= 2); // Only summarize if 2+ memories
}

/**
 * Get time range string for a group of memories
 */
function getTimeRange(memories: Memory[]): string {
  const dates = memories.map((m) => m.updatedAt || m.createdAt).filter(Boolean);
  if (dates.length === 0) return "unknown";

  const earliest = new Date(Math.min(...dates.map((d) => d!.getTime())));
  const latest = new Date(Math.max(...dates.map((d) => d!.getTime())));

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year:
        earliest.getFullYear() !== latest.getFullYear() ? "numeric" : undefined,
    });
  };

  if (earliest.toDateString() === latest.toDateString()) {
    return formatDate(earliest);
  }

  return `${formatDate(earliest)} - ${formatDate(latest)}`;
}

/**
 * Summarize a chunk of memories using AI
 */
async function summarizeMemoryChunk(chunk: MemoryChunk): Promise<{
  summaryKey: string;
  summaryContent: string;
} | null> {
  try {
    // Get user information for context
    let userName = "Unknown User";
    try {
      if (chunk.userGroup !== "mixed") {
        const user = await client.users.fetch(chunk.userGroup);
        userName = user.username;
      }
    } catch {
      // Fallback to user ID if can't fetch
      userName =
        chunk.userGroup === "mixed"
          ? "Multiple Users"
          : `User ${chunk.userGroup.slice(-4)}`;
    }

    // Prepare memories for summarization
    const memoryTexts = chunk.memories
      .map((m) => `Key: ${m.key}\nContent: ${m.content}`)
      .join("\n\n");

    const systemPrompt = `You are a memory consolidation system for a Discord bot. Your job is to summarize multiple related memories into a single, comprehensive memory that preserves all important information while being more concise.

Guidelines:
- Preserve all key facts, relationships, and context
- Merge related information together logically
- Keep the tone conversational and natural
- Don't lose important details or nuances
- If memories conflict, note the discrepancy
- Maintain the same level of detail for important information
- Use clear, organized structure when helpful

The summary should be comprehensive enough that the original memories can be safely deleted.`;

    const userPrompt = `Please summarize these ${chunk.memories.length} memories for ${userName} from ${chunk.timeRange}:

${memoryTexts}

Create a comprehensive summary that captures all the important information from these memories. The summary will replace these individual memories.`;

    const { text } = await generateText({
      model: openrouter("google/gemini-2.5-flash"),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: 1000,
      temperature: 0.3, // Lower temperature for more consistent summaries
    });

    if (!text || text.trim().length === 0) {
      throw new Error("Empty summary generated");
    }

    // Generate a descriptive key for the summary
    const summaryKey = `summary-${userName.toLowerCase().replace(/[^a-z0-9]/g, "_")}-${chunk.timeRange.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

    return {
      summaryKey,
      summaryContent: text.trim(),
    };
  } catch (error) {
    console.error(
      chalk.red("[Memory Summarizer] Error summarizing chunk:"),
      error,
    );
    return null;
  }
}

/**
 * Replace a chunk of memories with a summary
 */
async function replaceWithSummary(
  chunk: MemoryChunk,
  summaryKey: string,
  summaryContent: string,
): Promise<boolean> {
  try {
    // Create the summary memory
    const summaryMemory = await createMemory(
      chunk.userGroup,
      chunk.guildId,
      summaryKey,
      summaryContent,
    );

    if (!summaryMemory) {
      console.error(
        chalk.red("[Memory Summarizer] Failed to create summary memory"),
      );
      return false;
    }

    // Delete the original memories
    let deletedCount = 0;
    for (const memory of chunk.memories) {
      const deleted = await deleteMemory(
        memory.userId,
        memory.guildId,
        memory.key,
      );
      if (deleted) {
        deletedCount++;
      }
    }

    console.log(
      chalk.green(
        `[Memory Summarizer] Created summary "${summaryKey}" and deleted ${deletedCount}/${chunk.memories.length} original memories`,
      ),
    );

    return deletedCount === chunk.memories.length;
  } catch (error) {
    console.error(
      chalk.red("[Memory Summarizer] Error replacing memories with summary:"),
      error,
    );
    return false;
  }
}

/**
 * Main function to run memory summarization for a specific guild
 */
export async function summarizeGuildMemories(guildId: string): Promise<void> {
  try {
    console.log(
      chalk.blue(
        `[Memory Summarizer] Starting summarization for guild ${guildId}`,
      ),
    );

    // Get memories that need summarization (older than 8 hours)
    const oldMemories = await getMemoriesForSummarization(guildId, 8);

    if (oldMemories.length < 2) {
      console.log(
        chalk.gray(
          `[Memory Summarizer] Not enough old memories to summarize (${oldMemories.length})`,
        ),
      );
      return;
    }

    console.log(
      chalk.blue(
        `[Memory Summarizer] Found ${oldMemories.length} memories to potentially summarize`,
      ),
    );

    // Chunk memories into logical groups
    const chunks = chunkMemories(oldMemories);

    if (chunks.length === 0) {
      console.log(
        chalk.gray(`[Memory Summarizer] No suitable chunks for summarization`),
      );
      return;
    }

    console.log(
      chalk.blue(
        `[Memory Summarizer] Created ${chunks.length} chunks for summarization`,
      ),
    );

    let successCount = 0;
    let totalMemoriesProcessed = 0;

    // Process each chunk
    for (const chunk of chunks) {
      console.log(
        chalk.blue(
          `[Memory Summarizer] Processing chunk: ${chunk.memories.length} memories from ${chunk.timeRange}`,
        ),
      );

      const summary = await summarizeMemoryChunk(chunk);
      if (!summary) {
        console.error(
          chalk.red(`[Memory Summarizer] Failed to summarize chunk`),
        );
        continue;
      }

      const success = await replaceWithSummary(
        chunk,
        summary.summaryKey,
        summary.summaryContent,
      );
      if (success) {
        successCount++;
        totalMemoriesProcessed += chunk.memories.length;
      }

      // Small delay between chunks to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log(
      chalk.green(
        `[Memory Summarizer] Completed: ${successCount}/${chunks.length} chunks successfully summarized, ${totalMemoriesProcessed} memories condensed`,
      ),
    );
  } catch (error) {
    console.error(
      chalk.red("[Memory Summarizer] Error in guild summarization:"),
      error,
    );
  }
}

/**
 * Run memory summarization for all guilds
 */
export async function runMemorySummarization(): Promise<void> {
  try {
    console.log(
      chalk.cyan("[Memory Summarizer] Starting memory summarization process"),
    );

    if (!client.user) {
      console.error(chalk.red("[Memory Summarizer] Discord client not ready"));
      return;
    }

    // Get all guilds the bot is in
    const guilds = client.guilds.cache;
    console.log(
      chalk.blue(`[Memory Summarizer] Processing ${guilds.size} guilds`),
    );

    for (const [guildId, guild] of guilds) {
      console.log(
        chalk.blue(
          `[Memory Summarizer] Processing guild: ${guild.name} (${guildId})`,
        ),
      );
      await summarizeGuildMemories(guildId);

      // Delay between guilds to be respectful
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(
      chalk.cyan("[Memory Summarizer] Memory summarization process completed"),
    );
  } catch (error) {
    console.error(
      chalk.red("[Memory Summarizer] Error in memory summarization:"),
      error,
    );
  }
}

/**
 * Get memory statistics for monitoring
 */
export async function getMemoryStatistics(guildId?: string): Promise<{
  totalMemories: number;
  summaryMemories: number;
  regularMemories: number;
  oldMemories: number;
  memoryByGuild: Record<string, number>;
  avgContentLength: number;
}> {
  try {
    const whereClause = guildId ? { guildId } : {};

    const allMemories = await Memory.findAll({
      where: whereClause,
      attributes: ["guildId", "key", "content", "updatedAt", "createdAt"],
    });

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);

    const stats = {
      totalMemories: allMemories.length,
      summaryMemories: 0,
      regularMemories: 0,
      oldMemories: 0,
      memoryByGuild: {} as Record<string, number>,
      avgContentLength: 0,
    };

    let totalContentLength = 0;

    for (const memory of allMemories) {
      // Count by type
      if (memory.key.startsWith("summary_")) {
        stats.summaryMemories++;
      } else {
        stats.regularMemories++;
      }

      // Count old memories
      const memoryDate = memory.updatedAt || memory.createdAt;
      if (memoryDate && memoryDate < cutoffDate) {
        stats.oldMemories++;
      }

      // Count by guild
      if (!stats.memoryByGuild[memory.guildId]) {
        stats.memoryByGuild[memory.guildId] = 0;
      }
      stats.memoryByGuild[memory.guildId]++;

      // Calculate content length
      totalContentLength += memory.content.length;
    }

    stats.avgContentLength =
      stats.totalMemories > 0
        ? Math.round(totalContentLength / stats.totalMemories)
        : 0;

    return stats;
  } catch (error) {
    console.error(
      chalk.red("[Memory Summarizer] Error getting memory statistics:"),
      error,
    );
    return {
      totalMemories: 0,
      summaryMemories: 0,
      regularMemories: 0,
      oldMemories: 0,
      memoryByGuild: {},
      avgContentLength: 0,
    };
  }
}
