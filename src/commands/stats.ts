import { BLUE, RED, YELLOW } from "@/constants";
import {
  getGuildStats,
  getTopCommandUsers,
  getTopMessageUsers,
  getUserStats,
} from "@/database/userStats";
import { createEmbed } from "@/utils/embeds";
import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

export const name = "Stats";

export const definition = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("View user and guild statistics")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("user")
      .setDescription("View your own stats or another user's stats")
      .addUserOption((option) =>
        option
          .setName("target")
          .setDescription("The user to view stats for (defaults to yourself)")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("guild").setDescription("View guild-wide statistics"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("leaderboard")
      .setDescription("View leaderboards")
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("Type of leaderboard")
          .setRequired(true)
          .addChoices(
            { name: "Commands Used", value: "commands" },
            { name: "Messages Sent", value: "messages" },
          ),
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
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "user":
      await handleUserStats(interaction);
      break;
    case "guild":
      await handleGuildStats(interaction);
      break;
    case "leaderboard":
      await handleLeaderboard(interaction);
      break;
    default:
      await interaction.reply({
        embeds: [createEmbed(RED, "Unknown Subcommand", "Unknown subcommand!")],
        ephemeral: true,
      });
  }
}

async function handleUserStats(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser("target") || interaction.user;
  const guildId = interaction.guild!.id;

  await interaction.deferReply();

  try {
    const userStats = await getUserStats(targetUser.id, guildId);

    if (!userStats) {
      const embed = createEmbed(
        BLUE,
        `${targetUser.displayName}'s Stats`,
        "No activity recorded yet!",
      )
        .setThumbnail(targetUser.displayAvatarURL())
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(BLUE)
      .setTitle(`${targetUser.displayName}'s Stats`)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        {
          name: "Commands Used",
          value: userStats.commandsUsed.toLocaleString(),
          inline: true,
        },
        {
          name: "Messages Sent",
          value: userStats.messagesCount.toLocaleString(),
          inline: true,
        },
        {
          name: "Last Active",
          value: `<t:${Math.floor(userStats.lastActive.getTime() / 1000)}:R>`,
          inline: true,
        },
        {
          name: "First Seen",
          value: `<t:${Math.floor(userStats.createdAt.getTime() / 1000)}:D>`,
          inline: true,
        },
      )
      .setFooter({
        text: `User ID: ${targetUser.id}`,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching user stats:", error);
    await interaction.editReply({
      embeds: [
        createEmbed(
          RED,
          "Error",
          "An error occurred while fetching user stats.",
        ),
      ],
    });
  }
}

async function handleGuildStats(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guild!.id;
  const guild = interaction.guild!;

  await interaction.deferReply();

  try {
    const guildStats = await getGuildStats(guildId);

    const embed = new EmbedBuilder()
      .setColor(BLUE)
      .setTitle(`${guild.name} Statistics`)
      .setThumbnail(guild.iconURL())
      .addFields(
        {
          name: "Active Users",
          value: guildStats.totalUsers.toLocaleString(),
          inline: true,
        },
        {
          name: "Total Commands",
          value: guildStats.totalCommands.toLocaleString(),
          inline: true,
        },
        {
          name: "Total Messages",
          value: guildStats.totalMessages.toLocaleString(),
          inline: true,
        },
        {
          name: "Guild Members",
          value: guild.memberCount?.toLocaleString() || "Unknown",
          inline: true,
        },
        {
          name: "Guild Created",
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
          inline: true,
        },
      )
      .setFooter({
        text: `Guild ID: ${guildId}`,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching guild stats:", error);
    await interaction.editReply({
      embeds: [
        createEmbed(
          RED,
          "Error",
          "An error occurred while fetching guild stats.",
        ),
      ],
    });
  }
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction) {
  const type = interaction.options.getString("type", true);
  const limit = 10;
  const guildId = interaction.guild!.id;
  const guild = interaction.guild!;

  await interaction.deferReply();

  try {
    let users: any[];
    let title: string;
    let emoji: string;
    let valueKey: string;

    if (type === "commands") {
      users = await getTopCommandUsers(guildId, limit);
      title = "Command Usage Leaderboard";
      emoji = "";
      valueKey = "commandsUsed";
    } else {
      users = await getTopMessageUsers(guildId, limit);
      title = "Message Count Leaderboard";
      emoji = "";
      valueKey = "messagesCount";
    }

    if (users.length === 0) {
      const embed = createEmbed(
        YELLOW,
        title,
        "No data available yet!",
      ).setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const leaderboardText = users
      .map((user, index) => {
        const position = index + 1;
        const value = user[valueKey].toLocaleString();
        return `${position}. <@${user.userId}> - **${value}**`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(BLUE)
      .setTitle(title)
      .setDescription(leaderboardText)
      .setThumbnail(guild.iconURL())
      .setFooter({
        text: `Showing top ${users.length} users`,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    await interaction.editReply({
      embeds: [
        createEmbed(
          RED,
          "Error",
          "An error occurred while fetching the leaderboard.",
        ),
      ],
    });
  }
}
