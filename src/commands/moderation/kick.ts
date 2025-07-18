import { GREEN, RED } from "@/constants";
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

export const name = "Kick";

export const definition = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("Kick a member from the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((option) =>
    option.setName("user").setDescription("The user to kick").setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for the kick")
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

  // Check if user is trying to kick themselves
  if (targetUser.id === interaction.user.id) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Invalid Target", "You cannot kick yourself.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is the bot
  if (targetUser.id === interaction.client.user.id) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Invalid Target", "I cannot kick myself.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is the server owner
  if (targetUser.id === interaction.guild.ownerId) {
    await interaction.reply({
      embeds: [
        createEmbed(RED, "Invalid Target", "You cannot kick the server owner."),
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
          "You cannot kick a member with equal or higher roles than you.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if bot can kick this user
  const botMember = await interaction.guild.members.fetch(
    interaction.client.user.id,
  );
  if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Bot Insufficient Permissions",
          "I cannot kick a member with equal or higher roles than me.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is kickable
  if (!targetMember.kickable) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Cannot Kick User",
          "This user cannot be kicked. They may have higher permissions or special roles.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // Try to DM the user before kicking
    const dmEmbed = createModerationDMEmbed(
      "Kicked",
      interaction.guild.name,
      interaction.user,
      reason,
    );
    await sendUserDM(targetUser, dmEmbed);

    // Perform the kick
    await targetMember.kick(reason);

    // Send ephemeral success response
    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "User Kicked",
          `**User:** ${targetUser.tag} (${targetUser.id})\n**Reason:** ${reason}\n**Kicked by:** ${interaction.user.tag}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });

    // Log the kick action
    await logModerationAction(
      interaction.client,
      interaction.guild,
      "kicks",
      {
        action: "Kick",
        target: targetUser,
        moderator: interaction.user,
        reason: reason,
      },
      {
        action: "👢 User Kicked",
        target: targetUser,
        moderator: interaction.user,
        message: `${targetUser.tag} has been kicked from the server.`,
      },
    );
  } catch (error) {
    console.error("Error kicking user:", error);
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Kick Failed",
          "An error occurred while trying to kick the user. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
