import { client } from "@/client";
import { GREEN, RED, YELLOW } from "@/constants";
import {
  createMemory,
  deleteMemory,
  getGuildMemories,
  Memory,
  ScheduledMessage,
  updateMemory,
} from "@/database";
import { getRecentlyActiveUsers } from "@/database/userStats";
import { buildSystemPrompt } from "@/prompts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, tool, type CoreMessage } from "ai";
import type { Message, TextChannel } from "discord.js";
import { z } from "zod";
import { createEmbed } from "./embeds";
import {
  formatScheduleInterval,
  parseScheduleInterval,
  parseScheduleTime,
} from "./scheduleHelpers";

// Configure OpenRouter with API key
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

/**
 * Generates AI response using conversation context and user mentions
 */
export async function generateAIResponse(message: Message): Promise<string> {
  // Fetch the last 15 messages for context
  const messages = await message.channel.messages.fetch({ limit: 15 });

  // Get recently active users from user stats instead of just from recent messages
  const recentActiveUsers = await getRecentlyActiveUsers(
    message.guildId || "",
    20,
  );
  const recentUsers: [string, string, string][] = [];
  const processedMessages: string[] = [];

  // Build a map of all users we might encounter
  const userMap = new Map<string, { username: string; displayName: string }>();

  // Add users from recent messages first
  for (const msg of messages.values()) {
    userMap.set(msg.author.id, {
      username: msg.author.username,
      displayName: msg.author.displayName,
    });

    // Also add mentioned users
    for (const [userId, user] of msg.mentions.users) {
      userMap.set(userId, {
        username: user.username,
        displayName: user.displayName,
      });
    }
  }

  // Convert to recentUsers format, prioritizing recently active users
  for (const stats of recentActiveUsers) {
    const userData = userMap.get(stats.userId);
    if (userData && !recentUsers.some(([id]) => id === stats.userId)) {
      recentUsers.push([stats.userId, userData.username, userData.displayName]);
    }
  }

  // Add any remaining users from recent messages
  for (const [userId, userData] of userMap) {
    if (!recentUsers.some(([id]) => id === userId)) {
      recentUsers.push([userId, userData.username, userData.displayName]);
    }
  }

  for (const msg of Array.from(messages.values()).reverse()) {
    // Replace mentions with usernames
    let processedContent = msg.content;
    for (const [userId, user] of msg.mentions.users) {
      processedContent = processedContent.replace(
        new RegExp(`<@!?${userId}>`, "g"),
        `@${user.username}`,
      );
    }

    // Check if this message is a reply
    let replyContext = "";
    if (msg.reference && msg.reference.messageId) {
      try {
        const repliedMessage = await message.channel.messages.fetch(
          msg.reference.messageId,
        );
        if (repliedMessage) {
          // Truncate the replied message content if it's too long
          const repliedContent =
            repliedMessage.content.length > 80
              ? repliedMessage.content.substring(0, 80) + "..."
              : repliedMessage.content;
          replyContext = ` (replying to @${repliedMessage.author.username}: "${repliedContent}")`;
        }
      } catch (error) {
        // If we can't fetch the replied message, just indicate it's a reply
        replyContext = " (replying to a message)";
      }
    }

    processedMessages.push(
      `@${msg.author.username} said: ${processedContent}${replyContext}`,
    );
  }

  const messageHistory = processedMessages.join("\n");
  const pingableUsers = recentUsers
    .filter(
      ([_id, username, _displayName]) => username !== client.user?.username,
    )
    .slice(0, 10); // Limit to recent users

  // Fetch memories for this guild (limit to recent 20)
  const memories = await getGuildMemories(message.guildId || "");
  const recentMemories = memories.slice(0, 20);

  const memoryContext =
    recentMemories.length > 0
      ? `Your long-term memories:
      ${recentMemories
        .map((m: Memory) => {
          // Try to find username from recent users, fallback to user ID
          const user = recentUsers.find(([id]) => id === m.userId);
          const userDisplay = user ? `@${user[1]}` : `User(${m.userId})`;
          return `- ${userDisplay}: ${m.key} = ${m.content}`;
        })
        .join("\n")}`
      : "No long-term memories available.";

  const promptMessages: CoreMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(pingableUsers, memoryContext),
    },
    {
      role: "user",
      content: `The recent conversation is as follows:\n\n${messageHistory}\n\nPlease respond to the latest message from @${message.author.username}.`,
    },
  ];

  // Generate AI response using OpenRouter with memory tools
  const userId = message.author.id;
  const guildId = message.guildId || "";

  const tools = {
    create_memory: tool({
      description: "Store a new memory about a user or conversation",
      parameters: z.object({
        key: z.string().describe("Unique identifier for this memory"),
        content: z
          .string()
          .describe(
            "The memory content to store, including any relevant context",
          ),
      }),
      execute: async ({ key, content }) => {
        try {
          const memory = await createMemory(userId, guildId, key, content);
          if (memory) {
            // Send embed notification to target channel
            try {
              const guild = message.guild;
              if (guild) {
                const targetChannel = guild.channels.cache.find(
                  (channel) => channel.name === "blasphemy",
                );

                if (targetChannel && targetChannel.isTextBased()) {
                  const embed = createEmbed(YELLOW, "Memory Created", content);

                  await (targetChannel as TextChannel).send({
                    embeds: [embed],
                  });
                }
              }
            } catch (embedError) {
              console.error("Error sending memory create embed:", embedError);
            }

            return `Memory created: ${key} = ${content}`;
          }
          return "Failed to create memory";
        } catch (error) {
          console.error("Error creating memory:", error);
          return "Failed to create memory";
        }
      },
    }),

    update_memory: tool({
      description: "Update an existing memory or create it if it doesn't exist",
      parameters: z.object({
        key: z
          .string()
          .describe("The unique identifier of the memory to update"),
        content: z
          .string()
          .describe("The new memory content, including any relevant context"),
      }),
      execute: async ({ key, content }) => {
        try {
          const memory = await updateMemory(userId, guildId, key, content);
          if (memory) {
            // Send embed notification to target channel
            try {
              const guild = message.guild;
              if (guild) {
                const targetChannel = guild.channels.cache.find(
                  (channel) => channel.name === "blasphemy",
                );

                if (targetChannel && targetChannel.isTextBased()) {
                  const embed = createEmbed(YELLOW, "Memory Updated", content);

                  await (targetChannel as TextChannel).send({
                    embeds: [embed],
                  });
                }
              }
            } catch (embedError) {
              console.error("Error sending memory update embed:", embedError);
            }

            return `Memory updated: ${key} = ${content}`;
          }
          return "Failed to update memory";
        } catch (error) {
          console.error("Error updating memory:", error);
          return "Failed to update memory";
        }
      },
    }),

    delete_memory: tool({
      description:
        "Delete a specific memory when information is no longer relevant",
      parameters: z.object({
        key: z
          .string()
          .describe("The unique identifier of the memory to delete"),
      }),
      execute: async ({ key }) => {
        try {
          const deleted = await deleteMemory(userId, guildId, key);
          if (deleted) {
            // Send embed notification to target channel
            try {
              const guild = message.guild;
              if (guild) {
                const targetChannel = guild.channels.cache.find(
                  (channel) => channel.name === "blasphemy",
                );

                if (targetChannel && targetChannel.isTextBased()) {
                  const embed = createEmbed(
                    RED,
                    "Memory Deleted",
                    `<@${userId}> deleted a memory`,
                  );

                  await (targetChannel as TextChannel).send({
                    embeds: [embed],
                  });
                }
              }
            } catch (embedError) {
              console.error("Error sending memory delete embed:", embedError);
            }

            return `Memory deleted: ${key}`;
          }
          return "Memory not found or failed to delete";
        } catch (error) {
          console.error("Error deleting memory:", error);
          return "Memory not found or failed to delete";
        }
      },
    }),

    schedule_message: tool({
      description:
        "Schedule a message to be sent at a specific time, optionally recurring",
      parameters: z.object({
        time: z
          .string()
          .describe(
            "When to send the message (e.g., '2:30 PM', 'tomorrow 3pm', '2024-12-25 15:00')",
          ),
        message: z.string().describe("The message content to send"),
        users: z
          .string()
          .optional()
          .describe("User mentions to ping (e.g., '@username1 @username2')"),
        interval: z
          .string()
          .optional()
          .describe("Recurring interval (e.g., '30m', '2h', '1d', '1w')"),
        max_occurrences: z
          .number()
          .optional()
          .describe(
            "Maximum number of times to send (leave empty for infinite)",
          ),
      }),
      execute: async ({
        time,
        message: messageContent,
        users,
        interval,
        max_occurrences,
      }) => {
        try {
          // Parse time
          const scheduledTime = parseScheduleTime(time);
          if (!scheduledTime) {
            return "Invalid time format. Try formats like: '2:30 PM', 'tomorrow 3pm', '2024-12-25 15:00'";
          }

          // Check if time is in the past
          if (scheduledTime <= new Date()) {
            return "Cannot schedule a message for a time in the past. Please choose a future time.";
          }

          // Parse users
          const targetUserIds: string[] = [];
          if (users) {
            const userMentions = users.match(/<@!?(\d+)>/g) || [];
            for (const mention of userMentions) {
              const userId = mention.replace(/<@!?(\d+)>/, "$1");
              targetUserIds.push(userId);
            }
          }

          // Parse interval if provided
          let recurringInterval: number | null = null;
          if (interval) {
            recurringInterval = parseScheduleInterval(interval);
            if (!recurringInterval) {
              return "Invalid interval format. Try formats like: '30m', '2h', '1d', '1w'";
            }
          }

          // Create scheduled message
          await ScheduledMessage.create({
            userId,
            guildId,
            channelId: message.channel.id,
            targetUserIds: JSON.stringify(targetUserIds),
            scheduledTime,
            message: messageContent,
            sent: false,
            recurringInterval,
            maxOccurrences: max_occurrences,
            occurrenceCount: 0,
          });

          // Send embed notification to target channel
          try {
            const guild = message.guild;
            if (guild) {
              const targetChannel = guild.channels.cache.find(
                (channel) => channel.name === "blasphemy",
              );

              if (targetChannel && targetChannel.isTextBased()) {
                const formattedTime = scheduledTime.toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "America/New_York",
                  timeZoneName: "short",
                });

                let recurringText = "";
                if (recurringInterval) {
                  const intervalText =
                    formatScheduleInterval(recurringInterval);
                  const occurrenceText = max_occurrences
                    ? ` (max ${max_occurrences} times)`
                    : " (infinite)";
                  recurringText = `\nRecurring: Every ${intervalText}${occurrenceText}`;
                }

                const embed = createEmbed(
                  GREEN,
                  "Message Scheduled",
                  `**Time:** ${formattedTime}\n**Users:** ${targetUserIds.map((id) => `<@${id}>`).join(", ") || "None"}${recurringText}\n**Message:** "${messageContent}"`,
                );

                await (targetChannel as TextChannel).send({
                  embeds: [embed],
                });
              }
            }
          } catch (embedError) {
            console.error("Error sending schedule embed:", embedError);
          }

          const formattedTime = scheduledTime.toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
            timeZoneName: "short",
          });

          let responseText = `Message scheduled for ${formattedTime}`;
          if (targetUserIds.length > 0) {
            responseText += ` targeting ${targetUserIds.length} user(s)`;
          }
          if (recurringInterval) {
            const intervalText = formatScheduleInterval(recurringInterval);
            responseText += ` (recurring every ${intervalText})`;
          }

          return responseText;
        } catch (error) {
          console.error("Error scheduling message:", error);
          return "Failed to schedule message. Please try again.";
        }
      },
    }),
  };

  const { text } = await generateText({
    model: openrouter("openai/gpt-4.1"),
    messages: promptMessages,
    maxTokens: 1000,
    tools,
    toolChoice: "auto",
    maxSteps: 10, // enable multi-step calls
    experimental_continueSteps: true,
  });

  let processedResponse = text;
  for (const [id, username] of pingableUsers) {
    // Escape regex special characters in username
    const escapedUsername = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Allow word boundary, underscore, or period after username
    processedResponse = processedResponse.replace(
      new RegExp(`@${escapedUsername}(?=\\b|_|\\.)`, "g"),
      `<@${id}>`,
    );
  }

  return processedResponse;
}
