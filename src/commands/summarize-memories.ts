import { BLUE, GREEN, RED, YELLOW } from "@/constants";
import { createEmbed } from "@/utils/embeds";
import {
  getMemoryStatistics,
  runMemorySummarization,
  summarizeGuildMemories,
} from "@/utils/memorySummarizer";
import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type CacheType,
} from "discord.js";

export const name = "Summarize Memories";

export const definition = new SlashCommandBuilder()
  .setName("summarize-memories")
  .setDescription("Manually trigger memory summarization process")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("scope")
      .setDescription("Scope of summarization")
      .setRequired(false)
      .addChoices(
        { name: "Current Guild Only", value: "guild" },
        { name: "All Guilds", value: "all" },
        { name: "View Statistics", value: "stats" },
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction<CacheType>,
) {
  const scope = interaction.options.getString("scope") || "guild";

  // Defer reply since this operation can take a while
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (scope === "stats") {
      const guildId = interaction.guildId || undefined;
      const stats = await getMemoryStatistics(guildId);

      const scopeText = guildId ? "this server" : "all servers";
      const guildBreakdown =
        Object.entries(stats.memoryByGuild)
          .slice(0, 10) // Limit to top 10 guilds
          .map(([id, count]) => {
            const guild = interaction.client.guilds.cache.get(id);
            const name = guild ? guild.name : `Unknown (${id.slice(-4)})`;
            return `• ${name}: ${count}`;
          })
          .join("\n") || "No memories found";

      return interaction.editReply({
        embeds: [
          createEmbed(
            BLUE,
            `Memory Statistics - ${scopeText}`,
            `**Total Memories:** ${stats.totalMemories}
**Regular Memories:** ${stats.regularMemories}
**Summary Memories:** ${stats.summaryMemories}
**Old Memories (7+ days):** ${stats.oldMemories}
**Average Content Length:** ${stats.avgContentLength} characters

**Top Servers by Memory Count:**
${guildBreakdown}`,
          ),
        ],
      });
    } else if (scope === "guild") {
      if (!interaction.guildId) {
        return interaction.editReply({
          embeds: [
            createEmbed(
              RED,
              "Error",
              "This command must be used in a server when using guild scope.",
            ),
          ],
        });
      }

      await interaction.editReply({
        embeds: [
          createEmbed(
            YELLOW,
            "Memory Summarization Started",
            `Starting memory summarization for this server. This may take a few moments...`,
          ),
        ],
      });

      await summarizeGuildMemories(interaction.guildId);

      return interaction.editReply({
        embeds: [
          createEmbed(
            GREEN,
            "Memory Summarization Complete",
            `Memory summarization completed for this server. Check the console logs for detailed results.`,
          ),
        ],
      });
    } else {
      await interaction.editReply({
        embeds: [
          createEmbed(
            YELLOW,
            "Memory Summarization Started",
            `Starting memory summarization for all servers. This may take several minutes...`,
          ),
        ],
      });

      await runMemorySummarization();

      return interaction.editReply({
        embeds: [
          createEmbed(
            GREEN,
            "Memory Summarization Complete",
            `Memory summarization completed for all servers. Check the console logs for detailed results.`,
          ),
        ],
      });
    }
  } catch (error) {
    console.error("Error in summarize-memories command:", error);

    return interaction.editReply({
      embeds: [
        createEmbed(
          RED,
          "Summarization Error",
          `An error occurred during memory summarization: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      ],
    });
  }
}
