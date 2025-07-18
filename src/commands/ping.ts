import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  type CacheType,
} from "discord.js";

export const name = "Ping";

export const definition = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Replies with Pong!")
  .addUserOption((option) =>
    option.setName("user").setDescription("The user to ping"),
  );

export async function execute(
  interaction: ChatInputCommandInteraction<CacheType>,
) {
  const user = interaction.options.getUser("user") ?? interaction.user;
  const now = Date.now();

  await interaction
    .reply(`Ping, <@${user.id}>!\n**Latency:** \`---ms\``)
    .then((message) => {
      const diff = Date.now() - now;
      message.edit(`Pong, <@${user.id}>!\n**Latency:** \`${diff}ms\``);
    });
}
