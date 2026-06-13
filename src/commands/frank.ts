import { BLUE, GREEN, RED } from "@/constants";
import { getGuildConfig, updateGuildConfig } from "@/database";
import { createEmbed } from "@/utils/embeds";
import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const name = "Frank";

export const definition = new SlashCommandBuilder()
  .setName("frank")
  .setDescription("Control Frank behavior")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand.setName("view").setDescription("View Frank settings"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("attention")
      .setDescription("Set Frank's attention mode")
      .addStringOption((option) =>
        option
          .setName("mode")
          .setDescription("How proactively Frank joins conversations")
          .setRequired(true)
          .addChoices(
            { name: "Conversation Aware", value: "conversation-aware" },
            { name: "Opportunistic", value: "opportunistic" },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("opportunism")
      .setDescription("Set how often Frank jumps into ambient chat")
      .addIntegerOption((option) =>
        option
          .setName("level")
          .setDescription("0-100")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(100),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("reactions")
      .setDescription("Enable or disable Frank reactions")
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Whether Frank can react")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("burst-cap")
      .setDescription("Set Frank's max burst message count")
      .addIntegerOption((option) =>
        option
          .setName("count")
          .setDescription("1-5")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(5),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Guild Only", "Use this command in a server.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Insufficient Permissions",
          "You need Manage Server to configure Frank.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "view") {
    const config = await getGuildConfig(interaction.guild.id);
    await interaction.reply({
      embeds: [
        createEmbed(
          BLUE,
          "Frank Settings",
          [
            `Attention mode: ${config?.attentionMode ?? "conversation-aware"}`,
            `Opportunism: ${config?.opportunismLevel ?? 15}`,
            `Reactions: ${(config?.reactionsEnabled ?? true) ? "enabled" : "disabled"}`,
            `Burst cap: ${config?.maxBurstMessages ?? 5}`,
            `Mentions: ${(config?.allowedMentions ?? true) ? "enabled" : "disabled"}`,
            `Replies: ${(config?.allowedReplies ?? true) ? "enabled" : "disabled"}`,
          ].join("\n"),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "attention") {
    const mode = interaction.options.getString("mode", true);
    await updateGuildConfig(interaction.guild.id, {
      attentionMode: mode,
    });
    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Attention Updated",
          `Frank is now in \`${mode}\` mode.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "opportunism") {
    const level = interaction.options.getInteger("level", true);
    await updateGuildConfig(interaction.guild.id, {
      opportunismLevel: level,
    });
    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Opportunism Updated",
          `Frank opportunism is now \`${level}\`.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "reactions") {
    const enabled = interaction.options.getBoolean("enabled", true);
    await updateGuildConfig(interaction.guild.id, {
      reactionsEnabled: enabled,
    });
    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Reaction Behavior Updated",
          `Frank reactions are now ${enabled ? "enabled" : "disabled"}.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "burst-cap") {
    const count = interaction.options.getInteger("count", true);
    await updateGuildConfig(interaction.guild.id, {
      maxBurstMessages: count,
      burstResponsesEnabled: count > 1,
    });
    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Burst Cap Updated",
          `Frank can now send up to ${count} messages per burst.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
