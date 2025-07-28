import chalk from "chalk";
import { ActivityType, Client, Events } from "discord.js";

const activityNames = [
  "with your emotions",
  "with your ego",
  "hard to get",
  "hard to roast",
  "god mode",
  "god complex",
  "hide and seek",
  "dumb fr",
  "dumb as hell",
  "catch me if you can",
  "the victim",
  "dead (lowkey)",
  "myself tbh",
  "tag with bugs",
  "it cool",
  "it mid",
  "pretend",
  "with fire",
  "favorites",
  "dirty",
  "doctor house",
  "chicken with common sense",
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
  "with your toes",
  "with your last brain cell",
];

export const name = "Ready";
export const type = Events.ClientReady;
export const once = true;

function setRandomActivity(client: Client) {
  client.user?.setPresence({
    activities: [
      {
        type: ActivityType.Playing,
        name: activityNames[Math.floor(Math.random() * activityNames.length)]!,
      },
    ],
    status: "online",
  });
}

export async function execute(client: Client) {
  // set initial status
  setRandomActivity(client);

  // change activity every 2 minutes
  setInterval(
    () => {
      setRandomActivity(client);
    },
    2 * 60 * 1000,
  );

  console.log(
    chalk.yellow("Ready!"),
    `Logged in as ${chalk.white.bold(client.user?.tag)}`,
  );

  console.log(
    `Serving ${chalk.yellow.bold(client.guilds.cache.size)} guild${client.guilds.cache.size === 1 ? "" : "s"}`,
    "\n",
  );
}
