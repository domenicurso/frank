import { EmbedBuilder } from "discord.js";

/**
 * Creates a red error embed with the given message
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
