import { BLUE, GREEN, RED, YELLOW } from "@/constants";
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
  .setDescription("Configure AI settings for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand.setName("view").setDescription("View current AI configuration"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("mentions")
      .setDescription("Configure AI mention responses")
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Whether AI responds to mentions")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("replies")
      .setDescription("Configure AI reply responses")
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Whether AI responds to replies")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("whitelist")
      .setDescription("Manage channel whitelist")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Action to perform")
          .setRequired(true)
          .addChoices(
            { name: "Add Channel", value: "add" },
            { name: "Remove Channel", value: "remove" },
            { name: "Clear All", value: "clear" },
            { name: "List Channels", value: "list" },
          ),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Channel to add/remove")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("blacklist")
      .setDescription("Manage channel blacklist")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Action to perform")
          .setRequired(true)
          .addChoices(
            { name: "Add Channel", value: "add" },
            { name: "Remove Channel", value: "remove" },
            { name: "Clear All", value: "clear" },
            { name: "List Channels", value: "list" },
          ),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Channel to add/remove")
          .setRequired(false),
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
    case "cooldown":
      await handleSetCooldown(interaction);
      break;
    case "mentions":
      await handleSetMentions(interaction);
      break;
    case "replies":
      await handleSetReplies(interaction);
      break;
    case "whitelist":
      await handleWhitelist(interaction);
      break;
    case "blacklist":
      await handleBlacklist(interaction);
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
          "Failed to load AI configuration. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Parse channel lists
  const whitelistedChannels = config.whitelistedChannels
    ? (JSON.parse(config.whitelistedChannels) as string[])
    : [];
  const blacklistedChannels = config.blacklistedChannels
    ? (JSON.parse(config.blacklistedChannels) as string[])
    : [];

  let description = "";
  description += `**Cooldown Duration:** ${config.cooldownDuration} seconds\n`;
  description += `**Responds to Mentions:** ${config.allowedMentions ? "✅" : "❌"}\n`;
  description += `**Responds to Replies:** ${config.allowedReplies ? "✅" : "❌"}\n\n`;

  // Show channel filtering mode (whitelist and blacklist are mutually exclusive)
  if (whitelistedChannels.length > 0) {
    description += `**Channel Mode:** Whitelist (only responds in specific channels)\n`;
    description += `**Whitelisted Channels:** ${whitelistedChannels.map((id) => `<#${id}>`).join(", ")}\n`;
    description += `**Blacklisted Channels:** Disabled (whitelist is active)\n`;
  } else if (blacklistedChannels.length > 0) {
    description += `**Channel Mode:** Blacklist (avoids specific channels)\n`;
    description += `**Whitelisted Channels:** Disabled (blacklist is active)\n`;
    description += `**Blacklisted Channels:** ${blacklistedChannels.map((id) => `<#${id}>`).join(", ")}\n`;
  } else {
    description += `**Channel Mode:** All channels (no restrictions)\n`;
    description += `**Whitelisted Channels:** None\n`;
    description += `**Blacklisted Channels:** None\n`;
  }

  await interaction.reply({
    embeds: [createEmbed(BLUE, "AI Configuration", description)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetCooldown(interaction: ChatInputCommandInteraction) {
  const seconds = interaction.options.getInteger("seconds", true);

  const success = await updateGuildConfig(interaction.guild!.id, {
    cooldownDuration: seconds,
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
        `AI response cooldown set to ${seconds} seconds.`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetMentions(interaction: ChatInputCommandInteraction) {
  const enabled = interaction.options.getBoolean("enabled", true);

  const success = await updateGuildConfig(interaction.guild!.id, {
    allowedMentions: enabled,
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
        `AI responses to mentions have been ${enabled ? "enabled" : "disabled"}.`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetReplies(interaction: ChatInputCommandInteraction) {
  const enabled = interaction.options.getBoolean("enabled", true);

  const success = await updateGuildConfig(interaction.guild!.id, {
    allowedReplies: enabled,
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
        `AI responses to replies have been ${enabled ? "enabled" : "disabled"}.`,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleWhitelist(interaction: ChatInputCommandInteraction) {
  const action = interaction.options.getString("action", true);
  const channel = interaction.options.getChannel("channel");

  const config = await getGuildConfig(interaction.guild!.id);
  if (!config) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Configuration Error",
          "Failed to load configuration. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let whitelistedChannels = config.whitelistedChannels
    ? (JSON.parse(config.whitelistedChannels) as string[])
    : [];
  let blacklistedChannels = config.blacklistedChannels
    ? (JSON.parse(config.blacklistedChannels) as string[])
    : [];
  let blacklistCleared = false;

  switch (action) {
    case "add":
      if (!channel || !(channel instanceof TextChannel)) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Invalid Channel",
              "Please select a valid text channel to add to the whitelist.",
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (whitelistedChannels.includes(channel.id)) {
        await interaction.reply({
          embeds: [
            createEmbed(
              YELLOW,
              "Already Whitelisted",
              `${channel} is already in the whitelist.`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      whitelistedChannels.push(channel.id);

      // Clear blacklist when adding to whitelist to avoid conflicts
      if (blacklistedChannels.length > 0) {
        blacklistedChannels = [];
        blacklistCleared = true;
      }
      break;

    case "remove":
      if (!channel || !(channel instanceof TextChannel)) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Invalid Channel",
              "Please select a valid text channel to remove from the whitelist.",
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!whitelistedChannels.includes(channel.id)) {
        await interaction.reply({
          embeds: [
            createEmbed(
              YELLOW,
              "Not Whitelisted",
              `${channel} is not in the whitelist.`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      whitelistedChannels = whitelistedChannels.filter(
        (id) => id !== channel.id,
      );
      break;

    case "clear":
      whitelistedChannels = [];
      break;

    case "list":
      if (whitelistedChannels.length === 0) {
        await interaction.reply({
          embeds: [
            createEmbed(
              BLUE,
              "Channel Whitelist",
              "No channels are whitelisted. AI responds in all channels (or only avoids blacklisted channels if blacklist is set).",
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const channelList = whitelistedChannels
        .map((id) => `<#${id}>`)
        .join("\n");
      await interaction.reply({
        embeds: [
          createEmbed(
            BLUE,
            "Channel Whitelist",
            `AI only responds in these channels (blacklist is disabled when whitelist is active):\n\n${channelList}`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
  }

  const success = await updateGuildConfig(interaction.guild!.id, {
    whitelistedChannels:
      whitelistedChannels.length > 0
        ? JSON.stringify(whitelistedChannels)
        : null,
    blacklistedChannels:
      blacklistedChannels.length > 0
        ? JSON.stringify(blacklistedChannels)
        : null,
  });

  if (!success) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Configuration Error",
          "Failed to update whitelist. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let message = "";
  switch (action) {
    case "add":
      message = `${channel} has been added to the whitelist.${
        blacklistCleared
          ? " The blacklist has been cleared to avoid conflicts."
          : ""
      }`;
      break;
    case "remove":
      message = `${channel} has been removed from the whitelist.`;
      break;
    case "clear":
      message =
        "Channel whitelist has been cleared. AI now responds in all channels (unless blacklisted).";
      break;
  }

  await interaction.reply({
    embeds: [createEmbed(GREEN, "Whitelist Updated", message)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleBlacklist(interaction: ChatInputCommandInteraction) {
  const action = interaction.options.getString("action", true);
  const channel = interaction.options.getChannel("channel");

  const config = await getGuildConfig(interaction.guild!.id);
  if (!config) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Configuration Error",
          "Failed to load configuration. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let blacklistedChannels = config.blacklistedChannels
    ? (JSON.parse(config.blacklistedChannels) as string[])
    : [];
  let whitelistedChannels = config.whitelistedChannels
    ? (JSON.parse(config.whitelistedChannels) as string[])
    : [];
  let whitelistCleared = false;

  switch (action) {
    case "add":
      if (!channel || !(channel instanceof TextChannel)) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Invalid Channel",
              "Please select a valid text channel to add to the blacklist.",
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (blacklistedChannels.includes(channel.id)) {
        await interaction.reply({
          embeds: [
            createEmbed(
              YELLOW,
              "Already Blacklisted",
              `${channel} is already in the blacklist.`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      blacklistedChannels.push(channel.id);

      // Clear whitelist when adding to blacklist to avoid conflicts
      if (whitelistedChannels.length > 0) {
        whitelistedChannels = [];
        whitelistCleared = true;
      }
      break;

    case "remove":
      if (!channel || !(channel instanceof TextChannel)) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Invalid Channel",
              "Please select a valid text channel to remove from the blacklist.",
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!blacklistedChannels.includes(channel.id)) {
        await interaction.reply({
          embeds: [
            createEmbed(
              YELLOW,
              "Not Blacklisted",
              `${channel} is not in the blacklist.`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      blacklistedChannels = blacklistedChannels.filter(
        (id) => id !== channel.id,
      );
      break;

    case "clear":
      blacklistedChannels = [];
      break;

    case "list":
      if (blacklistedChannels.length === 0) {
        await interaction.reply({
          embeds: [
            createEmbed(
              BLUE,
              "Channel Blacklist",
              "No channels are blacklisted. AI responds in all channels (or only in whitelisted channels if whitelist is set).",
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const channelList = blacklistedChannels
        .map((id) => `<#${id}>`)
        .join("\n");
      await interaction.reply({
        embeds: [
          createEmbed(
            BLUE,
            "Channel Blacklist",
            `AI won't respond in these channels (whitelist is disabled when blacklist is active):\n\n${channelList}`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
  }

  const success = await updateGuildConfig(interaction.guild!.id, {
    blacklistedChannels:
      blacklistedChannels.length > 0
        ? JSON.stringify(blacklistedChannels)
        : null,
    whitelistedChannels:
      whitelistedChannels.length > 0
        ? JSON.stringify(whitelistedChannels)
        : null,
  });

  if (!success) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Configuration Error",
          "Failed to update blacklist. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let message = "";
  switch (action) {
    case "add":
      message = `${channel} has been added to the blacklist.${
        whitelistCleared
          ? " The whitelist has been cleared to avoid conflicts."
          : ""
      }`;
      break;
    case "remove":
      message = `${channel} has been removed from the blacklist.`;
      break;
    case "clear":
      message = "Channel blacklist has been cleared.";
      break;
  }

  await interaction.reply({
    embeds: [createEmbed(GREEN, "Blacklist Updated", message)],
    flags: MessageFlags.Ephemeral,
  });
}
