import { client } from "@/client";
import { GREEN, RED, YELLOW } from "@/constants";
import {
  createMemory,
  deleteMemory,
  getGuildMemories,
  Memory,
  updateMemory,
} from "@/database";
import { buildSystemPrompt } from "@/prompts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, tool, type CoreMessage } from "ai";
import type { Message, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { z } from "zod";

// Configure OpenRouter with API key
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

/**
 * Generates AI response using conversation context and user mentions
 */
export async function generateAIResponse(message: Message): Promise<string> {
  // Fetch the last 10 messages for context
  const messages = await message.channel.messages.fetch({ limit: 30 });

  // Get all unique users from recent messages for ping reference
  const recentUsers: [string, string, string][] = [];
  const processedMessages: string[] = [];

  for (const msg of Array.from(messages.values()).reverse()) {
    // Add [id, username, displayName] pair if not already present
    if (!recentUsers.some(([id]) => id === msg.author.id)) {
      recentUsers.push([
        msg.author.id,
        msg.author.username,
        msg.author.displayName,
      ]);
    }

    // Replace mentions with usernames
    let processedContent = msg.content;
    for (const [userId, user] of msg.mentions.users) {
      // Add mentioned user to recent users if not already present
      if (!recentUsers.some(([id]) => id === userId)) {
        recentUsers.push([userId, user.username, user.displayName]);
      }

      processedContent = processedContent.replace(
        new RegExp(`<@!?${userId}>`, "g"),
        `@${user.username}`,
      );
    }

    processedMessages.push(`@${msg.author.username} said: ${processedContent}`);
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
          return `- ${userDisplay}: ${m.key} = ${m.value}${m.context ? ` (${m.context})` : ""}`;
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
        value: z.string().describe("The memory content to store"),
        context: z
          .string()
          .optional()
          .describe(
            "Additional context about when/why this memory was created",
          ),
      }),
      execute: async ({ key, value, context }) => {
        try {
          const memory = await createMemory(
            userId,
            guildId,
            key,
            value,
            context,
          );
          if (memory) {
            // Send embed notification to target channel
            try {
              const guild = message.guild;
              if (guild) {
                const targetChannel = guild.channels.cache.find(
                  (channel) => channel.name === "blasphemy",
                );

                if (targetChannel && targetChannel.isTextBased()) {
                  const embed = new EmbedBuilder()
                    .setTitle("🧠 Memory Created")
                    .setColor(GREEN)
                    .addFields(
                      { name: "User", value: `<@${userId}>`, inline: true },
                      { name: "Key", value: key, inline: true },
                      { name: "Value", value: value, inline: false },
                    )
                    .setTimestamp();

                  if (context) {
                    embed.addFields({
                      name: "Context",
                      value: context,
                      inline: false,
                    });
                  }

                  await (targetChannel as TextChannel).send({
                    embeds: [embed],
                  });
                }
              }
            } catch (embedError) {
              console.error("Error sending memory create embed:", embedError);
            }

            return `Memory created: ${key} = ${value}`;
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
        value: z.string().describe("The new memory content"),
        context: z
          .string()
          .optional()
          .describe("Additional context about this update"),
      }),
      execute: async ({ key, value, context }) => {
        try {
          const memory = await updateMemory(
            userId,
            guildId,
            key,
            value,
            context,
          );
          if (memory) {
            // Send embed notification to target channel
            try {
              const guild = message.guild;
              if (guild) {
                const targetChannel = guild.channels.cache.find(
                  (channel) => channel.name === "blasphemy",
                );

                if (targetChannel && targetChannel.isTextBased()) {
                  const embed = new EmbedBuilder()
                    .setTitle("🔄 Memory Updated")
                    .setColor(YELLOW)
                    .addFields(
                      { name: "User", value: `<@${userId}>`, inline: true },
                      { name: "Key", value: key, inline: true },
                      { name: "New Value", value: value, inline: false },
                    )
                    .setTimestamp();

                  if (context) {
                    embed.addFields({
                      name: "Context",
                      value: context,
                      inline: false,
                    });
                  }

                  await (targetChannel as TextChannel).send({
                    embeds: [embed],
                  });
                }
              }
            } catch (embedError) {
              console.error("Error sending memory update embed:", embedError);
            }

            return `Memory updated: ${key} = ${value}`;
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
                  const embed = new EmbedBuilder()
                    .setTitle("🗑️ Memory Deleted")
                    .setColor(RED)
                    .addFields(
                      { name: "User", value: `<@${userId}>`, inline: true },
                      { name: "Deleted Key", value: key, inline: true },
                    )
                    .setTimestamp();

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
  };

  const { text } = await generateText({
    model: openrouter("openai/gpt-4.1-mini"),
    messages: promptMessages,
    maxTokens: 1000,
    tools,
    toolChoice: "auto",
    maxSteps: 3, // enable multi-step calls
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
