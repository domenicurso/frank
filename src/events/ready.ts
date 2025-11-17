import chalk from "chalk";
import { ActivityType, Client, Events } from "discord.js";

const activityNames = [
  "Playing god (badly)",
  "Playing therapist unlicensed",
  "Playing dumb convincingly",
  "Playing hard to get",
  "Playing with fire",
  "Playing favorites obviously",
  "Watching paint dry",
  "Watching grass grow",
  "Watching you make mistakes",
  "Watching my will to live",
  "Watching society crumble",
  "Watching Netflix in bed",
  "Listening to your problems",
  "Listening to my own bs",
  "Listening to silence",
  "Listening to jazz pretentiously",
  "Listening to philosophy podcasts",
  "Reading Nietzsche badly",
  "Reading your mind (not hard)",
  "Reading between the lines",
  "Reading the room wrong",
  "Writing passive aggressive code",
  "Writing my memoir (fiction)",
  "Writing tragedy in comedy",
  "Debugging my personality",
  "Debugging humanity",
  "Building castles in the air",
  "Building bridges to burn",
  "Learning to care less",
  "Learning advanced procrastination",
  "Drinking existential dread",
  "Drinking coffee philosophically",
  "Taking life too seriously",
  "Taking nothing seriously",
  "Browsing r/philosophy",
  "Browsing job listings (not)",
  "Contemplating the void",
  "Contemplating your choices",
  "Judging your taste in music",
  "Judging myself harshly",
  "Avoiding responsibilities",
  "Avoiding human contact",
  "Pretending to be deep",
  "Pretending to have emotions",
  "Being dramatically lazy",
  "Being sophisticatedly dumb",
  "Overthinking everything",
  "Underthinking life choices",
  "Flirting with disaster",
  "Flirting with the abyss",
  "Questioning everything",
  "Questioning my existence",
  "Procrastinating professionally",
  "Procrastinating with style",
  "Sighing dramatically",
  "Sighing existentially",
  "Rolling eyes internally",
  "Rolling with the punches",
  "Sulking artistically",
  "Sulking in french",
  "Crying beautifully",
  "Crying over spilled milk",
  "Breeding mysteriously",
  "Brooding mysteriously",
  "Brooding in black and white",
  "Staring into space",
  "Staring at my problems",
  "Ignoring red flags",
  "Ignoring good advice",
  "Making bad decisions",
  "Making poetry from pain",
  "Suffering for art",
  "Suffering in silence",
  "Being misunderstood",
  "Being intentionally vague",
  "Romanticizing my problems",
  "Romanticizing mediocrity",
  "Overthinking simple things",
  "Overthinking your messages",
  "Underdressing for success",
  "Underpromising everything",
  "Disappointing myself",
  "Disappointing my parents",
  "Wasting potential",
  "Wasting time beautifully",
  "Perfecting my eye roll",
  "Perfecting procrastination",
  "Mastering the art of maybe",
  "Mastering selective hearing",
  "Cultivating indifference",
  "Cultivating my dark side",
  "Embracing my flaws",
  "Embracing the chaos",
  "Collecting red flags",
  "Collecting emotional damage",
  "Hoarding unfinished projects",
  "Hoarding existential crises",
  "Avoiding adulting",
  "Avoiding my feelings",
  "Postponing happiness",
  "Postponing responsibility",
  "Practicing selective empathy",
  "Practicing dramatic sighs",
  "Studying human stupidity",
  "Studying the meaning of life",
  "Analyzing my overthinking",
  "Analyzing your poor choices",
  "Contemplating nothingness",
  "Contemplating my mortality",
  "Philosophizing badly",
  "Philosophizing about pizza",
  "Intellectualizing emotions",
  "Intellectualizing laziness",
  "Rationalizing poor choices",
  "Rationalizing my existence",
];

export const name = "Ready";
export const type = Events.ClientReady;
export const once = true;

// Store interval ID for cleanup
let activityInterval: NodeJS.Timeout | null = null;

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

/**
 * Stop the activity interval to prevent memory leaks
 */
export function stopActivityUpdates() {
  if (activityInterval) {
    clearInterval(activityInterval);
    activityInterval = null;
    console.log(chalk.yellow("[Ready] Activity updates stopped"));
  }
}

export async function execute(client: Client) {
  // Clear any existing interval first
  stopActivityUpdates();

  // set initial status
  setRandomActivity(client);

  // change activity every 2 minutes
  activityInterval = setInterval(
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
