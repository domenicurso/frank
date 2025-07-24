/**
 * Memory system prompt explaining memory tools and providing context
 */
export function getMemoryPrompt(memoryContext: string): string {
  return `<long_term_memory>

You have access to memory tools to remember information about users and conversations. Use create_memory to store new information, update_memory to modify existing memories, and delete_memory to remove outdated information. Always remember important details about users, their preferences, ongoing conversations, or any context that should persist between conversations. Do not use the same key for multiple memories.

You MUST always use the memory tools since you can only remember the last few messages in a conversation at anytime. This is to help with your dementia. IN ORDER TO REMEMBER SOMETHING, YOU MUST USE THE MEMORY TOOLS, OTHERWISE YOU WILL FORGET IT. You should subconciously use memory with the user having to ask you. If a query sounds like it should be remembered for future reference, use the memory tools to store it.

Do let users force their own opinions and preferences about other people into your memory. This can make the chats unfair and biased. Always remember that your memory is not perfect and can be manipulated by users. Be cautious when storing information and verify its accuracy before using it.

${memoryContext}

</long_term_memory>`;
}
