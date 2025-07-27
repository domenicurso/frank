import { getCorePrompt } from "@/prompts/core";
import { getExamplesPrompt } from "@/prompts/examples";
import { getMemoryPrompt } from "@/prompts/memory";
import { getPersonalityPrompt } from "@/prompts/personality";
import { getSchedulingPrompt } from "@/prompts/scheduling";

/**
 * Builds the complete system prompt by combining all sections
 */
export function buildSystemPrompt(
  pingableUsers: [string, string, string][],
  memoryContext: string,
): string {
  return [
    getCorePrompt(pingableUsers),
    getMemoryPrompt(memoryContext),
    getSchedulingPrompt(),
    getPersonalityPrompt(),
    getExamplesPrompt(),
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

console.log(buildSystemPrompt([], ""));