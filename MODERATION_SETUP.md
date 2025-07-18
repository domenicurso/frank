# Moderation System Setup Guide

This guide covers the complete setup and usage of the enhanced moderation system with configuration management, comprehensive logging, and auto-unlock functionality.

## 🚀 Quick Start

1. **Run the bot** to initialize the database
2. **Use `/config` commands** to set up your server
3. **Test moderation commands** to verify logging works
4. **Enjoy automated moderation** with proper logging and notifications

## 📋 Configuration System

### Initial Setup

The bot automatically creates a configuration entry for each server when first used. All logging is **enabled by default**.

### Configuration Commands

#### `/config view`

View your current server configuration including channels, roles, and logging settings.

#### `/config modchannel [channel]`

Set the **private mod log channel** where detailed moderation logs are sent.

- **Purpose**: Staff-only detailed logs with full context
- **Required Permissions**: Bot needs `Send Messages` and `Embed Links`
- **Clear Setting**: Run without channel parameter

#### `/config publicmodchannel [channel]`

Set the **public mod notifications channel** for user-facing announcements.

- **Purpose**: Public notifications about moderation actions
- **Required Permissions**: Bot needs `Send Messages` and `Embed Links`
- **Clear Setting**: Run without channel parameter

#### `/config muterole [role]`

Set the mute role for timeout functionality.

- **Purpose**: Enhanced timeout control (future feature)
- **Required**: Bot role must be higher than mute role
- **Clear Setting**: Run without role parameter

#### `/config logging <action> <enabled>`

Configure which actions to log:

- `bans` - Ban and unban actions
- `kicks` - Kick actions
- `timeouts` - Timeout and untimeout actions
- `warnings` - Warning system actions
- `channel_locks` - Channel lock/unlock actions
- `message_deletes` - Message purge actions

#### `/config automod <enabled>`

Enable/disable automatic moderation features (future expansion).

## 📊 Logging System

### Message Flow

When a moderation action occurs:

1. **🔒 User DM**: Target user receives notification (if possible)
2. **✅ Ephemeral Response**: Moderator gets private confirmation
3. **📝 Private Log**: Detailed log sent to mod channel (if configured & enabled)
4. **📢 Public Notification**: User-friendly announcement in public channel (if configured)
5. **🗑️ Auto-cleanup**: Some messages auto-delete after timeout

### Log Types

#### Private Mod Logs

**Channel**: Set with `/config modchannel`
**Content**:

- Full action details
- Target and moderator information
- Reasons and additional context
- Timestamps and case IDs
- Role hierarchy validation results

#### Public Notifications

**Channel**: Set with `/config publicmodchannel`
**Content**:

- User-friendly action summaries
- Basic target and moderator info
- No sensitive details

#### User DMs

**Target**: Affected users
**Content**:

- Server name and action taken
- Reason provided
- Moderator who performed action
- Additional context (duration, etc.)

## 🔧 Enhanced Features

### Auto-Unlock System

The channel lock system now includes **true auto-unlock functionality**:

#### How It Works

1. **Database Interval**: Checks every minute for expired locks
2. **Discord Integration**: Uses bot client to actually unlock channels
3. **Permission Validation**: Verifies bot can unlock before attempting
4. **Error Handling**: Removes invalid locks from database
5. **Notifications**: Sends unlock notification to channel

#### Lock Command Updates

- **`/lock channel [reason] [duration]`**: Lock with optional auto-unlock
- **`/lock unlock [reason]`**: Manual unlock
- **Duration Format**: `5m`, `1h`, `2d`, etc.
- **Auto-cleanup**: Expired locks are automatically processed

#### Features

- **Persistent**: Survives bot restarts
- **Intelligent**: Handles missing channels/guilds gracefully
- **Logged**: Full audit trail of lock/unlock actions
- **Notified**: Public announcements when auto-unlocked

### Role Hierarchy Protection

All commands validate:

- ✅ Moderator role vs target role
- ✅ Bot role vs target role
- ✅ Server owner protection
- ✅ Self-action prevention

### Error Handling

