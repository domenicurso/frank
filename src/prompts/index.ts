import { getCorePrompt } from "./core";
import { getExamplesPrompt } from "./examples";
import { getMemoryPrompt } from "./memory";
import { getPersonalityPrompt } from "./personality";
import { getSchedulingPrompt } from "./scheduling";

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
