import chalk from "chalk";
import { Client, Events } from "discord.js";
import { startActivityUpdates, stopActivityUpdates } from "@/activity";
import { startFrankWorker } from "@/frank";
import { startAIControllerWatchdog } from "@/events/ai";

export const name = "Ready";
export const type = Events.ClientReady;
export const once = true;

export async function execute(client: Client) {
  // if you have shutdown hooks elsewhere, keep stopActivityUpdates available
  startActivityUpdates(client);
  startFrankWorker();
  startAIControllerWatchdog(client);

  console.log(
    chalk.yellow("Ready!"),
    `Logged in as ${chalk.white.bold(client.user?.tag)}`,
  );

  console.log(
    `Serving ${chalk.yellow.bold(client.guilds.cache.size)} guild${
      client.guilds.cache.size === 1 ? "" : "s"
    }`,
    "\n",
  );

  console.log(chalk.green("Frank worker started!"));
}

export { stopActivityUpdates };
