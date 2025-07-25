import { EmbedBuilder } from "discord.js";

/**
 * Creates an embed with the given color, title, and message
 */
export function createEmbed(
  color: number,
  title: string,
  message: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(message);
}
