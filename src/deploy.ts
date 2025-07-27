import { confirm } from "@/utils/prompt";
import chalk from "chalk";
import { REST, Routes } from "discord.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Asks user if they want to deploy commands and runs deploy script if confirmed
 */
async function confirmDeploy(): Promise<boolean> {
  const shouldDeploy = await confirm({
    message: "Deploy slash commands?",
    defaultValue: false,
  });

  console.log("\n");

  if (shouldDeploy) {
    console.log(chalk.yellow("Deploying commands...\n"));
    return true;
  } else {
    console.log(chalk.gray.italic("Exiting deployment..."));
    return false;
  }
}

// Ask if user wants to deploy commands first
try {
  const shouldDeploy = await confirmDeploy();
  if (!shouldDeploy) {
    process.exit(0);
  }
} catch (error) {
  console.error(chalk.red("\nDeploy cancelled:"), error);
  process.exit(1);
}

// Load required environment variables
const { CLIENT_ID, GUILD_ID, DISCORD_TOKEN } = process.env;

if (!CLIENT_ID || !GUILD_ID || !DISCORD_TOKEN) {
  console.error(
    chalk.red(
      "Missing environment variables. Make sure CLIENT_ID, GUILD_ID, and DISCORD_TOKEN are set.",
    ),
  );
  process.exit(1);
}

// Array to hold the command data JSON
const commands: any[] = [];

/**
 * Load a single command file and add it to the commands array
 */
async function loadCommandFile(
  filePath: string,
  fileName: string,
  indent: string = "     ",
): Promise<void> {
  process.stdout.write(chalk.cyan(`${indent}${fileName.padEnd(20)}  `));

  // Store original console methods to silence output from imported files
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  // Replace console methods with no-op functions
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
  console.debug = () => {};

  try {
    const command = await import(filePath);

    // Restore console methods
    Object.assign(console, originalConsole);

    if ("definition" in command && "execute" in command) {
      commands.push(command.definition.toJSON());
      console.log(chalk.green(`Loaded ${command.definition.name || fileName}`));
    } else {
      console.log(
        chalk.yellow(
          `${fileName} is missing "definition" or "execute" property`,
        ),
      );
    }
  } catch (error) {
    // Restore console methods in case of error
    Object.assign(console, originalConsole);
    console.log(chalk.red(`${indent}Failed to load ${fileName}: ${error}`));
  }
}

/**
 * Recursively load commands from a directory and its subdirectories
 */
async function loadCommandsFromDirectory(
  dirPath: string,
  indent: string = "  ",
): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively load commands from subdirectory
        await loadCommandsFromDirectory(fullPath, indent);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".js") || entry.name.endsWith(".ts"))
      ) {
        await loadCommandFile(fullPath, entry.name, indent);
      }
    }
  } catch (error) {
    console.error(`Error reading commands directory ${dirPath}:`, error);
  }
}

console.log(chalk.cyan("Scanning commands"));

// Path to your commands directory
const commandsDir = path.join(__dirname, "commands");

console.log(chalk.gray(commandsDir));

await loadCommandsFromDirectory(commandsDir);

console.log(chalk.blue(`\nPreparing to deploy ${commands.length} commands...`));

// Construct and prepare an instance of the REST module
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

// Deploy commands
(async () => {
  try {
    console.log(
      chalk.yellow(`Refreshing ${commands.length} application commands...`),
    );

    const data = await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands },
    );

    console.log(
      chalk.green(
        `Successfully deployed ${(data as any[]).length} application commands!`,
      ),
    );

    console.log(chalk.cyan("\nDeployed commands"));
    commands.forEach((cmd, index) => {
      console.log(
        chalk.gray(
          `  ${(index + 1).toString().padStart(commands.length.toString().length)}. `,
        ) +
          chalk.yellow.bold(`/${cmd.name.padEnd(15)}`) +
          chalk.gray(" - ") +
          chalk.white(cmd.description),
      );
    });

    process.exit(0);
  } catch (error) {
    console.error(chalk.red("\n❌ Deployment failed:"), error);
    process.exit(1);
  }
})();
