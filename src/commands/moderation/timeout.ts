import { GREEN, RED, YELLOW } from "@/constants";
import { createEmbed } from "@/utils/embeds";
import {
  createModerationDMEmbed,
  formatDuration,
  logModerationAction,
  sendUserDM,
} from "@/utils/moderation";
import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const name = "Timeout";

export const definition = new SlashCommandBuilder()
  .setName("timeout")
  .setDescription("Timeout a member from the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The user to timeout")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("duration")
      .setDescription("Duration (e.g., 5m, 1h, 2d, max 28d)")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for the timeout")
      .setRequired(false)
      .setMaxLength(512),
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

  const targetUser = interaction.options.getUser("user", true);
  const durationInput = interaction.options.getString("duration", true);
  const reason =
    interaction.options.getString("reason") || "No reason provided";
  const executor = interaction.member as GuildMember;

  // Parse duration
  const duration = parseDuration(durationInput);
  if (!duration) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Invalid Duration",
          "Please provide a valid duration (e.g., 5m, 1h, 2d). Maximum is 28 days.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if duration is within Discord's limits (max 28 days)
  const maxDuration = 28 * 24 * 60 * 60 * 1000; // 28 days in milliseconds
  if (duration > maxDuration) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Duration Too Long",
          "Maximum timeout duration is 28 days.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Get the target member
  let targetMember: GuildMember;
  try {
    targetMember = await interaction.guild.members.fetch(targetUser.id);
  } catch (error) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "User Not Found",
          "The specified user is not a member of this server.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if user is trying to timeout themselves
  if (targetUser.id === interaction.user.id) {
    await interaction.reply({
      embeds: [
        createEmbed(RED, "Invalid Target", "You cannot timeout yourself."),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is the bot
  if (targetUser.id === interaction.client.user.id) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Invalid Target", "I cannot timeout myself.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is the server owner
  if (targetUser.id === interaction.guild.ownerId) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Invalid Target",
          "You cannot timeout the server owner.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check role hierarchy
  if (targetMember.roles.highest.position >= executor.roles.highest.position) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Insufficient Permissions",
          "You cannot timeout a member with equal or higher roles than you.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if bot can timeout this user
  const botMember = await interaction.guild.members.fetch(
    interaction.client.user.id,
  );
  if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Bot Insufficient Permissions",
          "I cannot timeout a member with equal or higher roles than me.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is already timed out
  if (
    targetMember.communicationDisabledUntil &&
    targetMember.communicationDisabledUntil > new Date()
  ) {
    const currentTimeoutEnd = Math.floor(
      targetMember.communicationDisabledUntil.getTime() / 1000,
    );
    await interaction.reply({
      embeds: [
        createEmbed(
          YELLOW,
          "User Already Timed Out",
          `${targetUser.tag} is already timed out until <t:${currentTimeoutEnd}:F>. Use this command again to update the timeout.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Check if target is moderatable
  if (!targetMember.moderatable) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Cannot Timeout User",
          "This user cannot be timed out. They may have higher permissions or special roles.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // Calculate timeout end time
    const timeoutUntil = new Date(Date.now() + duration);

    // Try to DM the user before timing out
    const formattedDuration = formatDuration(duration);
    const timeoutEndTimestamp = Math.floor(timeoutUntil.getTime() / 1000);

    const dmEmbed = createModerationDMEmbed(
      "Timed Out",
      interaction.guild.name,
      interaction.user,
      reason,
      {
        duration: formattedDuration,
        until: `<t:${timeoutEndTimestamp}:F>`,
      },
    );
    await sendUserDM(targetUser, dmEmbed);

    // Perform the timeout
    await targetMember.timeout(duration, reason);

    // Send ephemeral success response
    const successEmbed = createEmbed(
      GREEN,
      "⏰ User Timed Out",
      `${targetUser.tag} has been successfully timed out.`,
    );

    successEmbed.addFields(
      {
        name: "Target User",
        value: `${targetUser.toString()}\n**ID:** ${targetUser.id}`,
        inline: true,
      },
      {
        name: "Duration",
        value: formattedDuration,
        inline: true,
      },
      {
        name: "Timed out by",
        value: interaction.user.toString(),
        inline: true,
      },
      {
        name: "Until",
        value: `<t:${timeoutEndTimestamp}:F>`,
        inline: false,
      },
      {
        name: "Reason",
        value: reason,
        inline: false,
      },
    );

    successEmbed.setThumbnail(targetUser.displayAvatarURL());

    await interaction.reply({
      embeds: [successEmbed],
      flags: MessageFlags.Ephemeral,
    });

    // Log the timeout action
    await logModerationAction(
      interaction.client,
      interaction.guild,
      "timeouts",
      {
        action: "User Timed Out",
        target: targetUser,
        moderator: interaction.user,
        reason: reason,
        duration: formattedDuration,
        additional: {
          until: `<t:${timeoutEndTimestamp}:F>`,
        },
      },
      {
        action: "⏰ User Timed Out",
        target: targetUser,
        moderator: interaction.user,
        message: `${targetUser.tag} has been timed out for ${formattedDuration}.`,
      },
    );
  } catch (error) {
    console.error("Error timing out user:", error);

    let errorMessage =
      "An error occurred while trying to timeout the user. Please try again.";
    if (error instanceof Error) {
      if (error.message.includes("Missing Permissions")) {
        errorMessage = "I don't have permission to timeout this user.";
      }
    }

    await interaction.reply({
      embeds: [createEmbed(RED, "Timeout Failed", errorMessage)],
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
