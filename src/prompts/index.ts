import { getCorePrompt } from "./core";
import { getExamplesPrompt } from "./examples";
import { getMemoryPrompt } from "./memory";
import { getPersonalityPrompt } from "./personality";

/**
 * Builds the complete system prompt by combining all sections
 */
export function buildSystemPrompt(
  pingableUsers: [string, string, string][],
  memoryContext: string,
): string {
  const corePrompt = getCorePrompt(pingableUsers);
  const memoryPrompt = getMemoryPrompt(memoryContext);
  const personalityPrompt = getPersonalityPrompt();
  const examplesPrompt = getExamplesPrompt();

  return `${corePrompt}

${memoryPrompt}

${personalityPrompt}

${examplesPrompt}`;
}
