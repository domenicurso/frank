import { GREEN, RED, YELLOW } from "@/constants";
import {
  createMemory,
  deleteMemory,
  isMemoryKeyTaken,
  ScheduledMessage,
  updateMemory,
} from "@/database";
import { createEmbed } from "@/utils/embeds";
import {
  formatScheduleInterval,
  parseScheduleInterval,
  parseScheduleTime,
} from "@/utils/scheduleHelpers";
import { tool } from "ai";
import type { Message, TextChannel } from "discord.js";
import { z } from "zod";

/**
 * Creates AI tools with access to the Discord message context
 */
export function createAITools(message: Message) {
  const userId = message.author.id;
  const guildId = message.guildId || "";

  return {
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
          // Check if key already exists in this guild
          const keyExists = await isMemoryKeyTaken(guildId, key);
          if (keyExists) {
            return `Memory key '${key}' already exists in this server. Use update_memory to modify existing memories or use create_memory with a different key.`;
          }

          const memory = await createMemory(userId, guildId, key, content);
          if (memory) {
            // Send embed notification to target channel
            try {
              const guild = message.guild;
              if (guild) {
                const channel = message.channel as TextChannel;

                if (channel && channel.isTextBased()) {
                  const embed = createEmbed(YELLOW, "Memory Created", content);

                  await channel.send({ embeds: [embed] });
                }
              }
            } catch (embedError) {
              console.error("Error sending memory create embed:", embedError);
            }

            return `Memory created: ${key} = ${content}`;
          }
          return `Failed to create memory - key '${key}' already exists in this server. Use update_memory to modify existing memories or use create_memory with a different key.`;
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
                const channel = message.channel as TextChannel;

                if (channel && channel.isTextBased()) {
                  const embed = createEmbed(YELLOW, "Memory Updated", content);

                  await channel.send({ embeds: [embed] });
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
                const channel = message.channel as TextChannel;

                if (channel && channel.isTextBased()) {
                  const embed = createEmbed(
                    RED,
                    "Memory Deleted",
                    `<@${userId}> deleted a memory`,
                  );

                  await channel.send({ embeds: [embed] });
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
              const channel = message.channel as TextChannel;

              if (channel && channel.isTextBased()) {
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

                await channel.send({ embeds: [embed] });
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
}
