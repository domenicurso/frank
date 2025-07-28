import { GREEN, RED, YELLOW } from "@/constants";
import { Warning } from "@/database";
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

export const name = "Warn";

export const definition = new SlashCommandBuilder()
  .setName("warn")
  .setDescription("Manage user warnings")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Add a warning to a user")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The user to warn")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Reason for the warning")
          .setRequired(true)
          .setMaxLength(1000),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("list")
      .setDescription("List warnings for a user")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The user to check warnings for")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("Remove a specific warning")
      .addIntegerOption((option) =>
        option
          .setName("warning_id")
          .setDescription("The ID of the warning to remove")
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("clear")
      .setDescription("Clear all warnings for a user")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The user to clear warnings for")
          .setRequired(true),
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

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "add":
      await handleAddWarning(interaction);
      break;
    case "list":
      await handleListWarnings(interaction);
      break;
    case "remove":
      await handleRemoveWarning(interaction);
      break;
    case "clear":
      await handleClearWarnings(interaction);
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

async function handleAddWarning(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);
  const executor = interaction.member as GuildMember;

  // Get the target member
  let targetMember: GuildMember;
  try {
    targetMember = await interaction.guild!.members.fetch(targetUser.id);
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

  // Check if user is trying to warn themselves
  if (targetUser.id === interaction.user.id) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Invalid Target", "You cannot warn yourself.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is the bot
  if (targetUser.id === interaction.client.user.id) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Invalid Target", "I cannot warn myself.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if target is the server owner
  if (targetUser.id === interaction.guild!.ownerId) {
    await interaction.reply({
      embeds: [
        createEmbed(RED, "Invalid Target", "You cannot warn the server owner."),
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
          "You cannot warn a member with equal or higher roles than you.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // Create the warning
    const warning = await Warning.create({
      userId: targetUser.id,
      guildId: interaction.guild!.id,
      moderatorId: interaction.user.id,
      reason: reason,
      timestamp: new Date(),
    });

    // Try to DM the user
    const dmEmbed = createModerationDMEmbed(
      "Warning",
      interaction.guild!.name,
      interaction.user,
      reason,
      {
        warningId: `#${warning.id}`,
        date: `<t:${Math.floor(warning.timestamp.getTime() / 1000)}:F>`,
      },
    );
    await sendUserDM(targetUser, dmEmbed);

    // Get user's total warnings count
    const userWarningsCount = await Warning.count({
      where: {
        userId: targetUser.id,
        guildId: interaction.guild!.id,
      },
    });

    // Send ephemeral success response
    const successEmbed = createEmbed(
      GREEN,
      "⚠️ Warning Added",
      `${targetUser.tag} has received a warning.`,
    );

    successEmbed.addFields(
      {
        name: "Target User",
        value: `${targetUser.toString()}\n**ID:** ${targetUser.id}`,
        inline: true,
      },
      {
        name: "Warning ID",
        value: `#${warning.id}`,
        inline: true,
      },
      {
        name: "Warned by",
        value: interaction.user.toString(),
        inline: true,
      },
      {
        name: "Total Warnings",
        value: userWarningsCount.toString(),
        inline: true,
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

    // Send additional notice if user has multiple warnings
    if (userWarningsCount >= 3) {
      await interaction.followUp({
        embeds: [
          createEmbed(
            YELLOW,
            "Multiple Warnings Notice",
            `${targetUser.tag} now has **${userWarningsCount}** warnings. Consider taking further action.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Log the warning action
    await logModerationAction(
      interaction.client,
      interaction.guild!,
      "warnings",
      {
        action: "Warning Added",
        target: targetUser,
        moderator: interaction.user,
        reason: reason,
        additional: {
          warningId: `#${warning.id}`,
          totalWarnings: userWarningsCount,
        },
      },
      {
        action: "⚠️ User Warned",
        target: targetUser,
        moderator: interaction.user,
        message: `${targetUser.tag} has received a warning (Total: ${userWarningsCount}).`,
      },
    );
  } catch (error) {
    console.error("Error adding warning:", error);
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Warning Failed",
          "An error occurred while trying to add the warning. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleListWarnings(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser("user", true);

  // Get warnings for the user in this guild
  const userWarnings = await Warning.findAll({
    where: {
      userId: targetUser.id,
      guildId: interaction.guild!.id,
    },
    order: [["timestamp", "DESC"]], // Sort by timestamp (newest first)
    limit: 10, // Limit to 10 most recent
  });

  if (userWarnings.length === 0) {
    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "No Warnings",
          `${targetUser.tag} has no warnings in this server.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Get total count for display
  const totalWarnings = await Warning.count({
    where: {
      userId: targetUser.id,
      guildId: interaction.guild!.id,
    },
  });

  // Create warning list
  const warningList = userWarnings
    .map((warning) => {
      const timestamp = Math.floor(warning.timestamp.getTime() / 1000);
      return `**#${warning.id}** - <t:${timestamp}:R>\n**Moderator:** <@${warning.moderatorId}>\n**Reason:** ${warning.reason.length > 100 ? warning.reason.substring(0, 100) + "..." : warning.reason}`;
    })
    .join("\n\n");

  let description = `**Total Warnings:** ${totalWarnings}\n\n${warningList}`;

  if (totalWarnings > 10) {
    description += `\n\n*Showing 10 most recent warnings*`;
  }

  const listEmbed = createEmbed(
    YELLOW,
    `⚠️ Warnings for ${targetUser.tag}`,
    `This user has **${totalWarnings}** warning${totalWarnings !== 1 ? "s" : ""} in this server.`,
  );

  listEmbed.addFields({
    name: "Warning History",
    value: warningList,
    inline: false,
  });

  if (totalWarnings > 10) {
    listEmbed.addFields({
      name: "Note",
      value: "*Showing 10 most recent warnings*",
      inline: false,
    });
  }

  listEmbed.setThumbnail(targetUser.displayAvatarURL());

  await interaction.reply({
    embeds: [listEmbed],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRemoveWarning(interaction: ChatInputCommandInteraction) {
  const warningId = interaction.options.getInteger("warning_id", true);

  // Find the warning
  const warning = await Warning.findOne({
    where: {
      id: warningId,
      guildId: interaction.guild!.id,
    },
  });

  if (!warning) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Warning Not Found",
          `Warning #${warningId} was not found in this server.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetUser = await interaction.client.users.fetch(warning.userId);

  // Check role hierarchy for the warned user
  try {
    const targetMember = await interaction.guild!.members.fetch(warning.userId);
    const executor = interaction.member as GuildMember;

    if (
      targetMember.roles.highest.position >= executor.roles.highest.position
    ) {
      await interaction.reply({
        embeds: [
          createEmbed(
            RED,
            "Insufficient Permissions",
            "You cannot remove warnings from a member with equal or higher roles than you.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } catch (error) {
    // User might not be in server anymore, allow removal
  }

  // Remove the warning
  await warning.destroy();

  const removeEmbed = createEmbed(
    GREEN,
    "⚠️ Warning Removed",
    `Warning #${warningId} has been successfully removed.`,
  );

  removeEmbed.addFields(
    {
      name: "Target User",
      value: targetUser.toString(),
      inline: true,
    },
    {
      name: "Warning ID",
      value: `#${warningId}`,
      inline: true,
    },
    {
      name: "Removed by",
      value: interaction.user.toString(),
      inline: true,
    },
    {
      name: "Original Reason",
      value: warning.reason,
      inline: false,
    },
  );

  removeEmbed.setThumbnail(targetUser.displayAvatarURL());

  await interaction.reply({
    embeds: [removeEmbed],
    flags: MessageFlags.Ephemeral,
  });

  // Log the warning removal
  await logModerationAction(
    interaction.client,
    interaction.guild!,
    "warnings",
    {
      action: "Warning Removed",
      target: targetUser,
      moderator: interaction.user,
      reason: `Removed warning #${warningId}`,
      additional: {
        warningId: `#${warningId}`,
        originalReason: warning.reason,
      },
    },
  );
}

async function handleClearWarnings(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser("user", true);
  const executor = interaction.member as GuildMember;

  // Check role hierarchy
  try {
    const targetMember = await interaction.guild!.members.fetch(targetUser.id);

    if (
      targetMember.roles.highest.position >= executor.roles.highest.position
    ) {
      await interaction.reply({
        embeds: [
          createEmbed(
            RED,
            "Insufficient Permissions",
            "You cannot clear warnings from a member with equal or higher roles than you.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } catch (error) {
    // User might not be in server anymore, allow clearing
  }

  // Count warnings to be cleared
  const warningsCount = await Warning.count({
    where: {
      userId: targetUser.id,
      guildId: interaction.guild!.id,
    },
  });

  if (warningsCount === 0) {
    await interaction.reply({
      embeds: [
        createEmbed(
          YELLOW,
          "No Warnings",
          `${targetUser.tag} has no warnings to clear in this server.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Remove all warnings for the user in this guild
  await Warning.destroy({
    where: {
      userId: targetUser.id,
      guildId: interaction.guild!.id,
    },
  });

  const clearEmbed = createEmbed(
    GREEN,
    "⚠️ Warnings Cleared",
    `All warnings have been cleared for ${targetUser.tag}.`,
  );

  clearEmbed.addFields(
    {
      name: "Target User",
      value: targetUser.toString(),
      inline: true,
    },
    {
      name: "Warnings Cleared",
      value: warningsCount.toString(),
      inline: true,
    },
    {
      name: "Cleared by",
      value: interaction.user.toString(),
      inline: true,
    },
  );

  clearEmbed.setThumbnail(targetUser.displayAvatarURL());

  await interaction.reply({
    embeds: [clearEmbed],
    flags: MessageFlags.Ephemeral,
  });

  // Log the warning clearing
  await logModerationAction(
    interaction.client,
    interaction.guild!,
    "warnings",
    {
      action: "All Warnings Cleared",
      target: targetUser,
      moderator: interaction.user,
      reason: "All warnings cleared",
      additional: {
        warningsCleared: warningsCount,
      },
    },
    {
      action: "⚠️ Warnings Cleared",
      target: targetUser,
      moderator: interaction.user,
      message: `All warnings (${warningsCount}) have been cleared for ${targetUser.tag}.`,
    },
  );
}
