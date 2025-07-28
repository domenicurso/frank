import chalk from "chalk";
import { ActivityType, Client, Events } from "discord.js";

export const name = "Ready";
export const type = Events.ClientReady;
export const once = true;

export async function execute(client: Client) {
  // set status
  client.user?.setPresence({
    activities: [
      {
        type: ActivityType.Playing,
        name: "with sebs toes",
      },
    ],
    status: "online",
  });

  console.log(
    chalk.yellow("Ready!"),
    `Logged in as ${chalk.white.bold(client.user?.tag)}`,
  );

  console.log(
    `Serving ${chalk.yellow.bold(client.guilds.cache.size)} guild${client.guilds.cache.size === 1 ? "" : "s"}`,
    "\n",
  );
}
