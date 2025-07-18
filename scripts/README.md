# Message Count Update Scripts

This directory contains scripts for bulk updating user message counts in the Bot of Doom database.

## Available Scripts

### 1. `update-message-counts.ts` - Basic Script
A simple script where you modify the code to include your data directly.

**Usage:**
```bash
bun scripts/update-message-counts.ts
```

**How to use:**
1. Edit the script file
2. Replace `YOUR_GUILD_ID_HERE` with your actual guild ID
3. Replace the `exampleData` array with your actual user data
4. Uncomment the execution line
5. Run the script

### 2. `interactive-update-messages.ts` - Interactive Script
An interactive script that prompts you for input step by step.

**Usage:**
```bash
bun scripts/interactive-update-messages.ts
```

**Features:**
- Prompts for guild ID with validation
- Allows entering user data one by one or pasting multiple lines
- Shows progress and confirmation before executing
- Validates Discord user ID format
- Handles duplicate entries (updates existing)

**Input format:**
```
userId,messageCount
123456789012345678,150
987654321098765432,75
```

### 3. `bulk-update-from-json.ts` - JSON File-Based Script
Best for large datasets. Reads user data from a JSON file.

**Usage:**
```bash
# Create an example JSON file
bun scripts/bulk-update-from-json.ts --create-example

# Run with your JSON file
bun scripts/bulk-update-from-json.ts path/to/your/data.json
```

**JSON format:**
```json
{
  "guildId": "123456789012345678",
  "userData": [
    ["123456789012345678", 150],
    ["987654321098765432", 75],
    ["456789012345678901", 200]
  ]
}
```

## Data Format

All scripts expect user data as arrays of `[userId, messageCount]` pairs:

- **userId**: Discord user ID (17-19 digit string)
- **messageCount**: Non-negative integer representing the message count

## Safety Features

### Validation
- ✅ Discord user ID format validation (17-19 digits)
- ✅ Message count validation (non-negative integers)
- ✅ Guild ID format validation
- ✅ Duplicate detection and handling

### Database Operations
- ✅ Creates new user stats if user doesn't exist
- ✅ Updates existing user stats without affecting other fields
- ✅ Updates `lastActive` timestamp
- ✅ Preserves `commandsUsed` count
- ✅ Transaction-safe operations

### Error Handling
- ✅ Continues processing other users if one fails
- ✅ Detailed error reporting
- ✅ Progress tracking for large datasets
- ✅ Confirmation prompts before execution

## Examples

### Example 1: Small Dataset (Interactive Script)
```bash
bun scripts/interactive-update-messages.ts
```
Then enter:
```
Enter the Guild ID: 123456789012345678
[0] User data: 123456789012345678,150
[1] User data: 987654321098765432,75
[2] User data: done
```

### Example 2: Large Dataset (JSON Script)
1. Create your JSON file:
```json
{
  "guildId": "123456789012345678",
  "userData": [
    ["123456789012345678", 150],
    ["987654321098765432", 75],
    ["456789012345678901", 200],
    ["789012345678901234", 300]
  ]
}
```

2. Run the script:
```bash
bun scripts/bulk-update-from-json.ts userdata.json
```

### Example 3: Programmatic Use
```typescript
import { updateMessageCounts } from "./scripts/update-message-counts.ts";

const userData: [string, number][] = [
  ["123456789012345678", 150],
  ["987654321098765432", 75]
];

await updateMessageCounts(userData, "123456789012345678");
```

## Output

All scripts provide detailed output including:
- ✅ Success count
- ➕ Users created
- 📝 Users updated
- ❌ Error count
- Progress indicators for large datasets

Example output:
```
🤖 Bot of Doom - Message Count Updater
==================================================
✅ Database connected
✓ Updated 123456789012345678: 100 -> 150
✓ Created 987654321098765432: 75 messages
==================================================
UPDATE COMPLETE
==================================================
✅ Total successful: 2
📝 Users updated: 1
➕ Users created: 1
❌ Errors: 0
```

## Tips

1. **For small datasets (< 20 users)**: Use the interactive script
2. **For large datasets (> 20 users)**: Use the JSON script
3. **For one-time modifications**: Edit the basic script directly
4. **Test first**: Run with a small subset to verify behavior
5. **Backup**: Consider backing up your database before large operations

## Troubleshooting

### Common Issues

**"Invalid user ID format"**
- Discord user IDs must be 17-19 digits
- Remove any spaces or special characters

**"Guild ID cannot be empty"**
- Ensure you're using a valid Discord guild/server ID
- Get it from Discord Developer Mode or bot logs

**"Database connection failed"**
- Ensure the bot database is accessible
- Check that `database.sqlite` exists in the project root

**"File not found"**
- Use absolute paths or run from project root
- Check file permissions

### Getting Discord IDs

To get Discord user IDs:
1. Enable Developer Mode in Discord settings
2. Right-click on user → "Copy User ID"

To get Guild ID:
1. Right-click on server name → "Copy Server ID"
