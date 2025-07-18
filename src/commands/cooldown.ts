import { BLUE, GREEN, RED, YELLOW } from "@/constants";
import { CooldownManager } from "@/utils/cooldown";
import { createEmbed } from "@/utils/embeds";
import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type CacheType,
} from "discord.js";

export const name = "Cooldown";

export const definition = new SlashCommandBuilder()
  .setName("cooldown")
  .setDescription("Manage user cooldowns")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommandGroup((group) =>
    group
      .setName("check")
      .setDescription("Check active cooldowns")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("user")
          .setDescription("Check a user's active cooldowns")
          .addUserOption((option) =>
            option
              .setName("user")
              .setDescription("The user to check cooldowns for")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("channel")
          .setDescription("Check active cooldowns for the current channel"),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("guild")
          .setDescription("Check active cooldowns for the current guild"),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("global")
          .setDescription("Check active global cooldowns"),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("set")
      .setDescription("Set cooldowns")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("user")
          .setDescription("Set a cooldown for a user")
          .addUserOption((option) =>
            option
              .setName("user")
              .setDescription("The user to set cooldown for")
              .setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("identifier")
              .setDescription("The cooldown identifier")
              .setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("duration")
              .setDescription("Duration (e.g., 5s, 10m, 1h, 2d)")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("channel")
          .setDescription("Set a cooldown for the current channel")
          .addStringOption((option) =>
            option
              .setName("identifier")
              .setDescription("The cooldown identifier")
              .setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("duration")
              .setDescription("Duration (e.g., 5s, 10m, 1h, 2d)")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("guild")
          .setDescription("Set a cooldown for the current guild")
          .addStringOption((option) =>
            option
              .setName("identifier")
              .setDescription("The cooldown identifier")
              .setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("duration")
              .setDescription("Duration (e.g., 5s, 10m, 1h, 2d)")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("global")
          .setDescription("Set a global cooldown")
          .addStringOption((option) =>
            option
              .setName("identifier")
              .setDescription("The cooldown identifier")
              .setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("duration")
              .setDescription("Duration (e.g., 5s, 10m, 1h, 2d)")
              .setRequired(true),
          ),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("remove")
      .setDescription("Remove specific cooldowns")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("user")
          .setDescription("Remove a specific cooldown for a user")
          .addUserOption((option) =>
            option
              .setName("user")
              .setDescription("The user to remove cooldown from")
              .setRequired(true),
          )
          .addStringOption((option) =>
            option
              .setName("identifier")
              .setDescription("The cooldown identifier")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("channel")
          .setDescription("Remove a specific cooldown for the current channel")
          .addStringOption((option) =>
            option
              .setName("identifier")
              .setDescription("The cooldown identifier")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("guild")
          .setDescription("Remove a specific cooldown for the current guild")
          .addStringOption((option) =>
            option
              .setName("identifier")
              .setDescription("The cooldown identifier")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("global")
          .setDescription("Remove a specific global cooldown")
          .addStringOption((option) =>
            option
              .setName("identifier")
              .setDescription("The cooldown identifier")
              .setRequired(true),
          ),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("clear")
      .setDescription("Clear all cooldowns")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("user")
          .setDescription("Clear all cooldowns for a user")
          .addUserOption((option) =>
            option
              .setName("user")
              .setDescription("The user to clear all cooldowns for")
              .setRequired(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("channel")
          .setDescription("Clear all cooldowns for the current channel"),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("guild")
          .setDescription("Clear all cooldowns for the current guild"),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("global")
          .setDescription("Clear all global cooldowns"),
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction<CacheType>,
) {
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommandGroup) {
      case "check":
        await handleCheck(interaction, subcommand);
        break;
      case "set":
        await handleSet(interaction, subcommand);
        break;
      case "remove":
        await handleRemove(interaction, subcommand);
        break;
      case "clear":
        await handleClear(interaction, subcommand);
        break;
      default:
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Unknown subcommand group",
              "Please use a valid subcommand group.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    console.error("Error in cooldown command:", error);

    const errorEmbed = createEmbed(
      RED,
      "Error",
      "An error occurred while managing cooldowns.",
    );

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        embeds: [errorEmbed],
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        flags: [MessageFlags.Ephemeral],
      });
    }
  }
}

async function handleCheck(
  interaction: ChatInputCommandInteraction<CacheType>,
  subcommand: string,
) {
  switch (subcommand) {
    case "user": {
      const targetUser = interaction.options.getUser("user", true);
      const cooldowns = await CooldownManager.getUserCooldowns(targetUser.id);

      if (cooldowns.length === 0) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "No Active Cooldowns",
              `**${targetUser.username}** has no active cooldowns.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const cooldownList = cooldowns
        .map((cooldown) => {
          const timeLeft = new Date(cooldown.expiresAt).getTime() - Date.now();
          const timeLeftFormatted = CooldownManager.formatTime(
            Math.max(0, timeLeft),
          );
          const parts = cooldown.cooldownKey.split(":");
          const identifier = parts[parts.length - 1];
          return `• **${identifier}**: ${timeLeftFormatted}`;
        })
        .join("\n");

      await interaction.reply({
        embeds: [
          createEmbed(
            BLUE,
            `${targetUser.username}'s Active Cooldowns`,
            cooldownList,
          ),
        ],
        flags: [MessageFlags.Ephemeral],
      });
      break;
    }

    case "channel": {
      if (!interaction.channelId) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Error",
              "This command can only be used in a channel.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const cooldowns = await CooldownManager.getChannelCooldowns(
        interaction.channelId,
      );

      if (cooldowns.length === 0) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "No Active Cooldowns",
              "This channel has no active cooldowns.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const cooldownList = cooldowns
        .map((cooldown) => {
          const timeLeft = new Date(cooldown.expiresAt).getTime() - Date.now();
          const timeLeftFormatted = CooldownManager.formatTime(
            Math.max(0, timeLeft),
          );
          const parts = cooldown.cooldownKey.split(":");
          const identifier = parts[parts.length - 1];
          return `• **${identifier}**: ${timeLeftFormatted}`;
        })
        .join("\n");

      await interaction.reply({
        embeds: [createEmbed(BLUE, "Channel Cooldowns", cooldownList)],
        flags: [MessageFlags.Ephemeral],
      });
      break;
    }

    case "guild": {
      if (!interaction.guildId) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Error",
              "This command can only be used in a guild.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const cooldowns = await CooldownManager.getGuildCooldowns(
        interaction.guildId,
      );

      if (cooldowns.length === 0) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "No Active Cooldowns",
              "This guild has no active cooldowns.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const cooldownList = cooldowns
        .map((cooldown) => {
          const timeLeft = new Date(cooldown.expiresAt).getTime() - Date.now();
          const timeLeftFormatted = CooldownManager.formatTime(
            Math.max(0, timeLeft),
          );
          const parts = cooldown.cooldownKey.split(":");
          const identifier = parts[parts.length - 1];
          return `• **${identifier}**: ${timeLeftFormatted}`;
        })
        .join("\n");

      await interaction.reply({
        embeds: [createEmbed(BLUE, "Guild Cooldowns", cooldownList)],
        flags: [MessageFlags.Ephemeral],
      });
      break;
    }

    case "global": {
      const cooldowns = await CooldownManager.getGlobalCooldowns();

      if (cooldowns.length === 0) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "No Active Cooldowns",
              "No active global cooldowns.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const cooldownList = cooldowns
        .map((cooldown) => {
          const timeLeft = new Date(cooldown.expiresAt).getTime() - Date.now();
          const timeLeftFormatted = CooldownManager.formatTime(
            Math.max(0, timeLeft),
          );
          const parts = cooldown.cooldownKey.split(":");
          const identifier = parts[parts.length - 1];
          return `• **${identifier}**: ${timeLeftFormatted}`;
        })
        .join("\n");

      await interaction.reply({
        embeds: [createEmbed(BLUE, "Global Cooldowns", cooldownList)],
        flags: [MessageFlags.Ephemeral],
      });
      break;
    }
  }
}

