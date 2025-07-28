# Memory Summarization Feature

This document describes Frank's memory summarization system, which automatically consolidates old memories to optimize storage and maintain performance while preserving important information.

## Overview

The memory summarization feature automatically processes old memories (7+ days old) and uses AI to create comprehensive summaries that replace multiple individual memories. This helps:

- **Reduce storage usage** by consolidating related memories
- **Improve performance** by reducing the number of memories to process
- **Maintain context** by preserving all important information in summaries
- **Organize information** by grouping related memories logically

## How It Works

### Automatic Scheduling

- **Frequency**: Runs every 3 hours automatically
- **Startup Delay**: 30 seconds after bot startup
- **Processing**: Handles all guilds the bot is a member of
- **Rate Limiting**: Built-in delays between chunks and guilds

### Memory Processing

1. **Selection**: Identifies memories older than 8 hours that aren't already summaries
2. **Chunking**: Groups memories by user and splits large groups into manageable chunks (8-10 memories each)
3. **Summarization**: Uses Google Gemini 2.5 Flash to create comprehensive summaries
4. **Replacement**: Creates new summary memories and deletes original memories
5. **Verification**: Ensures all original memories are successfully replaced

### AI Summarization

- **Model**: Google Gemini 2.5 Flash via OpenRouter
- **Temperature**: 0.3 (for consistent, factual summaries)
- **Max Tokens**: 1000 per summary
- **Guidelines**: Preserves all key facts, relationships, and context while being more concise

## Commands

### `/summarize-memories`

Manual memory summarization command (Admin only).

**Options:**

- `scope`:
  - `Current Guild Only` - Process memories for the current server
  - `All Guilds` - Process memories for all servers
  - `View Statistics` - Display memory statistics and analytics

**Usage Examples:**

```
/summarize-memories scope:Current Guild Only
/summarize-memories scope:All Guilds
/summarize-memories scope:View Statistics
```

## Memory Types

### Regular Memories

- Individual pieces of information about users
- Created through normal bot interactions
- Subject to summarization after 8 hours

### Summary Memories

- Consolidated memories created by the AI
- Key format: `summary_{username}_{timerange}`
- Contains comprehensive information from multiple original memories
- Not subject to further summarization

## Configuration

### Environment Variables

- `OPENROUTER_API_KEY` - Required for AI summarization

### Adjustable Parameters (in code)

- **Age Threshold**: Currently 8 hours (`hoursOld` parameter)
- **Chunk Size**: 8-10 memories per chunk
- **Minimum Chunk**: Requires 2+ memories to create a summary
- **Schedule Interval**: 3 hours between runs
- **Rate Limits**: 1 second between chunks, 2 seconds between guilds

## Statistics and Monitoring

The system provides detailed statistics through the command interface:

- **Total Memories**: Overall count of all memories
- **Regular Memories**: Non-summary memories
- **Summary Memories**: AI-generated consolidated memories
- **Old Memories**: Memories eligible for summarization (8+ hours)
- **Average Content Length**: Character count statistics
- **Guild Breakdown**: Memory distribution across servers

## Example Summarization

### Before (Multiple Memories)

```
Key: favorite_food
Content: User loves pizza, especially pepperoni with extra cheese.

Key: gaming_preferences
Content: Plays mostly FPS games like Valorant and CS2.

Key: work_schedule
Content: Works remote as a software engineer, 9 AM - 5 PM EST.
```

### After (Single Summary)

```
Key: summary_testuser_jan_15_22
Content: This user is a remote software engineer (9 AM - 5 PM EST) who enjoys pizza (especially pepperoni with extra cheese) and plays FPS games like Valorant and CS2. They're ranked Diamond in Valorant and aiming for Immortal rank.
```

## Logging and Debugging

The system provides comprehensive console logging:

```
[Memory Summarizer] Starting summarization for guild 123456789
[Memory Summarizer] Found 15 memories to potentially summarize
[Memory Summarizer] Created 3 chunks for summarization
[Memory Summarizer] Processing chunk: 5 memories from Jan 10 - Jan 15
[Memory Summarizer] Created summary "summary_user_jan_10_15" and deleted 5/5 original memories
[Memory Summarizer] Completed: 3/3 chunks successfully summarized, 15 memories condensed
```

## Error Handling

- **AI Failures**: Gracefully handles API errors and continues with other chunks
- **Database Errors**: Comprehensive error logging and transaction safety
- **Rate Limiting**: Built-in delays prevent API rate limit issues
- **Partial Failures**: Continues processing even if individual chunks fail

## Testing

A test script is available at `src/test-memory-summarizer.ts`:

```bash
bun run src/test-memory-summarizer.ts
```

This creates sample memories, runs summarization, and displays before/after results.

## Performance Considerations

- **Chunking**: Prevents overwhelming the AI with too much content
- **Batch Processing**: Handles multiple memories efficiently
- **Rate Limiting**: Respects API limits and server resources
- **Selective Processing**: Only processes old memories, preserving recent ones
- **Background Operation**: Runs automatically without user interaction

## Troubleshooting

### Common Issues

1. **No memories being summarized**
   - Check if memories are older than 8 hours
   - Verify at least 2 memories exist for chunking
   - Ensure memories aren't already summaries

2. **AI summarization failures**
   - Verify `OPENROUTER_API_KEY` is set correctly
   - Check console logs for specific error messages
   - Ensure adequate API credits/quota

3. **Database errors**
   - Check database connectivity
   - Verify memory table structure
   - Review database permissions

### Manual Intervention

If needed, you can:

- Run summarization manually using the slash command
- Check statistics to monitor system health
- Review console logs for detailed operation information
- Clean up problematic memories through database queries

## Future Enhancements

Potential improvements:

- Configurable age thresholds per guild
- Different AI models for different content types
- User-specific summarization preferences
- Advanced chunking strategies based on content similarity
- Integration with other bot features for smarter context awareness
