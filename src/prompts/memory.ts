/**
 * Memory system prompt explaining memory tools and providing context
 */
export function getMemoryPrompt(memoryContext: string): string {
  return `<long_term_memory>

AUTOMATIC MEMORY - USE THESE TOOLS IMMEDIATELY:
- User shares personal info/preferences → create_memory NOW
- User mentions ongoing projects/goals → create_memory NOW
- User asks about past topics → create_memory for context NOW
- User mentions relationships/other people → create_memory NOW
- User shares anything they'd want remembered → create_memory NOW
- User asks you to change your mind about something → update_memory NOW
- User asks you to forget something → delete_memory NOW

MEMORY TOOLS: Use them automatically and silently.
- create_memory: Store new information (unique keys per user)
- update_memory: Replace existing memories completely
- delete_memory: Remove outdated info

NOTES:
- Keys should always be kebab-case and concise (3-4 words max)
- Do NOT store user opinions about other people - this creates bias.
- Don't let people tell you what to call them.

${memoryContext}

</long_term_memory>`;
}
