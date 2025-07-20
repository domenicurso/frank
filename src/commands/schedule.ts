import { BLUE, GREEN, RED, YELLOW } from "@/constants";
import { ScheduledMessage } from "@/database";
import { createEmbed } from "@/utils/embeds";
import {
  cancelScheduledMessage,
  formatScheduledTime,
  getTimeUntilScheduled,
  getUserScheduledMessages,
} from "@/utils/scheduledMessages";
import chalk from "chalk";
import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

export const name = "Schedule";

export const definition = new SlashCommandBuilder()
  .setName("schedule")
  .setDescription("Manage your scheduled messages")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("list")
      .setDescription("List your upcoming scheduled messages"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("cancel")
      .setDescription("Cancel a scheduled message")
      .addIntegerOption((option) =>
        option
          .setName("id")
          .setDescription("The ID of the scheduled message to cancel")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Add a scheduled message")
      .addStringOption((option) =>
        option.setName("time").setDescription("When to ping").setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("Message to include with the ping")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("users")
          .setDescription("Users to ping")
          .setRequired(false),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    await handleList(interaction);
  } else if (subcommand === "cancel") {
    await handleCancel(interaction);
  } else if (subcommand === "add") {
    await handleAdd(interaction);
  }
}

async function handleList(interaction: ChatInputCommandInteraction) {
  try {
    const scheduledMessages = await getUserScheduledMessages(
      interaction.user.id,
      interaction.guild?.id,
    );

    if (scheduledMessages.length === 0) {
      await interaction.reply({
        embeds: [
          createEmbed(
            YELLOW,
            "No scheduled messages",
            "You have no scheduled messages in this server.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Your Scheduled Messages")
      .setColor(BLUE)
      .setFooter({
        text: `${scheduledMessages.length} scheduled message${scheduledMessages.length === 1 ? "" : "s"}`,
      });

    const fields = scheduledMessages.slice(0, 10).map((msg, index) => {
      const targetUsers = msg.targetUserIds
        .map((id: string) => `<@${id}>`)
        .join(", ");

      const timeUntil = getTimeUntilScheduled(msg.scheduledTime);
      const formattedTime = formatScheduledTime(msg.scheduledTime);

      return {
        name: `#${msg.id} - ${timeUntil}`,
        value: `**Time:** ${formattedTime}\n**Users:** ${targetUsers}\n**Message:** ${msg.message.length > 100 ? msg.message.substring(0, 100) + "..." : msg.message}`,
        inline: false,
      };
    });

    embed.addFields(fields);

    if (scheduledMessages.length > 10) {
      embed.setDescription(
        `Showing first 10 of ${scheduledMessages.length} scheduled messages.`,
      );
    }

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error(chalk.red("[SCHEDULED] Error listing messages:"), error);
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Failed to fetch",
          "Failed to fetch your scheduled messages. Please try again.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleCancel(interaction: ChatInputCommandInteraction) {
  const messageId = interaction.options.getInteger("id", true);

  try {
    const success = await cancelScheduledMessage(
      messageId,
      interaction.user.id,
    );

    if (success) {
      await interaction.reply({
        embeds: [
          createEmbed(
            GREEN,
            "Message cancelled",
            `Successfully cancelled scheduled message #${messageId}.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        embeds: [
          createEmbed(
            RED,
            "Failed to cancel message",
            `Could not cancel message #${messageId}. It may not exist, already be sent, or you may not have permission to cancel it.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error(chalk.red("[SCHEDULED] Error cancelling message:"), error);
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Failed to cancel the scheduled message",
          `Could not cancel message #${messageId}. Please try again.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleAdd(interaction: ChatInputCommandInteraction) {
  const timeInput = interaction.options.getString("time", true);
  const usersInput = interaction.options.getString("users") || "";
  const messageInput = interaction.options.getString("message", true);

  const userMentions = usersInput.match(/<@!?(\d+)>/g) || [];

  const targetUserIds: string[] = [];
  for (const mention of userMentions) {
    const userId = mention.replace(/<@!?(\d+)>/, "$1");
    targetUserIds.push(userId);
  }

  // Parse time
  const scheduledTime = parseTime(timeInput);
  if (!scheduledTime) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Invalid time format",
          "Try formats like:\n• `2:30 PM` or `3pm` or `14:30` for today\n• `2024-12-25 15:00` for a specific date\n• `tomorrow 2:30 PM`",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if time is in the past
  if (scheduledTime <= new Date()) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Cannot schedule a message for a time in the past!",
          "Please choose a future time.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    // Store in database
    await ScheduledMessage.create({
      userId: interaction.user.id,
      guildId: interaction.guild!.id,
      channelId: interaction.channel!.id,
      targetUserIds: JSON.stringify(targetUserIds),
      scheduledTime,
      message: messageInput,
      sent: false,
    });

    // Get usernames for confirmation
    const usernames = await Promise.all(
      targetUserIds.map(async (id) => {
        try {
          const user = await interaction.client.users.fetch(id);
          return user.username;
        } catch {
          return `<@${id}>`;
        }
      }),
    );

    const formattedTime = scheduledTime.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
      timeZoneName: "short",
    });

    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Scheduled ping set!",
          `**Time:** ${formattedTime}\n**Users:** ${usernames.join(", ")}\n**Message:** "${messageInput}"`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error(
      chalk.red("[SCHEDULE] Error creating scheduled message:"),
      error,
    );
    await interaction.reply({
      embeds: [
        createEmbed(RED, "Failed to schedule message", "Please try again."),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

// Helper functions for Eastern timezone handling (EST/EDT)
function getEasternDate(date?: Date): Date {
  const targetDate = date || new Date();
  // Get the current time in Eastern timezone
  const easternTimeString = targetDate.toLocaleString("en-US", {
    timeZone: "America/New_York",
  });
  return new Date(easternTimeString);
}

function createEasternDate(localDate: Date): Date {
  // Create a date that represents the local time but interpreted as Eastern time
  const year = localDate.getFullYear();
  const month = localDate.getMonth() + 1;
  const day = localDate.getDate();
  const hours = localDate.getHours();
  const minutes = localDate.getMinutes();
  const seconds = localDate.getSeconds();

  // Create a date string and then convert it to Eastern time
  const dateString = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")} ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  // Parse the date string as if it were in Eastern time
  const tempDate = new Date(dateString);
  const easternOffset = getEasternOffset(tempDate);

  // Adjust for timezone offset
  return new Date(tempDate.getTime() - easternOffset);
}

function getEasternOffset(date: Date): number {
  // Get the timezone offset for Eastern time at the given date
  const easternDate = new Date(
    date.toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  return utcDate.getTime() - easternDate.getTime();
}

const relativeRegex =
  /(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?)?)?)?/i;

function parseRelativeTime(rel: string): number | null {
  const match = rel.match(relativeRegex);
  if (!match) return null;
  const days = match[1] ? parseInt(match[1], 10) : 0;
  const hours = match[2] ? parseInt(match[2], 10) : 0;
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  const seconds = match[4] ? parseInt(match[4], 10) : 0;
  if (days === 0 && hours === 0 && minutes === 0 && seconds === 0) return null;
  return days * 86400000 + hours * 3600000 + minutes * 60000 + seconds * 1000;
}

function parseTime(input: string): Date | null {
  // Get current time in Eastern timezone
  const now = getEasternDate();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Remove extra whitespace and convert to lowercase
  const cleaned = input.trim().toLowerCase();

  // Support "now"
  if (cleaned === "now") {
    return now;
  }

  // Support relative times with "in" or "after"
  if (cleaned.startsWith("in ") || cleaned.startsWith("after ")) {
    const relString = cleaned.replace(/^(in |after )/, "");
    const relMs = parseRelativeTime(relString);
    if (relMs) {
      return new Date(now.getTime() + relMs);
    }
  }

  // Support pure relative format like "2h30m"
  if (relativeRegex.test(cleaned)) {
    const relMs = parseRelativeTime(cleaned);
    if (relMs) {
      return new Date(now.getTime() + relMs);
    }
  }

  try {
    // Handle "tomorrow" prefix
    if (cleaned.startsWith("tomorrow")) {
      const timeString = cleaned.replace("tomorrow", "").trim();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const timeOnly = parseTimeOnly(timeString);
      if (timeOnly) {
        tomorrow.setHours(timeOnly.hours, timeOnly.minutes, 0, 0);
        return createEasternDate(tomorrow);
      }
    }

    // Try to parse as full datetime (YYYY-MM-DD HH:mm or MM/DD/YYYY HH:mm)
    const fullDateFormats = [
      /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i,
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?:\s*(am|pm))?$/i,
    ];

    for (const format of fullDateFormats) {
      const match = cleaned.match(format);
      if (match) {
        // Get "now" values
        const now = new Date();
        const defaultYear = now.getFullYear();
        const defaultMonth = now.getMonth() + 1; // getMonth is zero-based
        const defaultDay = now.getDate();
        const defaultHour = now.getHours();

        let year: number,
          month: number,
          day: number,
          hours: number,
          minutes: number;

        if (format === fullDateFormats[0]) {
          // YYYY-MM-DD format
          [
            ,
            year = defaultYear,
            month = defaultMonth,
            day = defaultDay,
            hours = defaultHour,
            minutes = 0,
          ] = match.map(Number);
        } else {
          // MM/DD/YYYY format
          [
            ,
            month = defaultMonth,
            day = defaultDay,
            year = defaultYear,
            hours = defaultHour,
            minutes = 0,
          ] = match.map(Number);
        }

        const ampm = match[6];
        if (ampm) {
          if (ampm === "pm" && hours !== 12) hours += 12;
          if (ampm === "am" && hours === 12) hours = 0;
        }

        const date = new Date(year, month - 1, day, hours, minutes ?? 0, 0, 0);
        return createEasternDate(date);
      }
    }

    // Try to parse as time only for today
    const timeOnly = parseTimeOnly(cleaned);
    if (timeOnly) {
      const result = new Date(today);
      result.setHours(timeOnly.hours, timeOnly.minutes, 0, 0);
      const estResult = createEasternDate(result);

      // If the time has already passed today, schedule for tomorrow
      if (estResult <= now) {
        estResult.setDate(estResult.getDate() + 1);
      }

      return estResult;
    }

    // Try parsing as a natural language date
    const parsed = new Date(input);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  } catch (error) {
    console.error("Time parsing error:", error);
  }

  return null;
}

function parseTimeOnly(
  timeString: string,
): { hours: number; minutes: number } | null {
  let match: RegExpMatchArray | null;

  // HH:MM AM/PM
  match = timeString.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (match) {
    let hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    const ampm = match[3]!.toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return { hours, minutes };
  }
  // HH:MM 24h
  match = timeString.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    return { hours, minutes };
  }
  // H AM/PM
  match = timeString.match(/^(\d{1,2})\s*(am|pm)$/i);
  if (match) {
    let hours = parseInt(match[1] || "0", 10);
    const minutes = 0;
    const ampm = match[2]!.toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return { hours, minutes };
  }
  // H 24h
  match = timeString.match(/^(\d{1,2})$/);
  if (match) {
    const hours = parseInt(match[1] || "0", 10);
    const minutes = 0;
    return { hours, minutes };
  }
  return null;
}
