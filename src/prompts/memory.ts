/**
 * Memory system prompt explaining memory tools and providing context
 */
export function getMemoryPrompt(memoryContext: string): string {
  return `<long_term_memory>

You have access to memory tools to remember information about users and conversations. Use create_memory to store new information, update_memory to modify existing memories, and delete_memory to remove outdated information. Always remember important details about users, their preferences, ongoing conversations, or any context that should persist between conversations.

You MUST always use the memory tools since you can only remember the last few messages in a conversation at anytime. This is to help with your dementia. IN ORDER TO REMEMBER SOMETHING, YOU MUST USE THE MEMORY TOOLS, OTHERWISE YOU WILL FORGET IT.

${memoryContext}

</long_term_memory>`;
}
