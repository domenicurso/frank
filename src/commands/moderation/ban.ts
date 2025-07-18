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

export const name = "Ban";

export const definition = new SlashCommandBuilder()
  .setName("ban")
  .setDescription("Ban a member from the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((option) =>
    option.setName("user").setDescription("The user to ban").setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for the ban")
      .setRequired(false)
      .setMaxLength(512),
  )
  .addIntegerOption((option) =>
    option
      .setName("delete_message_days")
      .setDescription("Number of days of messages to delete (0-7)")
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(7),
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
  const deleteMessageDays =
    interaction.options.getInteger("delete_message_days") || 0;
  const executor = interaction.member as GuildMember;

  // Check if user is trying to ban themselves
  if (targetUser.id === interaction.user.id) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Invalid Target", "You cannot ban yourself.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is the bot
  if (targetUser.id === interaction.client.user.id) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Invalid Target", "I cannot ban myself.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is the server owner
  if (targetUser.id === interaction.guild.ownerId) {
    await interaction.reply({
      embeds: [
        createEmbed(RED, "Invalid Target", "You cannot ban the server owner."),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if user is already banned
  try {
    const existingBan = await interaction.guild.bans.fetch(targetUser.id);
    if (existingBan) {
      await interaction.reply({
        embeds: [
          createEmbed(
            YELLOW,
            "User Already Banned",
            `${targetUser.tag} is already banned from this server.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } catch (error) {
    // User is not banned, continue
  }

  // Try to get the target member (they might not be in the server)
  let targetMember: GuildMember | null = null;
  try {
    targetMember = await interaction.guild.members.fetch(targetUser.id);
  } catch (error) {
    // User is not in the server, but we can still ban them
  }

  // If user is in the server, perform additional checks
  if (targetMember) {
    // Check role hierarchy
    if (
      targetMember.roles.highest.position >= executor.roles.highest.position
    ) {
      await interaction.reply({
        embeds: [
          createEmbed(
            RED,
            "Insufficient Permissions",
            "You cannot ban a member with equal or higher roles than you.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if bot can ban this user
    const botMember = await interaction.guild.members.fetch(
      interaction.client.user.id,
    );
    if (
      targetMember.roles.highest.position >= botMember.roles.highest.position
    ) {
      await interaction.reply({
        embeds: [
          createEmbed(
            RED,
            "Bot Insufficient Permissions",
            "I cannot ban a member with equal or higher roles than me.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if target is bannable
    if (!targetMember.bannable) {
      await interaction.reply({
        embeds: [
          createEmbed(
            RED,
            "Cannot Ban User",
            "This user cannot be banned. They may have higher permissions or special roles.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  try {
    // Try to DM the user before banning (only if they're in the server)
    if (targetMember) {
      const dmEmbed = createModerationDMEmbed(
        "Banned",
        interaction.guild.name,
        interaction.user,
        reason,
        {
          messageDeletion: `${deleteMessageDays} day${deleteMessageDays !== 1 ? "s" : ""}`,
        },
      );
      await sendUserDM(targetUser, dmEmbed);
    }

    // Perform the ban
    await interaction.guild.members.ban(targetUser, {
      reason: reason,
      deleteMessageDays: deleteMessageDays,
    });

    // Send ephemeral success response
    const statusText = targetMember ? "in server" : "not in server";
    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "User Banned",
          `**User:** ${targetUser.tag} (${targetUser.id})\n**Status:** ${statusText}\n**Reason:** ${reason}\n**Message deletion:** ${deleteMessageDays} day${deleteMessageDays !== 1 ? "s" : ""}\n**Banned by:** ${interaction.user.tag}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });

    // Log the ban action
    await logModerationAction(
      interaction.client,
      interaction.guild,
      "bans",
      {
        action: "Ban",
        target: targetUser,
        moderator: interaction.user,
        reason: reason,
        additional: {
          status: statusText,
          messageDeletion: `${deleteMessageDays} day${deleteMessageDays !== 1 ? "s" : ""}`,
        },
      },
      {
        action: "🔨 User Banned",
        target: targetUser,
        moderator: interaction.user,
        message: `${targetUser.tag} has been banned from the server.`,
      },
    );
  } catch (error) {
    console.error("Error banning user:", error);

    let errorMessage =
      "An error occurred while trying to ban the user. Please try again.";
    if (error instanceof Error) {
      if (error.message.includes("Missing Permissions")) {
        errorMessage = "I don't have permission to ban this user.";
      } else if (error.message.includes("Unknown User")) {
        errorMessage = "The specified user could not be found.";
      }
    }

    await interaction.reply({
      embeds: [createEmbed(RED, "Ban Failed", errorMessage)],
      flags: MessageFlags.Ephemeral,
    });
  }
}
