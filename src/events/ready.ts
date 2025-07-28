import chalk from "chalk";
import { ActivityType, Client, Events } from "discord.js";

const activityNames = [
  "with your emotions",
  "hard to get",
  "god mode",
  "hide and seek",
  "dumb fr",
  "catch me if you can",
  "the victim",
  "dead (lowkey)",
  "myself tbh",
  "tag with bugs",
  "it cool",
  "pretend",
  "with fire",
  "favorites",
  "dirty",
  "for keeps",
  "house",
  "doctor",
  "chicken",
  "dead",
  "marco polo",
  "red light green light",
  "simon says",
  "patty cake",
  "peek-a-boo",
  "rock paper scissors",
  "twenty questions",
  "would you rather",
  "truth or dare",
  "spin the bottle",
  "musical chairs",
  "freeze dance",
  "hot potato",
  "telephone",
  "charades",
  "pictionary",
  "tic tac toe",
  "checkers",
  "chess",
  "uno",
  "poker",
  "blackjack",
  "solitaire",
  "minesweeper",
  "tetris",
  "pacman",
  "snake",
  "pong",
  "frogger",
  "doodle jump",
  "flappy bird",
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
