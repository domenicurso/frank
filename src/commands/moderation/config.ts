import { BLUE, GREEN, RED } from "@/constants";
import { getGuildConfig, updateGuildConfig } from "@/database";
import { createEmbed } from "@/utils/embeds";
import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";

export const name = "Config";

export const definition = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure server moderation settings")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("view")
      .setDescription("View current server configuration"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("modchannel")
      .setDescription("Set the private mod log channel")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("The channel for private mod logs")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("publicmodchannel")
      .setDescription("Set the public mod notifications channel")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("The channel for public mod notifications")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("logging")
      .setDescription("Configure what actions to log")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("The action to configure logging for")
          .setRequired(true)
          .addChoices(
            { name: "Bans", value: "bans" },
            { name: "Kicks", value: "kicks" },
            { name: "Timeouts", value: "timeouts" },
            { name: "Warnings", value: "warnings" },
            { name: "Channel Locks", value: "channel_locks" },
            { name: "Message Deletes", value: "message_deletes" },
          ),
      )
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Whether to log this action")
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

  // Check if user has manage guild permission
  const member = interaction.member as GuildMember;
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Insufficient Permissions",
          "You need the 'Manage Server' permission to use this command.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "view":
      await handleViewConfig(interaction);
      break;
    case "modchannel":
      await handleSetModChannel(interaction);
      break;
    case "publicmodchannel":
      await handleSetPublicModChannel(interaction);
      break;
    case "logging":
      await handleConfigureLogging(interaction);
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

async function handleViewConfig(interaction: ChatInputCommandInteraction) {
  const config = await getGuildConfig(interaction.guild!.id);

  if (!config) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Configuration Error",
          "Failed to load server configuration. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let description = "";
  description += `**Private Mod Channel:** ${
    config.modChannelId ? `<#${config.modChannelId}>` : "Not set"
  }\n`;
  description += `**Public Mod Channel:** ${
    config.publicModChannelId ? `<#${config.publicModChannelId}>` : "Not set"
  }\n`;
  description += `**Bans:** ${config.logBans ? "✅" : "❌"}\n`;
  description += `**Kicks:** ${config.logKicks ? "✅" : "❌"}\n`;
  description += `**Timeouts:** ${config.logTimeouts ? "✅" : "❌"}\n`;
  description += `**Warnings:** ${config.logWarnings ? "✅" : "❌"}\n`;
  description += `**Channel Locks:** ${config.logChannelLocks ? "✅" : "❌"}\n`;
  description += `**Message Deletes:** ${config.logMessageDeletes ? "✅" : "❌"}\n`;

  await interaction.reply({
    embeds: [createEmbed(BLUE, "Server Configuration", description)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetModChannel(interaction: ChatInputCommandInteraction) {
  const channel = interaction.options.getChannel("channel");

  if (!channel) {
    // Clear the mod channel
    const success = await updateGuildConfig(interaction.guild!.id, {
      modChannelId: null,
    });

    if (!success) {
      await interaction.reply({
        embeds: [
          createEmbed(
            RED,
            "Configuration Error",
            "Failed to update configuration. Please try again.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Configuration Updated",
          "Private mod log channel has been cleared.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!(channel instanceof TextChannel)) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Invalid Channel",
          "Please select a text channel for mod logs.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if bot can send messages in this channel
  const botMember = await interaction.guild!.members.fetch(
    interaction.client.user.id,
  );
  if (
    !channel
      .permissionsFor(botMember)
      ?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
  ) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Invalid Channel",
          "I don't have permission to send messages or embed links in that channel.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const success = await updateGuildConfig(interaction.guild!.id, {
    modChannelId: channel.id,
  });

  if (!success) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Configuration Error",
          "Failed to update configuration. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      createEmbed(
        GREEN,
        "Configuration Updated",
        `Private mod log channel set to ${channel}.`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });

  // Send a test message to the mod channel
  try {
    await channel.send({
      embeds: [
        createEmbed(
          BLUE,
          "Mod Channel Configured",
          `This channel has been set as the private mod log channel by ${interaction.user.tag}.`,
        ),
      ],
    });
  } catch (error) {
    // Ignore errors sending test message
  }
}

async function handleSetPublicModChannel(
  interaction: ChatInputCommandInteraction,
) {
  const channel = interaction.options.getChannel("channel");

  if (!channel) {
    // Clear the public mod channel
    const success = await updateGuildConfig(interaction.guild!.id, {
      publicModChannelId: null,
    });

    if (!success) {
      await interaction.reply({
        embeds: [
          createEmbed(
            RED,
            "Configuration Error",
            "Failed to update configuration. Please try again.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Configuration Updated",
          "Public mod notifications channel has been cleared.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!(channel instanceof TextChannel)) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Invalid Channel",
          "Please select a text channel for public mod notifications.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if bot can send messages in this channel
  const botMember = await interaction.guild!.members.fetch(
    interaction.client.user.id,
  );
  if (
    !channel
      .permissionsFor(botMember)
      ?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
  ) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Invalid Channel",
          "I don't have permission to send messages or embed links in that channel.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const success = await updateGuildConfig(interaction.guild!.id, {
    publicModChannelId: channel.id,
  });

  if (!success) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Configuration Error",
          "Failed to update configuration. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      createEmbed(
        GREEN,
        "Configuration Updated",
        `Public mod notifications channel set to ${channel}.`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });

  // Send a test message to the public mod channel
  try {
    await channel.send({
      embeds: [
        createEmbed(
          BLUE,
          "Public Mod Channel Configured",
          `This channel has been set as the public mod notifications channel by ${interaction.user.tag}.`,
        ),
      ],
    });
  } catch (error) {
    // Ignore errors sending test message
  }
}

async function handleConfigureLogging(
  interaction: ChatInputCommandInteraction,
) {
  const action = interaction.options.getString("action", true);
  const enabled = interaction.options.getBoolean("enabled", true);

  const actionMap: Record<string, keyof typeof updateObject> = {
    bans: "logBans",
    kicks: "logKicks",
    timeouts: "logTimeouts",
    warnings: "logWarnings",
    channel_locks: "logChannelLocks",
    message_deletes: "logMessageDeletes",
  };

  const updateObject = {
    logBans: enabled,
    logKicks: enabled,
    logTimeouts: enabled,
    logWarnings: enabled,
    logChannelLocks: enabled,
    logMessageDeletes: enabled,
  };

  const configKey = actionMap[action];
  if (!configKey) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Invalid Action", "Invalid action specified.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const success = await updateGuildConfig(interaction.guild!.id, {
    [configKey]: enabled,
  });

  if (!success) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Configuration Error",
          "Failed to update configuration. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const actionName = action
    .replace("_", " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
  const status = enabled ? "enabled" : "disabled";

  await interaction.reply({
    embeds: [
      createEmbed(
        GREEN,
        "Configuration Updated",
        `${actionName} logging has been ${status}.`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
