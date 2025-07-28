import { GREEN, RED, YELLOW } from "@/constants";
import { LockedChannel } from "@/database";
import { createEmbed } from "@/utils/embeds";
import { formatDuration, logModerationAction } from "@/utils/moderation";
import {
  ChatInputCommandInteraction,
  ForumChannel,
  GuildMember,
  MessageFlags,
  NewsChannel,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
  VoiceChannel,
} from "discord.js";

export const name = "Lock";

export const definition = new SlashCommandBuilder()
  .setName("lock")
  .setDescription("Lock or unlock a channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("channel")
      .setDescription("Lock the current channel")
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Reason for locking the channel")
          .setRequired(false)
          .setMaxLength(512),
      )
      .addStringOption((option) =>
        option
          .setName("duration")
          .setDescription("Duration to lock for (e.g., 5m, 1h, 2d)")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("unlock")
      .setDescription("Unlock the current channel")
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Reason for unlocking the channel")
          .setRequired(false)
          .setMaxLength(512),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Guild Only Command",
          "This command can only be used in a guild!",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!interaction.channel) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Invalid Channel",
          "This command must be used in a channel.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel;

  // Check if channel type supports locking
  if (
    !(
      channel instanceof TextChannel ||
      channel instanceof VoiceChannel ||
      channel instanceof ForumChannel ||
      channel instanceof NewsChannel
    )
  ) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Unsupported Channel Type",
          "This command can only be used in text channels, voice channels, forum channels, or news channels.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "channel":
      await handleLockChannel(interaction);
      break;
    case "unlock":
      await handleUnlockChannel(interaction);
      break;
    default:
      await interaction.reply({
        embeds: [
          createEmbed(
            RED,
            "Unknown Subcommand",
            "Unknown subcommand provided.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
  }
}

async function handleLockChannel(interaction: ChatInputCommandInteraction) {
  const reason =
    interaction.options.getString("reason") || "No reason provided";
  const durationInput = interaction.options.getString("duration");
  const executor = interaction.member as GuildMember;
  const channel = interaction.channel as
    | TextChannel
    | VoiceChannel
    | ForumChannel
    | NewsChannel;

  // Check if bot has permission to manage channel permissions
  const botMember = await interaction.guild!.members.fetch(
    interaction.client.user.id,
  );
  if (
    !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)
  ) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Bot Missing Permissions",
          "I don't have permission to manage this channel.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if channel is already locked
  const existingLock = await LockedChannel.findOne({
    where: {
      channelId: channel.id,
      guildId: interaction.guild!.id,
    },
  });

  if (existingLock) {
    await interaction.reply({
      embeds: [
        createEmbed(
          YELLOW,
          "Channel Already Locked",
          `This channel is already locked by <@${existingLock.lockedBy}>.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Parse duration if provided
  let unlockAt: Date | undefined;
  if (durationInput) {
    const duration = parseDuration(durationInput);
    if (!duration) {
      await interaction.reply({
        embeds: [
          createEmbed(
            RED,
            "Invalid Duration",
            "Please provide a valid duration (e.g., 5m, 1h, 2d).",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    unlockAt = new Date(Date.now() + duration);
  }

  try {
    // Get the @everyone role
    const everyoneRole = interaction.guild!.roles.everyone;

    // Lock the channel by denying Send Messages permission
    await channel.permissionOverwrites.edit(everyoneRole, {
      SendMessages: false,
      AddReactions: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
    });

    // Store the lock information
    const lockInfo = await LockedChannel.create({
      channelId: channel.id,
      guildId: interaction.guild!.id,
      lockedBy: interaction.user.id,
      reason: reason,
      lockedAt: new Date(),
      unlockAt: unlockAt,
    });

    // Auto-unlock will be handled by database interval if duration is set

    // Send ephemeral success response
    const successEmbed = createEmbed(
      GREEN,
      `🔒 Channel Locked`,
      `${channel} has been successfully locked.`,
    );

    successEmbed.addFields(
      {
        name: "Channel",
        value: channel.toString(),
        inline: true,
      },
      {
        name: "Moderator",
        value: interaction.user.toString(),
        inline: true,
      },
      {
        name: "Reason",
        value: reason,
        inline: false,
      },
    );

    if (unlockAt) {
      const unlockTimestamp = Math.floor(unlockAt.getTime() / 1000);
      successEmbed.addFields({
        name: "Auto-unlock",
        value: `<t:${unlockTimestamp}:F>`,
        inline: false,
      });
    }

    await interaction.reply({
      embeds: [successEmbed],
      flags: MessageFlags.Ephemeral,
    });

    // Send a public notification (only for channels that support sending messages)
    if (channel instanceof TextChannel || channel instanceof NewsChannel) {
      const publicEmbed = createEmbed(
        YELLOW,
        "🔒 Channel Locked",
        `This channel has been locked by ${interaction.user}.`,
      );

      publicEmbed.addFields({
        name: "Reason",
        value: reason,
        inline: false,
      });

      if (unlockAt) {
        const unlockTimestamp = Math.floor(unlockAt.getTime() / 1000);
        publicEmbed.addFields({
          name: "Auto-unlock",
          value: `<t:${unlockTimestamp}:R>`,
          inline: false,
        });
      }

      const publicNotification = await channel.send({
        embeds: [publicEmbed],
      });
    }

    // Log the lock action
    await logModerationAction(
      interaction.client,
      interaction.guild!,
      "channel_locks",
      {
        action: `Channel Locked - ${channel.name}`,
        target: interaction.user, // Using moderator as target since it's a channel action
        moderator: interaction.user,
        reason: reason,
        additional: {
          channelType: channel.type.toString(),
          ...(unlockAt && {
            autoUnlock: `<t:${Math.floor(unlockAt.getTime() / 1000)}:F>`,
          }),
        },
      },
      {
        action: "🔒 Channel Locked",
        moderator: interaction.user,
        message: `${channel.name} has been locked.`,
      },
    );
  } catch (error) {
    console.error("Error locking channel:", error);

    let errorMessage =
      "An error occurred while trying to lock the channel. Please try again.";
    if (error instanceof Error) {
      if (error.message.includes("Missing Permissions")) {
        errorMessage =
          "I don't have permission to modify this channel's permissions.";
      }
    }

    await interaction.reply({
      embeds: [createEmbed(RED, "Lock Failed", errorMessage)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleUnlockChannel(interaction: ChatInputCommandInteraction) {
  const reason =
    interaction.options.getString("reason") || "No reason provided";
  const executor = interaction.member as GuildMember;
  const channel = interaction.channel as
    | TextChannel
    | VoiceChannel
    | ForumChannel
    | NewsChannel;

  // Check if bot has permission to manage channel permissions
  const botMember = await interaction.guild!.members.fetch(
    interaction.client.user.id,
  );
  if (
    !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)
  ) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Bot Missing Permissions",
          "I don't have permission to manage this channel.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if channel is actually locked
  const lockInfo = await LockedChannel.findOne({
    where: {
      channelId: channel.id,
      guildId: interaction.guild!.id,
    },
  });

  if (!lockInfo) {
    await interaction.reply({
      embeds: [
        createEmbed(
          YELLOW,
          "Channel Not Locked",
          "This channel is not currently locked.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // Get the @everyone role
    const everyoneRole = interaction.guild!.roles.everyone;

    // Unlock the channel by removing the permission overwrites
    await channel.permissionOverwrites.edit(everyoneRole, {
      SendMessages: null,
      AddReactions: null,
      CreatePublicThreads: null,
      CreatePrivateThreads: null,
    });

    // Remove the lock information
    await lockInfo.destroy();

    // Send success response
    const lockDuration = Date.now() - lockInfo.lockedAt.getTime();
    const formattedDuration = formatDuration(lockDuration);

    const successEmbed = createEmbed(
      GREEN,
      "🔓 Channel Unlocked",
      `${channel} has been successfully unlocked.`,
    );

    successEmbed.addFields(
      {
        name: "Channel",
        value: channel.toString(),
        inline: true,
      },
      {
        name: "Unlocked by",
        value: interaction.user.toString(),
        inline: true,
      },
      {
        name: "Originally locked by",
        value: `<@${lockInfo.lockedBy}>`,
        inline: true,
      },
      {
        name: "Lock duration",
        value: formattedDuration,
        inline: true,
      },
      {
        name: "Reason",
        value: reason,
        inline: false,
      },
    );

    await interaction.reply({
      embeds: [successEmbed],
      flags: MessageFlags.Ephemeral,
    });

    // Send a public notification (only for channels that support sending messages)
    if (channel instanceof TextChannel || channel instanceof NewsChannel) {
      const publicEmbed = createEmbed(
        GREEN,
        "🔓 Channel Unlocked",
        `This channel has been unlocked by ${interaction.user}.`,
      );

      publicEmbed.addFields({
        name: "Lock Duration",
        value: formattedDuration,
        inline: true,
      });

      const publicNotification = await channel.send({
        embeds: [publicEmbed],
      });

      // Delete the notification after 10 seconds
      setTimeout(async () => {
        try {
          await publicNotification.delete();
        } catch (error) {
          // Message might already be deleted, ignore error
        }
      }, 10000);
    }

    // Log the unlock action
    await logModerationAction(
      interaction.client,
      interaction.guild!,
      "channel_locks",
      {
        action: `Channel Unlocked - ${channel.name}`,
        target: interaction.user, // Using moderator as target since it's a channel action
        moderator: interaction.user,
        reason: reason,
        additional: {
          channelType: channel.type.toString(),
          originallyLockedBy: `<@${lockInfo.lockedBy}>`,
          lockDuration: formattedDuration,
        },
      },
      {
        action: "🔓 Channel Unlocked",
        moderator: interaction.user,
        message: `${channel.name} has been unlocked.`,
      },
    );
  } catch (error) {
    console.error("Error unlocking channel:", error);

    let errorMessage =
      "An error occurred while trying to unlock the channel. Please try again.";
    if (error instanceof Error) {
      if (error.message.includes("Missing Permissions")) {
        errorMessage =
          "I don't have permission to modify this channel's permissions.";
      }
    }

    await interaction.reply({
      embeds: [createEmbed(RED, "Unlock Failed", errorMessage)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Parse duration string into milliseconds
 * Supports: s (seconds), m (minutes), h (hours), d (days)
 */
function parseDuration(input: string): number | null {
  const regex = /^(\d+)([smhd])$/i;
  const match = input.toLowerCase().match(regex);

  if (!match) return null;

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}