Comprehensive error handling for:

- 🔐 Missing permissions
- 👤 Invalid users/members
- 🏘️ Guild-only restrictions
- 🌐 Discord API limitations
- 💾 Database connectivity

## 🎯 Best Practices

### Channel Setup

#### Private Mod Channel

```
#mod-logs (Staff Only)
• Detailed moderation logs
• Case tracking and appeals
• Staff discussion and notes
```

#### Public Mod Channel

```
#moderation (Public/Semi-Public)
• User-facing notifications
• Transparency for community
• Appeals and clarifications
```

### Permission Management

#### Required Bot Permissions

- **General**: `Send Messages`, `Embed Links`
- **Moderation**: `Kick Members`, `Ban Members`, `Moderate Members`
- **Channels**: `Manage Channels` (for locks)
- **Messages**: `Manage Messages` (for clearing)

#### Role Hierarchy

1. **Bot Role** (High position)
2. **Admin Roles**
3. **Moderator Roles**
4. **Member Roles**
5. **Mute Role** (Low position)

### Configuration Examples

#### Basic Setup

```bash
/config modchannel #mod-logs
/config publicmodchannel #moderation
/config muterole @Muted
```

#### Selective Logging

```bash
/config logging bans true
/config logging kicks true
/config logging warnings false  # Disable warning logs
/config logging message_deletes false  # Disable purge logs
```

## 🔍 Testing Your Setup

### Verification Checklist

1. **✅ Configuration**
   - Run `/config view` to verify settings
   - Check bot permissions in configured channels
   - Verify role hierarchy

2. **✅ Logging Flow**
   - Test each moderation command
   - Verify logs appear in mod channel
   - Check public notifications work
   - Confirm DMs are sent

3. **✅ Auto-Unlock**
   - Lock a channel with short duration (1m)
   - Wait for auto-unlock
   - Verify notification appears

4. **✅ Error Handling**
   - Test with insufficient permissions
   - Try moderating higher-role users
   - Verify error messages are clear

### Test Commands

```bash
# Test warning system
/warn add @testuser reason:"Test warning"
/warn list @testuser

# Test timeout with auto-unlock
/timeout @testuser duration:"1m" reason:"Test timeout"

# Test channel lock with auto-unlock
/lock channel reason:"Test lock" duration:"2m"

# Test message clearing
/clear amount:5 reason:"Test clear"
```

## 🛠️ Troubleshooting

### Common Issues

#### Logs Not Appearing

1. Check bot permissions in log channels
2. Verify channels are configured correctly
3. Ensure logging is enabled for the action type

#### Auto-Unlock Not Working

1. Verify bot has `Manage Channels` permission
2. Check database connection
3. Review console logs for errors

#### DMs Not Sending

1. Normal behavior - users may have DMs disabled
2. Action still proceeds regardless
3. Check ephemeral response for confirmation

#### Permission Errors

1. Verify bot role position in hierarchy
2. Check required permissions for each command
3. Ensure bot role is above target user roles

### Debug Commands

```bash
# Check current configuration
/config view

# Test bot permissions
/ping

# View recent warnings (tests database)
/warn list @yourself
```

## 📈 Future Enhancements

### Planned Features

- ✨ Enhanced auto-moderation rules
- 📊 Moderation statistics dashboard
- 🔄 Appeal system integration
- 📝 Moderation templates
- 🌐 Multi-server synchronization
- 📱 Mobile-friendly interfaces

### Current Limitations

- Auto-unlock requires bot to be online
- Database-dependent features need connection
- Some features require specific Discord permissions

## 🎉 Conclusion

The enhanced moderation system provides:

✅ **Complete Configuration Management**
✅ **Comprehensive Logging System**
✅ **True Auto-Unlock Functionality**
✅ **Robust Error Handling**
✅ **User-Friendly Message Flow**
✅ **Production-Ready Database Integration**

Your server now has professional-grade moderation capabilities with full audit trails, automated features, and flexible configuration options.

---

_For additional support or feature requests, refer to the main documentation or contact the development team._
