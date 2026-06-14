import { client } from "@/client";
import {
  initializeDatabase,
  sequelize,
  setDiscordClient,
  stopBackgroundTasks,
} from "@/database/index";
import { stopActivityUpdates } from "@/events/ready";
import { stopProcessingCleanup } from "@/events/ai";
import { stopFrankWorker } from "@/frank";
import { logError, logInfo, logWarn } from "@/log";

import chalk from "chalk";
import { Events, MessageFlags } from "discord.js";
import fs from "node:fs";
import path from "node:path";

const startTime = Date.now();
const SHUTDOWN_TIMEOUT_MS = 10_000;

const now = new Date()
  .toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
  .replace(",", "");

console.log(chalk.cyan(`\n[${now}]`));
console.log(chalk.cyan.bold(`Initializing...\n`));
client.commands.clear();

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
      logWarn("loader", "Command module missing required exports", {
        fileName,
        filePath,
      });
    }
  } catch (error) {
    logError("loader", `Failed to load command ${fileName}`, error, {
      filePath,
    });
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
    logError("loader", "Failed to read commands directory", error, {
      dirPath,
    });
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
      client.removeAllListeners(event.type);
      if (event.once) {
        if (event.type === Events.ClientReady && client.isReady()) {
          await event.execute(client);
        } else {
          client.once(event.type, (...args) => event.execute(...args));
        }
      } else {
        client.on(event.type, (...args) => event.execute(...args));
      }
    } else {
      logWarn("loader", "Event module missing required exports", {
        fileName,
        filePath,
      });
    }
  } catch (error) {
    logError("loader", `Failed to load event ${fileName}`, error, {
      filePath,
    });
  }
}

/**
 * Recursively load events from a directory and its subdirectories
 */
async function loadEventsFromDirectory(dirPath: string): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    logWarn("loader", "No events directory found; skipping event loading", {
      dirPath,
    });
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
    logError("loader", "Failed to read events directory", error, {
      dirPath,
    });
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
client.removeAllListeners(Events.InteractionCreate);
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logError("discord", "Slash command was invoked but not found", undefined, {
      commandName: interaction.commandName,
      userId: interaction.user.id,
    });
    return;
  }

  try {
    logInfo("discord", "Slash command executed", {
      command: command.name,
      user: interaction.user.username,
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });
    await command.execute(interaction);
  } catch (error) {
    logError("discord", `Command ${command.name} failed`, error, {
      command: command.name,
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });
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
  logError("boot", "Failed to initialize database", error);
  process.exit(1);
}

// Set Discord client for database operations (auto-unlock, etc.)
setDiscordClient(client);
console.log(chalk.green("Discord client configured for database operations!"));

console.log(chalk.cyan.bold(`\nInitialized in ${Date.now() - startTime}ms!\n`));

// Graceful shutdown handling
let shutdownStarted = false;
let forcedShutdownTimer: ReturnType<typeof setTimeout> | null = null;

async function withShutdownTimeout<T>(label: string, task: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${SHUTDOWN_TIMEOUT_MS}ms`));
    }, SHUTDOWN_TIMEOUT_MS);
    timeout.unref?.();

    void task.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function gracefulShutdown(signal: string) {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;

  forcedShutdownTimer = setTimeout(() => {
    console.error(
      chalk.red(
        `[${signal}] Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms. Forcing exit.`,
      ),
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forcedShutdownTimer.unref?.();

  console.log(
    chalk.yellow(`\n[${signal}] Received shutdown signal. Cleaning up...`),
  );

  try {
    // Stop all background tasks and intervals
    console.log(chalk.blue("Stopping background maintenance tasks..."));
    stopBackgroundTasks();

    console.log(chalk.blue("Stopping activity updates..."));
    stopActivityUpdates();

    console.log(chalk.blue("Stopping AI processing cleanup..."));
    stopProcessingCleanup();

    console.log(chalk.blue("Stopping Frank worker..."));
    await withShutdownTimeout("Stopping Frank worker", stopFrankWorker());

    // Gracefully close Discord client
    console.log(chalk.blue("Destroying Discord client..."));
    client.destroy();

    console.log(chalk.blue("Closing database connection..."));
    await withShutdownTimeout("Closing database connection", sequelize.close());

    console.log(chalk.green("Cleanup completed successfully"));
    if (forcedShutdownTimer) {
      clearTimeout(forcedShutdownTimer);
      forcedShutdownTimer = null;
    }
    process.exit(0);
  } catch (error) {
    console.error(chalk.red("Error during cleanup:"), error);
    if (forcedShutdownTimer) {
      clearTimeout(forcedShutdownTimer);
      forcedShutdownTimer = null;
    }
    process.exit(1);
  }
}

// Handle different shutdown signals
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGUSR1", () => void gracefulShutdown("SIGUSR1"));
process.on("SIGUSR2", () => void gracefulShutdown("SIGUSR2"));

// Handle uncaught exceptions and promise rejections
process.on("uncaughtException", (error) => {
  logError("process", "Uncaught exception", error);
  void gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  logError("process", "Unhandled rejection", reason, { promise });
  if (process.env.FRANK_STRICT_REJECTIONS?.trim().toLowerCase() === "true") {
    void gracefulShutdown("unhandledRejection");
  }
});

client.login(process.env.DISCORD_TOKEN!);
