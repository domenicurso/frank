import chalk from "chalk";
import { ActivityType, Client, Events } from "discord.js";

const activityNames = [
  "hide and seek with bugs",
  "chess with AI overlords",
  "peek-a-boo with servers",
  "tag with memory leaks",
  "hopscotch on keyboards",
  "rock paper scissors with bots",
  "musical chairs with processes",
  "red light green light with APIs",
  "duck duck goose with databases",
  "freeze dance with threads",
  "hot potato with exceptions",
  "simon says with protocols",
  "telephone with packets",
  "charades with algorithms",
  "20 questions with compilers",
  "scavenger hunt for semicolons",
  "marco polo with network pings",
  "capture the flag with security",
  "king of the hill with cache",
  "tug of war with bandwidth",
  "leapfrog over functions",
  "limbo under deadlines",
  "spin the bottle with dependencies",
  "twister with spaghetti code",
  "monkey in the middle with middleware",
  "patty cake with parallel processing",
  "london bridge with connections",
  "ring around the rosie with loops",
  "cat and mouse with debuggers",
  "follow the leader with git commits",
  "mother may I with permissions",
  "statues with frozen threads",
  "blind man's bluff with logs",
  "sharks and minnows with data",
  "what time is it with timestamps",
  "octopus tag with tentacles",
  "sardines with compressed files",
  "kick the can with containers",
  "spud with stack traces",
  "four square with quadrants",
  "hopscotch through directories",
  "jump rope with recursive calls",
  "double dutch with dual cores",
  "hula hoop with infinite loops",
  "pogo stick with bouncing balls",
  "stilts with elevated privileges",
  "unicycle through single threads",
  "skateboard down code slides",
  "roller skates through rollbacks",
  "ice skating on frozen lakes",
  "with sebs toes",
];

export const name = "Ready";
export const type = Events.ClientReady;
export const once = true;

export async function execute(client: Client) {
  // set status
  client.user?.setPresence({
    activities: [
      {
        type: ActivityType.Playing,
        name:
          activityNames[Math.floor(Math.random() * activityNames.length)] ||
          "something idk",
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
