import { createMemory, deleteMemory, updateMemory } from "@/database";
import { tool } from "ai";
import { z } from "zod";

/**
 * Memory management tools for the AI bot using AI SDK
 * Supports Create, Update, Delete operations (no read - memories are indexed in system prompt)
 */

export function createMemoryTools(userId: string, guildId: string) {
  return {
    create_memory: tool({
      description:
        "Store a new memory about a user or conversation. Use this to remember important information about users, their preferences, ongoing conversations, or any context that should persist across messages.",
      parameters: z.object({
        key: z
          .string()
          .describe(
            "A unique identifier for this memory (e.g., 'preferred_name', 'hobby', 'ongoing_project')",
          ),
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
      description:
        "Update an existing memory or create it if it doesn't exist. Use this when you need to modify information you've previously stored about a user or conversation.",
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
        "Delete a specific memory. Use this when information is no longer relevant or when a user asks to forget something specific.",
      parameters: z.object({
        key: z
          .string()
          .describe("The unique identifier of the memory to delete"),
      }),
      execute: async ({ key }) => {
        try {
          const deleted = await deleteMemory(userId, guildId, key);
          if (deleted) {
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
}
