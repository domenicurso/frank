import { BLUE, GREEN, RED, YELLOW } from "@/constants";
import { FRANK_MAX_BURST_MESSAGES } from "@/frank/constants";
import { getGuildConfig, updateGuildConfig } from "@/database";
import { parseJson } from "@/frank/json";
import { createEmbed } from "@/utils/embeds";
import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";

export const name = "Frank";

export const definition = new SlashCommandBuilder()
  .setName("frank")
  .setDescription("Configure Frank")
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
          .setDescription(`1-${FRANK_MAX_BURST_MESSAGES}`)
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(FRANK_MAX_BURST_MESSAGES),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("cooldown")
      .setDescription("Set Frank's ambient cooldown")
      .addIntegerOption((option) =>
        option
          .setName("seconds")
          .setDescription("0-600")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(600),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("mentions")
      .setDescription("Enable or disable mention replies")
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Whether Frank answers mentions")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("replies")
      .setDescription("Enable or disable reply handling")
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Whether Frank answers replies")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("channels")
      .setDescription("Manage where Frank can talk")
      .addStringOption((option) =>
        option
          .setName("mode")
          .setDescription("Allowlist or blocklist")
          .setRequired(true)
          .addChoices(
            { name: "Allowlist", value: "allow" },
            { name: "Blocklist", value: "deny" },
          ),
      )
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("What to do")
          .setRequired(true)
          .addChoices(
            { name: "Add", value: "add" },
            { name: "Remove", value: "remove" },
            { name: "Clear", value: "clear" },
            { name: "List", value: "list" },
          ),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Channel to add or remove")
          .setRequired(false),
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

  switch (subcommand) {
    case "view":
      await handleView(interaction);
      return;
    case "attention":
      await handleSimpleUpdate(interaction, {
        title: "Attention Updated",
        message: (value) => `Frank is now in \`${value}\` mode.`,
        updates: {
          attentionMode: interaction.options.getString("mode", true),
        },
      });
      return;
    case "opportunism":
      await handleSimpleUpdate(interaction, {
        title: "Opportunism Updated",
        message: (value) => `Frank opportunism is now \`${value}\`.`,
        updates: {
          opportunismLevel: interaction.options.getInteger("level", true),
        },
      });
      return;
    case "reactions":
      await handleBooleanUpdate(interaction, {
        option: "enabled",
        key: "reactionsEnabled",
        title: "Reaction Behavior Updated",
        enabledText: "Frank reactions are now enabled.",
        disabledText: "Frank reactions are now disabled.",
      });
      return;
    case "burst-cap":
      await handleBurstCap(interaction);
      return;
    case "cooldown":
      await handleSimpleUpdate(interaction, {
        title: "Cooldown Updated",
        message: (value) => `Frank ambient cooldown is now \`${value}\` seconds.`,
        updates: {
          cooldownDuration: interaction.options.getInteger("seconds", true),
        },
      });
      return;
    case "mentions":
      await handleBooleanUpdate(interaction, {
        option: "enabled",
        key: "allowedMentions",
        title: "Mention Behavior Updated",
        enabledText: "Frank mention replies are now enabled.",
        disabledText: "Frank mention replies are now disabled.",
      });
      return;
    case "replies":
      await handleBooleanUpdate(interaction, {
        option: "enabled",
        key: "allowedReplies",
        title: "Reply Behavior Updated",
        enabledText: "Frank reply handling is now enabled.",
        disabledText: "Frank reply handling is now disabled.",
      });
      return;
    case "channels":
      await handleChannels(interaction);
      return;
    default:
      await interaction.reply({
        embeds: [createEmbed(RED, "Unknown Command", "Unknown Frank subcommand.")],
        flags: MessageFlags.Ephemeral,
      });
  }
}

