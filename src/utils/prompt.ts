import chalk from "chalk";

interface PromptOptions {
  message?: string;
  defaultValue?: boolean;
}

/**
 * Simple confirm prompt that accepts only 'y' or 'n' keystrokes and auto-submits
 */
export async function confirm(options: PromptOptions = {}): Promise<boolean> {
  const { message = "Continue?", defaultValue = false } = options;

  const defaultText = defaultValue
    ? chalk.green.bold("Y") + chalk.gray("/n")
    : chalk.gray("y/") + chalk.red.bold("N");

  process.stdout.write(
    chalk.blue.bold("? ") +
      chalk.yellow(message) +
      " " +
      chalk.gray("(") +
      defaultText +
      chalk.gray(") "),
  );

  return new Promise((resolve) => {
    // Set raw mode to capture individual keystrokes
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.stdin.removeAllListeners("data");
    };

    process.stdin.on("data", (key: string) => {
      const keyPressed = key.toLowerCase();

      if (keyPressed === "y") {
        process.stdout.write(chalk.green.bold("y"));
        cleanup();
        resolve(true);
      } else if (keyPressed === "n") {
        process.stdout.write(chalk.red.bold("n"));
        cleanup();
        resolve(false);
      } else if (key === "\r" || key === "\n") {
        // Enter key pressed - use default
        const choice = defaultValue ? "y" : "n";
        const color = defaultValue ? chalk.green.bold : chalk.red.bold;
        process.stdout.write(color(choice));
        cleanup();
        resolve(defaultValue);
      } else if (key === "\u0003") {
        // Ctrl+C
        process.stdout.write(chalk.red("\n^C\n"));
        cleanup();
        process.exit(0);
      }
      // Ignore all other keystrokes
    });
  });
}