async function handleSet(
  interaction: ChatInputCommandInteraction<CacheType>,
  subcommand: string,
) {
  switch (subcommand) {
    case "user": {
      const targetUser = interaction.options.getUser("user", true);
      const identifier = interaction.options.getString("identifier", true);
      const durationStr = interaction.options.getString("duration", true);

      try {
        const duration = CooldownManager.parseDuration(durationStr);
        await CooldownManager.setUserCooldown(
          targetUser.id,
          identifier,
          duration,
        );

        const formattedDuration = CooldownManager.formatTime(duration);
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldown Set",
              `Set **${formattedDuration}** cooldown for **${targetUser.username}** on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } catch (error) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Invalid Duration",
              "Use formats like: 5s, 10m, 1h, 2d",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }

    case "channel": {
      if (!interaction.channelId) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Error",
              "This command can only be used in a channel.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const identifier = interaction.options.getString("identifier", true);
      const durationStr = interaction.options.getString("duration", true);

      try {
        const duration = CooldownManager.parseDuration(durationStr);
        await CooldownManager.setChannelCooldown(
          interaction.channelId,
          identifier,
          duration,
        );

        const formattedDuration = CooldownManager.formatTime(duration);
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldown Set",
              `Set **${formattedDuration}** cooldown for this channel on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } catch (error) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Invalid Duration",
              "Use formats like: 5s, 10m, 1h, 2d",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }

    case "guild": {
      if (!interaction.guildId) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Error",
              "This command can only be used in a guild.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const identifier = interaction.options.getString("identifier", true);
      const durationStr = interaction.options.getString("duration", true);

      try {
        const duration = CooldownManager.parseDuration(durationStr);
        await CooldownManager.setGuildCooldown(
          interaction.guildId,
          identifier,
          duration,
        );

        const formattedDuration = CooldownManager.formatTime(duration);
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldown Set",
              `Set **${formattedDuration}** cooldown for this guild on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } catch (error) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Invalid Duration",
              "Use formats like: 5s, 10m, 1h, 2d",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }

    case "global": {
      const identifier = interaction.options.getString("identifier", true);
      const durationStr = interaction.options.getString("duration", true);

      try {
        const duration = CooldownManager.parseDuration(durationStr);
        await CooldownManager.setGlobalCooldown(identifier, duration);

        const formattedDuration = CooldownManager.formatTime(duration);
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldown Set",
              `Set **${formattedDuration}** global cooldown on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } catch (error) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Invalid Duration",
              "Use formats like: 5s, 10m, 1h, 2d",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }
  }
}