async function handleView(interaction: ChatInputCommandInteraction) {
  const config = await getGuildConfig(interaction.guild!.id);
  const allowlist = parseJson<string[]>(config?.whitelistedChannels, []);
  const blocklist = parseJson<string[]>(config?.blacklistedChannels, []);
  const channelMode =
    allowlist.length > 0
      ? `allowlist: ${allowlist.map((id) => `<#${id}>`).join(", ")}`
      : blocklist.length > 0
        ? `blocklist: ${blocklist.map((id) => `<#${id}>`).join(", ")}`
        : "all channels";

  await interaction.reply({
    embeds: [
      createEmbed(
        BLUE,
        "Frank Settings",
        [
          `Attention mode: ${config?.attentionMode ?? "conversation-aware"}`,
          `Opportunism: ${config?.opportunismLevel ?? 15}`,
          `Cooldown: ${config?.cooldownDuration ?? 30}s`,
          `Reactions: ${(config?.reactionsEnabled ?? true) ? "enabled" : "disabled"}`,
          `Burst cap: ${config?.maxBurstMessages ?? FRANK_MAX_BURST_MESSAGES}`,
          `Mentions: ${(config?.allowedMentions ?? true) ? "enabled" : "disabled"}`,
          `Replies: ${(config?.allowedReplies ?? true) ? "enabled" : "disabled"}`,
          `Channels: ${channelMode}`,
        ].join("\n"),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSimpleUpdate(
  interaction: ChatInputCommandInteraction,
  options: {
    title: string;
    message: (value: string | number | boolean) => string;
    updates: Record<string, string | number | boolean>;
  },
) {
  const success = await updateGuildConfig(interaction.guild!.id, options.updates);
  if (!success) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Update Failed", "Failed to update Frank settings.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const firstValue = Object.values(options.updates)[0] ?? "";
  await interaction.reply({
    embeds: [createEmbed(GREEN, options.title, options.message(firstValue))],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleBooleanUpdate(
  interaction: ChatInputCommandInteraction,
  options: {
    option: string;
    key: string;
    title: string;
    enabledText: string;
    disabledText: string;
  },
) {
  const enabled = interaction.options.getBoolean(options.option, true);
  const success = await updateGuildConfig(interaction.guild!.id, {
    [options.key]: enabled,
  });
  if (!success) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Update Failed", "Failed to update Frank settings.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      createEmbed(
        GREEN,
        options.title,
        enabled ? options.enabledText : options.disabledText,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleBurstCap(interaction: ChatInputCommandInteraction) {
  const count = interaction.options.getInteger("count", true);
  const success = await updateGuildConfig(interaction.guild!.id, {
    maxBurstMessages: count,
    burstResponsesEnabled: count > 1,
  });
  if (!success) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Update Failed", "Failed to update burst cap.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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

async function handleChannels(interaction: ChatInputCommandInteraction) {
  const mode = interaction.options.getString("mode", true);
  const action = interaction.options.getString("action", true);
  const channel = interaction.options.getChannel("channel");
  const config = await getGuildConfig(interaction.guild!.id);

  if (!config) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Load Failed", "Failed to load Frank settings.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const isAllowlist = mode === "allow";
  const listKey = isAllowlist ? "whitelistedChannels" : "blacklistedChannels";
  const otherKey = isAllowlist ? "blacklistedChannels" : "whitelistedChannels";
  let list = parseJson<string[]>(config[listKey], []);
  let otherList = parseJson<string[]>(config[otherKey], []);

  if (action === "list") {
    await interaction.reply({
      embeds: [
        createEmbed(
          BLUE,
          isAllowlist ? "Frank Allowlist" : "Frank Blocklist",
          list.length > 0
            ? list.map((id) => `<#${id}>`).join("\n")
            : "No channels configured.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action !== "clear") {
    if (!channel || !(channel instanceof TextChannel)) {
      await interaction.reply({
        embeds: [createEmbed(RED, "Invalid Channel", "Pick a text channel.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "add") {
      if (list.includes(channel.id)) {
        await interaction.reply({
          embeds: [createEmbed(YELLOW, "Already Set", `${channel} is already configured.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      list.push(channel.id);
      otherList = [];
    }

    if (action === "remove") {
      if (!list.includes(channel.id)) {
        await interaction.reply({
          embeds: [createEmbed(YELLOW, "Not Found", `${channel} is not in that list.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      list = list.filter((id) => id !== channel.id);
    }
  } else {
    list = [];
  }

  const success = await updateGuildConfig(interaction.guild!.id, {
    [listKey]: list.length > 0 ? JSON.stringify(list) : null,
    [otherKey]: otherList.length > 0 ? JSON.stringify(otherList) : null,
  });
  if (!success) {
    await interaction.reply({
      embeds: [createEmbed(RED, "Update Failed", "Failed to update channel settings.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const description =
    action === "clear"
      ? `${isAllowlist ? "Allowlist" : "Blocklist"} cleared.`
      : action === "add"
        ? `${channel} added to the ${isAllowlist ? "allowlist" : "blocklist"}.`
        : `${channel} removed from the ${isAllowlist ? "allowlist" : "blocklist"}.`;

  await interaction.reply({
    embeds: [createEmbed(GREEN, "Channel Settings Updated", description)],
    flags: MessageFlags.Ephemeral,
  });
}
