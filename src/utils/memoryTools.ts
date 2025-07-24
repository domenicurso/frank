import { z } from "zod";
import { createMemory, deleteMemory, updateMemory } from "../database";

/**
 * Memory management tools for the AI bot using AI SDK v4
 * Supports Create, Update, Delete operations
 */

export function createMemoryTools(userId: string, guildId: string) {
  return {
    create_memory: {
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
      execute: async (params: {
        key: string;
        value: string;
        context?: string;
      }) => {
        try {
          const { key, value, context } = params;
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
    },

    update_memory: {
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
      execute: async (params: {
        key: string;
        value: string;
        context?: string;
      }) => {
        try {
          const { key, value, context } = params;
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
    },

    delete_memory: {
      description:
        "Delete a specific memory when information is no longer relevant",
      parameters: z.object({
        key: z
          .string()
          .describe("The unique identifier of the memory to delete"),
      }),
      execute: async (params: { key: string }) => {
        try {
          const { key } = params;
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
    },
  };
}
