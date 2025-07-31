import { confirm, select } from "@/utils/prompt";
import chalk from "chalk";
import { REST, Routes } from "discord.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Deploy options
 */
type DeployTarget = "test" | "global" | "cancel";

/**
 * Ask user for deployment target
 */
async function getDeploymentTarget(): Promise<DeployTarget> {
  const target = await select({
    message: "Where would you like to deploy?",
    choices: [
      { name: "Staging Guild", value: "test" },
      { name: "All Guilds", value: "global" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  return target as DeployTarget;
}

/**
 * Validate environment variables based on deployment target
 */
function validateEnvironment(target: DeployTarget): {
  clientId: string;
  guildId?: string;
  token: string;
} {
  const { CLIENT_ID, TEST_GUILD_ID, DISCORD_TOKEN } = process.env;

  if (!CLIENT_ID || !DISCORD_TOKEN) {
    console.error(
      chalk.red(
        "Missing required environment variables. Make sure CLIENT_ID and DISCORD_TOKEN are set.",
      ),
    );
    process.exit(1);
  }

  if (target === "test" && !TEST_GUILD_ID) {
    console.error(
      chalk.red(
        "Missing TEST_GUILD_ID environment variable required for test guild deployment.",
      ),
    );
    process.exit(1);
  }

  return {
    clientId: CLIENT_ID,
    guildId: target === "test" ? TEST_GUILD_ID : undefined,
    token: DISCORD_TOKEN,
  };
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

  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

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

async function deployCommands(
  rest: REST,
  clientId: string,
  guildId: string | undefined,
  target: string,
): Promise<void> {
  try {
    console.log(
      chalk.yellow(
        `Refreshing ${commands.length} application commands for ${target}...`,
      ),
    );

    const route = guildId
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);

    const data = await rest.put(route, { body: commands });

    console.log(
      chalk.green(
        `Successfully deployed ${(data as any[]).length} application commands to ${target}!`,
      ),
    );

    console.log(chalk.cyan("\nDeployed commands:"));
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

    if (!guildId) {
      console.log(
        chalk.yellow(
          "\nGlobal commands may take up to 1 hour to update across all guilds.",
        ),
      );
    }
  } catch (error) {
    console.error(chalk.red(`\n❌ Deployment to ${target} failed:`), error);
    throw error;
  }
}

async function deploy(): Promise<void> {
  try {
    const target = await getDeploymentTarget();

    if (target === "cancel") {
      console.log(chalk.gray("Deployment cancelled."));
      process.exit(0);
    }

    const { clientId, guildId, token } = validateEnvironment(target);

    const targetName = target === "test" ? "test guild" : "globally";
    console.log(chalk.blue(`Preparing to deploy commands ${targetName}...\n`));

    // Load commands
    console.log(chalk.cyan("Scanning commands"));
    const commandsDir = path.join(__dirname, "commands");
    console.log(chalk.gray(commandsDir));

    await loadCommandsFromDirectory(commandsDir);

    if (commands.length === 0) {
      console.log(chalk.yellow("No commands found to deploy."));
      process.exit(0);
    }

    console.log(
      chalk.blue(`\nPreparing to deploy ${commands.length} commands...\n`),
    );

    // Final confirmation for global deployment
    if (target === "global") {
      const confirmGlobal = await confirm({
        message:
          "Are you sure you want to deploy globally? This affects all servers.",
        defaultValue: false,
      });

      if (!confirmGlobal) {
        console.log(chalk.gray("Global deployment cancelled."));
        process.exit(0);
      }
      console.log();
    }

    // Create REST instance and deploy
    const rest = new REST({ version: "10" }).setToken(token);
    await deployCommands(rest, clientId, guildId, targetName);

    console.log(chalk.green.bold("\n✅ Deployment completed successfully!"));
    process.exit(0);
  } catch (error) {
    console.error(chalk.red.bold("\n❌ Deployment failed:"));
    console.error(error);
    process.exit(1);
  }
}

// Run deployment if this script is executed directly
if (import.meta.main) {
  deploy();
}

export { deploy };
