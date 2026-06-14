import { GREEN, RED } from "@/constants";
import { createEmbed } from "@/utils/embeds";
import {
  ChatInputCommandInteraction,
  Collection,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type CacheType,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const name = "Reload";

export const definition = new SlashCommandBuilder()
  .setName("reload")
  .setDescription("Reloads a command without restarting the bot")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("command")
      .setDescription("The command name to reload")
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction<CacheType>,
) {
  const name = interaction.options.getString("command", true).toLowerCase();
  const commands = interaction.client.commands as Collection<
    string,
    { definition: SlashCommandBuilder; execute: Function }
  >;

  if (!commands.has(name)) {
    return interaction.reply({
      embeds: [
        createEmbed(RED, "Command Not Found", `No command named \`${name}\`.`),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  // resolve .ts or .js in the same folder
  const cmdPathTs = path.join(__dirname, `${name}.ts`);
  const cmdPathJs = path.join(__dirname, `${name}.js`);
  let modulePath: string | null = null;

  if (fs.existsSync(cmdPathTs)) modulePath = cmdPathTs;
  else if (fs.existsSync(cmdPathJs)) modulePath = cmdPathJs;

  if (!modulePath) {
    return interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Source File Not Found",
          `Could not find source file for \`${name}\`.`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    const moduleUrl = pathToFileURL(modulePath);
    moduleUrl.searchParams.set("t", String(Date.now()));
    const newCommand = await import(moduleUrl.href);
    if (!newCommand.definition || !newCommand.execute) {
      throw new Error("Missing definition or execute export");
    }
    commands.set(newCommand.definition.name, newCommand);

    return interaction.reply({
      embeds: [
        createEmbed(
          GREEN,
          "Command Reloaded",
          `Reloaded **${newCommand.definition.name}**!`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } catch (err: any) {
    console.error(err);
    return interaction.reply({
      embeds: [
        createEmbed(
          RED,
          "Reload Error",
          `Error reloading \`${name}\`: ${err.message}`,
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
