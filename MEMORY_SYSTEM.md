# Bot Memory System

## Overview

The Bot of Doom includes a comprehensive memory system that allows the AI to remember information about users, conversations, and context across Discord interactions. This persistent memory enables more personalized and contextually aware responses.

## Features

- **Persistent Storage**: Memories are stored in the database (SQLite in development, PostgreSQL in production)
- **User-Scoped**: Memories are tied to specific users within specific guilds
- **AI Tool Integration**: Full CRUD operations through AI SDK tools
- **Automatic Indexing**: All memories are automatically included in the AI's system prompt
- **Context Awareness**: Optional context field for storing when/why memories were created

## Database Schema

### Memory Model

```typescript
class Memory extends Model {
  declare id: number;           // Primary key
  declare userId: string;       // Discord user ID
  declare guildId: string;      // Discord guild/server ID
  declare key: string;          // Memory identifier (e.g., 'favorite_color', 'hobby')
  declare value: string;        // Memory content
  declare context?: string;     // Optional context about the memory
  declare createdAt?: Date;     // When the memory was created
  declare updatedAt?: Date;     // When the memory was last updated
}
```

### Indexes

- Combined index on `(userId, guildId)` for efficient user memory lookup
- Index on `key` for fast key-based searches

## API Functions

### Core Memory Functions

```typescript
// Create a new memory (replaces existing memory with same key)
async function createMemory(
  userId: string,
  guildId: string,
  key: string,
  value: string,
  context?: string
): Promise<Memory | null>

// Update existing memory or create if doesn't exist
async function updateMemory(
  userId: string,
  guildId: string,
  key: string,
  value: string,
  context?: string
): Promise<Memory | null>

// Delete a specific memory
async function deleteMemory(
  userId: string,
  guildId: string,
  key: string
): Promise<boolean>

// Get all memories for a user in a guild
async function getAllMemories(
  userId: string,
  guildId: string
): Promise<Memory[]>

// Get all memories for a guild (admin function)
async function getGuildMemories(
  guildId: string
): Promise<Memory[]>
```

## AI SDK Tool Integration

The memory system integrates with the AI SDK through tool calling, providing the AI with the ability to create, update, and delete memories during conversations.

### Available Tools

#### create_memory
- **Description**: Store a new memory about a user or conversation
- **Parameters**:
  - `key` (string): Unique identifier for the memory
  - `value` (string): Memory content to store
  - `context` (string, optional): Additional context about the memory
- **Usage**: When the AI learns something new about a user

#### update_memory
- **Description**: Update an existing memory or create if it doesn't exist
- **Parameters**: Same as create_memory
- **Usage**: When information about a user changes

#### delete_memory
- **Description**: Delete a specific memory
- **Parameters**:
  - `key` (string): Unique identifier of the memory to delete
- **Usage**: When information is no longer relevant or user requests deletion

### Tool Creation

```typescript
import { createMemoryTools } from "./src/utils/memoryTools";

// Create tools scoped to a specific user and guild
const tools = createMemoryTools(userId, guildId);

// Use in generateText
const response = await generateText({
  model: openrouter("openai/gpt-4.1"),
  messages: promptMessages,
  tools: tools,
  toolChoice: "auto",
});
```

## Memory Integration in AI Responses

### Automatic System Prompt Integration

When generating AI responses, all existing memories for the user are automatically included in the system prompt:

```
<memories>
Previous memories about @username:
- favorite_color: blue (user mentioned they like blue)
- hobby: gaming (user talks about playing games)
- preferred_name: Alex (user prefers Alex over Alexander)
</memories>
```

### Implementation in aiResponse.ts

```typescript
// Fetch memories for this user and guild
const memories = await getAllMemories(message.author.id, message.guildId || "");

// Format memories for system prompt
const memoryContext = memories.length > 0
  ? `\n\n<memories>\nPrevious memories about @${message.author.username}:\n${memories.map((m: Memory) => `- ${m.key}: ${m.value}${m.context ? ` (${m.context})` : ""}`).join("\n")}\n</memories>`
  : "";

// Include in system prompt
const systemPrompt = `${baseSystemPrompt}${memoryContext}`;
```

## Usage Examples

### Storing User Preferences

When a user says "I prefer to be called Alex instead of Alexander":

```typescript
// AI would call:
await tools.create_memory.execute({
  key: "preferred_name",
  value: "Alex",
  context: "user prefers Alex over Alexander"
});
```

### Remembering Conversations

When a user mentions they're working on a project:

```typescript
await tools.create_memory.execute({
  key: "current_project",
  value: "building a Discord bot",
  context: "mentioned in conversation on 2024-01-15"
});
```

### Updating Information

When a user's preference changes:

```typescript
await tools.update_memory.execute({
  key: "favorite_color",
  value: "green",
  context: "changed from blue to green"
});
```

### Forgetting Information

When a user asks to forget something:

```typescript
await tools.delete_memory.execute({
  key: "embarrassing_fact"
});
```

## Best Practices

### Memory Key Naming

Use descriptive, consistent naming conventions:
- `preferred_name` - User's preferred name
- `favorite_color` - User's favorite color
- `hobby` - User's main hobby
- `timezone` - User's timezone
- `current_project` - What the user is currently working on
- `mood_preference` - How the user likes to be addressed

### Context Usage

Always include context when creating memories to help understand:
- When the information was learned
- Why it's relevant
- How confident you are about the information

### Memory Lifecycle

- **Create**: When learning something new about a user
- **Update**: When information changes or gets clarified
- **Delete**: When information becomes irrelevant or user requests removal

## Error Handling

All memory functions include proper error handling:

```typescript
try {
  const memory = await createMemory(userId, guildId, key, value, context);
  if (memory) {
    return `Memory created: ${key} = ${value}`;
  }
  return "Failed to create memory";
} catch (error) {
  console.error("Error creating memory:", error);
  return "Failed to create memory";
}
```

## Performance Considerations

- Memories are fetched once per AI response generation
- Database queries are optimized with proper indexing
- Memory context is limited to recent/relevant information in system prompt
- Automatic cleanup could be implemented for very old memories (future enhancement)

## Privacy and Data Protection

- Memories are scoped to specific guilds (servers)
- Users can request deletion of their memories
- No cross-guild memory sharing
- All memory operations are logged for debugging

## Future Enhancements

Potential improvements to consider:

1. **Memory Categories**: Group memories by type (preferences, facts, conversations)
2. **Memory Expiration**: Automatic cleanup of old memories
3. **Memory Confidence**: Score memories based on how certain the AI is
4. **Memory Search**: Advanced querying capabilities
5. **Memory Export**: Allow users to export their memories
6. **Memory Analytics**: Track memory usage and effectiveness
7. **Cross-Guild Memories**: Optional global user preferences
8. **Memory Compression**: Summarize old memories to save space

## Testing

The memory system includes comprehensive tests covering:

- Basic CRUD operations
- Tool integration
- Error handling
- Database constraints
- Type safety

Run tests with:
```bash
bun test-memory.ts
```

## Security Considerations

- Input validation on all memory operations
- SQL injection protection through Sequelize ORM
- Rate limiting on memory operations (if needed)
- User permission checks before memory access
- Sanitization of memory content before display
