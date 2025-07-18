import { GREEN, RED, YELLOW } from "@/constants";
import { createEmbed } from "@/utils/embeds";
import { logModerationAction } from "@/utils/moderation";
import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";

export const name = "Clear";

export const definition = new SlashCommandBuilder()
  .setName("clear")
  .setDescription("Delete multiple messages from the channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption((option) =>
    option
      .setName("amount")
      .setDescription("Number of messages to delete (1-100)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100),
  )
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("Only delete messages from this user")
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("reason")
      .setDescription("Reason for clearing messages")
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

  if (!interaction.channel || !(interaction.channel instanceof TextChannel)) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Invalid Channel",
          "This command can only be used in text channels.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const amount = interaction.options.getInteger("amount", true);
  const targetUser = interaction.options.getUser("user");
  const reason =
    interaction.options.getString("reason") || "No reason provided";
  const executor = interaction.member as GuildMember;
  const channel = interaction.channel as TextChannel;

  // Check if bot has permission to manage messages
  const botMember = await interaction.guild.members.fetch(
    interaction.client.user.id,
  );
  if (
    !channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageMessages)
  ) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Bot Missing Permissions",
          "I don't have permission to manage messages in this channel.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // If targeting a specific user, check role hierarchy
  if (targetUser) {
    let targetMember: GuildMember | null = null;
    try {
      targetMember = await interaction.guild.members.fetch(targetUser.id);
    } catch (error) {
      // User might not be in the server anymore, but we can still delete their messages
    }

    if (targetMember) {
      // Check if user can moderate the target
      if (
        targetMember.roles.highest.position >=
          executor.roles.highest.position &&
        targetUser.id !== interaction.user.id
      ) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Insufficient Permissions",
              "You cannot clear messages from a member with equal or higher roles than you.",
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check if bot can moderate the target
      if (
        targetMember.roles.highest.position >= botMember.roles.highest.position
      ) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Bot Insufficient Permissions",
              "I cannot clear messages from a member with equal or higher roles than me.",
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Fetch messages to delete
    let messagesToDelete;

    if (targetUser) {
      // Fetch more messages to filter by user
      const fetchLimit = Math.min(amount * 5, 500); // Fetch more to account for filtering
      const messages = await channel.messages.fetch({ limit: fetchLimit });

      const filteredMessages = messages.filter(
        (msg) => msg.author.id === targetUser.id,
      );
      messagesToDelete = filteredMessages.first(amount);
    } else {
      // Fetch the exact amount
      const allMessages = await channel.messages.fetch({ limit: amount });
      messagesToDelete = Array.from(allMessages.values());
    }

    if (messagesToDelete.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed(
            YELLOW,
            "No Messages Found",
            targetUser
              ? `No messages found from ${targetUser.tag} in the recent message history.`
              : "No messages found to delete.",
          ),
        ],
      });
      return;
    }

    // Filter out messages older than 14 days (Discord limitation)
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentMessages = messagesToDelete.filter(
      (msg) => msg.createdTimestamp > twoWeeksAgo,
    );

    if (recentMessages.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed(
            YELLOW,
            "Messages Too Old",
            "All found messages are older than 14 days and cannot be bulk deleted.",
          ),
        ],
      });
      return;
    }

    // Delete messages
    let deletedCount = 0;
    if (recentMessages.length === 1) {
      // Delete single message individually
      await recentMessages[0]?.delete();
      deletedCount = 1;
    } else {
      // Bulk delete
      const deleted = await channel.bulkDelete(recentMessages, true);
      deletedCount = deleted.size;
    }

    // Send success response
    const skippedCount = messagesToDelete.length - deletedCount;
    let description = `Successfully deleted **${deletedCount}** message${deletedCount !== 1 ? "s" : ""}`;

    if (targetUser) {
      description += ` from **${targetUser.tag}**`;
    }

    description += ` in ${channel}.`;

    if (skippedCount > 0) {
      description += `\n\n**Note:** ${skippedCount} message${skippedCount !== 1 ? "s were" : " was"} skipped (older than 14 days).`;
    }

    description += `\n**Reason:** ${reason}\n**Cleared by:** ${interaction.user.tag}`;

    await interaction.editReply({
      embeds: [createEmbed(GREEN, "Messages Cleared", description)],
    });

    // Log the message deletion action
    await logModerationAction(
      interaction.client,
      interaction.guild,
      "message_deletes",
      {
        action: "Messages Cleared",
        target: targetUser || interaction.user,
        moderator: interaction.user,
        reason: reason,
        additional: {
          channel: channel.toString(),
          messagesDeleted: deletedCount,
          ...(skippedCount > 0 && { messagesSkipped: skippedCount }),
          ...(targetUser && { targetUser: targetUser.tag }),
        },
      },
      {
        action: "🗑️ Messages Cleared",
        moderator: interaction.user,
        message: `${deletedCount} message${deletedCount !== 1 ? "s" : ""} cleared in ${channel}${targetUser ? ` from ${targetUser.tag}` : ""}.`,
      },
    );

    // Send a public confirmation message that will auto-delete
    const publicConfirmation = await channel.send({
      embeds: [
        createEmbed(
          GREEN,
          "Messages Cleared",
          `${deletedCount} message${deletedCount !== 1 ? "s" : ""} deleted by ${interaction.user.tag}`,
        ),
      ],
    });

    // Delete the confirmation message after 5 seconds
    setTimeout(async () => {
      try {
        await publicConfirmation.delete();
      } catch (error) {
        // Message might already be deleted, ignore error
      }
    }, 5000);
  } catch (error) {
    console.error("Error clearing messages:", error);

    let errorMessage =
      "An error occurred while trying to clear messages. Please try again.";
    if (error instanceof Error) {
      if (error.message.includes("Missing Permissions")) {
        errorMessage =
          "I don't have permission to delete messages in this channel.";
      } else if (error.message.includes("Unknown Message")) {
        errorMessage =
          "Some messages could not be found or were already deleted.";
      }
    }

    await interaction.editReply({
      embeds: [createEmbed(RED, "Clear Failed", errorMessage)],
    });
  }
}
