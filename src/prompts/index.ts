import { getCurrentActivityName } from "@/activity";
import { getCorePrompt } from "@/prompts/core";
import { getDMPrompt } from "@/prompts/dm";
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
    getPersonalityPrompt(),
    getExamplesPrompt(),
    getSchedulingPrompt(),
    getMemoryPrompt(memoryContext),
    getDMPrompt(),
    `Your current activity is "${getCurrentActivityName()}". The activity line is flavor text—use it to set tone, not to refuse tasks or derail answers.`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