async function handleRemove(
  interaction: ChatInputCommandInteraction<CacheType>,
  subcommand: string,
) {
  switch (subcommand) {
    case "user": {
      const targetUser = interaction.options.getUser("user", true);
      const identifier = interaction.options.getString("identifier", true);
      const removed = await CooldownManager.removeCooldown(
        targetUser.id,
        identifier,
        "user",
      );

      if (removed) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldown Removed",
              `Removed cooldown for **${targetUser.username}** on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          embeds: [
            createEmbed(
              YELLOW,
              "No Cooldown Found",
              `No active cooldown found for **${targetUser.username}** on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }

    case "channel": {
      if (!interaction.channelId) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Error",
              "This command can only be used in a channel.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const identifier = interaction.options.getString("identifier", true);
      const removed = await CooldownManager.removeCooldown(
        "channel",
        identifier,
        "channel",
        undefined,
        interaction.channelId,
      );

      if (removed) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldown Removed",
              `Removed cooldown for this channel on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          embeds: [
            createEmbed(
              YELLOW,
              "No Cooldown Found",
              `No active cooldown found for this channel on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }

    case "guild": {
      if (!interaction.guildId) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Error",
              "This command can only be used in a guild.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const identifier = interaction.options.getString("identifier", true);
      const removed = await CooldownManager.removeCooldown(
        "guild",
        identifier,
        "guild",
        interaction.guildId,
      );

      if (removed) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldown Removed",
              `Removed cooldown for this guild on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          embeds: [
            createEmbed(
              YELLOW,
              "No Cooldown Found",
              `No active cooldown found for this guild on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }

    case "global": {
      const identifier = interaction.options.getString("identifier", true);
      const removed = await CooldownManager.removeCooldown(
        "global",
        identifier,
        "global",
      );

      if (removed) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldown Removed",
              `Removed global cooldown on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          embeds: [
            createEmbed(
              YELLOW,
              "No Cooldown Found",
              `No active global cooldown found on \`${identifier}\`.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }
  }
}

async function handleClear(
  interaction: ChatInputCommandInteraction<CacheType>,
  subcommand: string,
) {
  switch (subcommand) {
    case "user": {
      const targetUser = interaction.options.getUser("user", true);
      const cleared = await CooldownManager.clearUserCooldowns(targetUser.id);

      if (cleared > 0) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldowns Cleared",
              `Cleared **${cleared}** cooldown${cleared === 1 ? "" : "s"} for **${targetUser.username}**.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "No Cooldowns to Clear",
              `**${targetUser.username}** had no active cooldowns to clear.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }

    case "channel": {
      if (!interaction.channelId) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Error",
              "This command can only be used in a channel.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const cleared = await CooldownManager.clearChannelCooldowns(
        interaction.channelId,
      );

      if (cleared > 0) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldowns Cleared",
              `Cleared **${cleared}** cooldown${cleared === 1 ? "" : "s"} for this channel.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "No Cooldowns to Clear",
              "This channel had no active cooldowns to clear.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }

    case "guild": {
      if (!interaction.guildId) {
        await interaction.reply({
          embeds: [
            createEmbed(
              RED,
              "Error",
              "This command can only be used in a guild.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const cleared = await CooldownManager.clearGuildCooldowns(
        interaction.guildId,
      );

      if (cleared > 0) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldowns Cleared",
              `Cleared **${cleared}** cooldown${cleared === 1 ? "" : "s"} for this guild.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "No Cooldowns to Clear",
              "This guild had no active cooldowns to clear.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }

    case "global": {
      const cleared = await CooldownManager.clearGlobalCooldowns();

      if (cleared > 0) {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "Cooldowns Cleared",
              `Cleared **${cleared}** global cooldown${cleared === 1 ? "" : "s"}.`,
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          embeds: [
            createEmbed(
              GREEN,
              "No Cooldowns to Clear",
              "No active global cooldowns to clear.",
            ),
          ],
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }
  }
}
