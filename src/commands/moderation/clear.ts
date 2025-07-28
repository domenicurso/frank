import { GREEN, RED, YELLOW } from "@/constants";
import { createEmbed } from "@/utils/embeds";
import { logModerationAction } from "@/utils/moderation";
import {
  ChatInputCommandInteraction,
  GuildMember,
  Message,
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
      .setDescription("Number of messages to delete (1-1000)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(1000),
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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Collect all messages to delete
    let allMessagesToDelete: Message[] = [];
    let totalFetched = 0;
    let lastMessageId: string | undefined;
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

    // Update progress for large operations
    if (amount > 100) {
      await interaction.editReply({
        embeds: [
          createEmbed(
            YELLOW,
            "Collecting Messages",
            `Fetching messages to delete... This may take a moment for large amounts.`,
          ),
        ],
      });
    }

    // Fetch messages in batches
    while (allMessagesToDelete.length < amount && totalFetched < amount * 3) {
      const batchSize = Math.min(100, amount * 2); // Fetch in reasonable batches
      const fetchOptions: { limit: number; before?: string } = {
        limit: batchSize,
      };
      if (lastMessageId) {
        fetchOptions.before = lastMessageId;
      }

      const messages = await channel.messages.fetch(fetchOptions);
      if (messages.size === 0) break; // No more messages

      const messageArray = Array.from(messages.values());
      lastMessageId = messageArray[messageArray.length - 1]?.id;
      totalFetched += messages.size;

      if (targetUser) {
        // Filter by target user
        const filteredMessages = messageArray.filter(
          (msg) =>
            msg.author.id === targetUser.id &&
            msg.createdTimestamp > twoWeeksAgo,
        );
        allMessagesToDelete.push(...filteredMessages);
      } else {
        // Add all recent messages
        const recentMessages = messageArray.filter(
          (msg) => msg.createdTimestamp > twoWeeksAgo,
        );
        allMessagesToDelete.push(...recentMessages);
      }

      // Break if we have enough messages or if we fetched less than requested (end of channel)
      if (allMessagesToDelete.length >= amount || messages.size < batchSize) {
        break;
      }
    }

    // Trim to exact amount requested
    allMessagesToDelete = allMessagesToDelete.slice(0, amount);

    if (allMessagesToDelete.length === 0) {
      await interaction.editReply({
        embeds: [
          createEmbed(
            YELLOW,
            "No Messages Found",
            targetUser
              ? `No recent messages found from ${targetUser.tag}.`
              : "No recent messages found to delete.",
          ),
        ],
      });
      return;
    }

    // Delete messages in batches of 100 (Discord's bulk delete limit)
    let totalDeletedCount = 0;
    const batches = [];

    // Split messages into batches of 100
    for (let i = 0; i < allMessagesToDelete.length; i += 100) {
      batches.push(allMessagesToDelete.slice(i, i + 100));
    }

    // Update progress for multiple batches
    if (batches.length > 1) {
      await interaction.editReply({
        embeds: [
          createEmbed(
            YELLOW,
            "Deleting Messages",
            `Deleting messages in ${batches.length} batch${batches.length !== 1 ? "es" : ""}... (0/${batches.length} completed)`,
          ),
        ],
      });
    }

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (!batch || batch.length === 0) continue;

      try {
        if (batch.length === 1) {
          // Delete single message individually
          await batch[0]?.delete();
          totalDeletedCount += 1;
        } else {
          // Bulk delete
          const deleted = await channel.bulkDelete(batch, true);
          totalDeletedCount += deleted.size;
        }

        // Update progress for multi-batch operations
        if (batches.length > 1 && i < batches.length - 1) {
          await interaction.editReply({
            embeds: [
              createEmbed(
                YELLOW,
                "Deleting Messages",
                `Deleting messages in ${batches.length} batch${batches.length !== 1 ? "es" : ""}... (${i + 1}/${batches.length} completed)`,
              ),
            ],
          });
        }

        // Add a small delay between batches to avoid rate limits
        if (i < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Error deleting batch ${i + 1}:`, error);
        // Continue with other batches even if one fails
      }
    }

    const skippedCount = allMessagesToDelete.length - totalDeletedCount;
    const deletedCount = totalDeletedCount;

    // Send success response
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
        action: `Messages Cleared in ${channel.name}`,
        target: targetUser || interaction.user,
        moderator: interaction.user,
        reason: reason,
        additional: {
          channel: channel.toString(),
          messagesDeleted: deletedCount,
          ...(skippedCount > 0 && { messagesSkipped: skippedCount }),
          ...(targetUser && { targetFrom: targetUser.tag }),
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
