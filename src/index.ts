import { client } from "@/client";
import { initializeDatabase, setDiscordClient } from "@/database/index";
import { trackCommandUsage } from "@/database/userStats";

import chalk from "chalk";
import { Events, MessageFlags } from "discord.js";
import fs from "node:fs";
import path from "node:path";

const startTime = Date.now();

const now = new Date()
  .toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  .replace(",", "");

console.log(chalk.cyan(`\n[${now}]`));
console.log(chalk.cyan.bold(`Initializing...\n`));

// Database initialization happens in initializeDatabase()

// create & load commands
const commandsPath = path.join(__dirname, "commands");
const loadedCommands: string[] = [];

/**
 * Load a single command file
 */
async function loadCommandFile(
  filePath: string,
  fileName: string,
): Promise<void> {
  try {
    const command = await import(filePath);
    if (command.definition && command.execute && command.name) {
      client.commands.set(command.definition.name, command); // <-- store on client
      loadedCommands.push(command.name);
    } else {
      console.error(`Missing definition, execute, or name in ${filePath}`);
    }
  } catch (error) {
    console.error(`Error loading command ${fileName}:`, error);
  }
}

/**
 * Recursively load commands from a directory and its subdirectories
 */
async function loadCommandsFromDirectory(dirPath: string): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively load commands from subdirectory
        await loadCommandsFromDirectory(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".js") || entry.name.endsWith(".ts"))
      ) {
        await loadCommandFile(fullPath, entry.name);
      }
    }
  } catch (error) {
    console.error(`Error reading commands directory ${dirPath}:`, error);
  }
}

await loadCommandsFromDirectory(commandsPath);

// load events
const eventsPath = path.join(__dirname, "events");
const loadedEvents: string[] = [];

/**
 * Load a single event file
 */
async function loadEventFile(
  filePath: string,
  fileName: string,
): Promise<void> {
  try {
    const event = await import(filePath);
    if (event.name && event.type && event.execute) {
      loadedEvents.push(event.name || event.type);
      if (event.once) {
        client.once(event.type, (...args) => event.execute(...args));
      } else {
        client.on(event.type, (...args) => event.execute(...args));
      }
    } else {
      console.error(`Missing name, type, or execute in ${filePath}`);
    }
  } catch (error) {
    console.error(`Error loading event ${fileName}:`, error);
  }
}

/**
 * Recursively load events from a directory and its subdirectories
 */
async function loadEventsFromDirectory(dirPath: string): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    console.log("No events directory found, skipping event loading");
    return;
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively load events from subdirectory
        await loadEventsFromDirectory(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".js") || entry.name.endsWith(".ts"))
      ) {
        await loadEventFile(fullPath, entry.name);
      }
    }
  } catch (error) {
    console.error(`Error reading events directory ${dirPath}:`, error);
  }
}

await loadEventsFromDirectory(eventsPath);

console.log(
  chalk.green(`Commands loaded`),
  ["", ...loadedCommands]
    .map((cmd) => chalk.white(cmd))
    .join(chalk.gray("\n  - ")),
);

console.log(
  chalk.green(`\nEvents loaded`),
  ["", ...loadedEvents]
    .map((event) => chalk.white(event))
    .join(chalk.gray("\n  - ")),
);

// Command handler
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found`);
    return;
  }

  try {
    console.log(
      `${chalk.green(new Date().toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }))} ${chalk.blue.bold(interaction.user.username)} executed ${chalk.yellow.bold(command.name)} command`,
    );
    await command.execute(interaction);

    // Track command usage for user stats
    if (interaction.guild) {
      await trackCommandUsage(interaction.user.id, interaction.guild.id);
    }
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error while executing this command!",
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: "There was an error while executing this command!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

console.log();

// Initialize database before logging in
try {
  const isDevelopment =
    process.env.NODE_ENV === "development" || !process.env.DATABASE_URL;
  console.log(
    chalk.blue(
      `[DB] Using ${isDevelopment ? "SQLite (development)" : "PostgreSQL (production)"} database`,
    ),
  );
  await initializeDatabase();
  console.log(chalk.green("\nDatabase initialized successfully!"));
} catch (error) {
  console.error(chalk.red("\nFailed to initialize database:"), error);
  process.exit(1);
}

// Set Discord client for database operations (auto-unlock, etc.)
setDiscordClient(client);
console.log(chalk.green("Discord client configured for database operations!"));

console.log(chalk.cyan.bold(`\nInitialized in ${Date.now() - startTime}ms!\n`));

client.login(process.env.DISCORD_TOKEN!);
