import { GREEN, RED, YELLOW } from "@/constants";
import { createEmbed } from "@/utils/embeds";
import {
  createModerationDMEmbed,
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

export const name = "Untimeout";

export const definition = new SlashCommandBuilder()
  .setName("untimeout")
  .setDescription("Remove timeout from a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The user to remove timeout from")
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for removing the timeout")
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
  const reason =
    interaction.options.getString("reason") || "No reason provided";
  const executor = interaction.member as GuildMember;

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

  // Check if user is trying to untimeout themselves
  if (targetUser.id === interaction.user.id) {
    await interaction.reply({
      embeds: [
        createEmbed(RED, "Invalid Target", "You cannot untimeout yourself."),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is the bot
  if (targetUser.id === interaction.client.user.id) {
    await interaction.reply({
      embeds: [
        createEmbed(RED, "Invalid Target", "I cannot untimeout myself."),
      ],
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
          "You cannot untimeout the server owner.",
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
          "You cannot untimeout a member with equal or higher roles than you.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if bot can moderate this user
  const botMember = await interaction.guild.members.fetch(
    interaction.client.user.id,
  );
  if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Bot Insufficient Permissions",
          "I cannot untimeout a member with equal or higher roles than me.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is actually timed out
  if (
    !targetMember.communicationDisabledUntil ||
    targetMember.communicationDisabledUntil <= new Date()
  ) {
    await interaction.reply({
      embeds: [
        createEmbed(
          YELLOW,
          "User Not Timed Out",
          `${targetUser.tag} is not currently timed out.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is moderatable
  if (!targetMember.moderatable) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Cannot Modify User",
          "This user cannot be moderated. They may have higher permissions or special roles.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // Try to DM the user before removing timeout
    const dmEmbed = createModerationDMEmbed(
      "Timeout Removed",
      interaction.guild.name,
      interaction.user,
      reason,
    );
    await sendUserDM(targetUser, dmEmbed);

    // Remove the timeout
    await targetMember.timeout(null, reason);

    // Send ephemeral success response
    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Timeout Removed",
          `**User:** ${targetUser.tag} (${targetUser.id})\n**Reason:** ${reason}\n**Removed by:** ${interaction.user.tag}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });

    // Log the untimeout action
    await logModerationAction(
      interaction.client,
      interaction.guild,
      "timeouts",
      {
        action: "Timeout Removed",
        target: targetUser,
        moderator: interaction.user,
        reason: reason,
      },
      {
        action: "⏰ Timeout Removed",
        target: targetUser,
        moderator: interaction.user,
        message: `${targetUser.tag}'s timeout has been removed.`,
      },
    );
  } catch (error) {
    console.error("Error removing timeout from user:", error);

    let errorMessage =
      "An error occurred while trying to remove the timeout. Please try again.";
    if (error instanceof Error) {
      if (error.message.includes("Missing Permissions")) {
        errorMessage = "I don't have permission to modify this user's timeout.";
      }
    }

    await interaction.reply({
      embeds: [createEmbed(RED, "Untimeout Failed", errorMessage)],
      flags: MessageFlags.Ephemeral,
    });
  }
}
