import { GREEN, RED, YELLOW } from "@/constants";
import { appendFrankEvent, correctMemoryEvidence, listMemoryEvidence, setMemoryEvidenceState } from "@/frank/store";
import { getProfileForCommand, refreshSubjectProfile } from "@/frank/memory";
import { createEmbed } from "@/utils/embeds";
import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const name = "Memory";

export const definition = new SlashCommandBuilder()
  .setName("memory")
  .setDescription("Inspect and correct Frank's memory profiles")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("profile")
      .setDescription("Show Frank's memory profile for a user")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("User to inspect")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("evidence")
      .setDescription("Show evidence rows for a user")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("User to inspect")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("pin")
      .setDescription("Pin a memory evidence row")
      .addStringOption((option) =>
        option
          .setName("evidence_id")
          .setDescription("Evidence row id")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("forget")
      .setDescription("Suppress a memory evidence row")
      .addStringOption((option) =>
        option
          .setName("evidence_id")
          .setDescription("Evidence row id")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("correct")
      .setDescription("Correct a memory evidence row")
      .addStringOption((option) =>
        option
          .setName("evidence_id")
          .setDescription("Evidence row id")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("content")
          .setDescription("Replacement content")
          .setRequired(true),
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

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Insufficient Permissions",
          "You need Manage Server to operate Frank memory.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "profile") {
    const user = interaction.options.getUser("user", true);
    const profile = await getProfileForCommand(
      interaction.guild.id,
      "user",
      user.id,
    );

    if (!profile) {
      await interaction.reply({
        embeds: [
          createEmbed(
            YELLOW,
            "No Profile Yet",
            `Frank does not have a profile for ${user.username} yet.`,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sections = Object.entries(profile.profile)
      .filter(([, values]) => values.length > 0)
      .map(([section, values]) => `**${section}**\n${values.join("\n")}`)
      .join("\n\n");

    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          `Profile: ${profile.displayName}`,
          `${profile.summary}\n\n${sections}`.slice(0, 4000),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "evidence") {
    const user = interaction.options.getUser("user", true);
    const evidence = await listMemoryEvidence(interaction.guild.id, "user", user.id);
    const lines = evidence.slice(0, 10).map((item) => {
      const flags = [
        item.pinned ? "pinned" : null,
        item.suppressed ? "suppressed" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `#${item.id} [${item.category}] ${item.content}${flags ? ` (${flags})` : ""}`;
    });

    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          `Evidence: ${user.username}`,
          lines.length > 0 ? lines.join("\n") : "No evidence rows yet.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "pin" || subcommand === "forget") {
    const evidenceId = interaction.options.getString("evidence_id", true);
    const action = subcommand === "pin" ? "pin" : "suppress";
    const evidence = await setMemoryEvidenceState(evidenceId, action);

    if (!evidence) {
      await interaction.reply({
        embeds: [createEmbed(RED, "Not Found", "Evidence row not found.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await refreshSubjectProfile(
      interaction.guild.id,
      evidence.subjectType,
      evidence.subjectId,
    );
    await appendFrankEvent({
      type: "memory_corrected",
      eventKey: `memory_corrected:${evidence.id}:${Date.now()}`,
      guildId: interaction.guild.id,
      subjectType: evidence.subjectType,
      subjectId: evidence.subjectId,
      evidenceId,
      action: subcommand === "pin" ? "pin" : "forget",
      createdAt: new Date().toISOString(),
    });

    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Memory Updated",
          `Evidence row ${evidenceId} was ${subcommand === "pin" ? "pinned" : "suppressed"}.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "correct") {
    const evidenceId = interaction.options.getString("evidence_id", true);
    const content = interaction.options.getString("content", true);
    const evidence = await correctMemoryEvidence(evidenceId, content);

    if (!evidence) {
      await interaction.reply({
        embeds: [createEmbed(RED, "Not Found", "Evidence row not found.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await refreshSubjectProfile(
      interaction.guild.id,
      evidence.subjectType,
      evidence.subjectId,
    );
    await appendFrankEvent({
      type: "memory_corrected",
      eventKey: `memory_corrected:${evidence.id}:${Date.now()}`,
      guildId: interaction.guild.id,
      subjectType: evidence.subjectType,
      subjectId: evidence.subjectId,
      evidenceId,
      action: "correct",
      createdAt: new Date().toISOString(),
    });

    await interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Memory Corrected",
          `Evidence row ${evidenceId} now says:\n${content}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
