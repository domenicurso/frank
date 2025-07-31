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

interface SelectChoice {
  name: string;
  value: string;
}

interface SelectOptions {
  message?: string;
  choices: SelectChoice[];
}

/**
 * Simple select prompt with arrow key navigation
 */
export async function select(options: SelectOptions): Promise<string> {
  const { message = "Select an option:", choices } = options;

  if (choices.length === 0) {
    throw new Error("No choices provided");
  }

  let selectedIndex = 0;

  const renderChoices = () => {
    process.stdout.write("\r\x1b[K"); // Clear current line
    process.stdout.write(chalk.blue.bold("? ") + chalk.yellow(message) + "\n");

    choices.forEach((choice, index) => {
      const isSelected = index === selectedIndex;
      const prefix = isSelected ? chalk.cyan("❯ ") : "  ";
      const text = isSelected ? chalk.cyan.bold(choice.name) : choice.name;
      process.stdout.write(prefix + text + "\n");
    });

    // Move cursor up to overwrite on next render
    process.stdout.write(`\x1b[${choices.length + 1}A`);
  };

  // Initial render
  renderChoices();

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

      // Clear the menu and show final selection
      process.stdout.write("\r\x1b[K");
      for (let i = 0; i < choices.length; i++) {
        process.stdout.write("\x1b[1B\r\x1b[K"); // Move down and clear line
      }
      process.stdout.write(`\x1b[${choices.length}A`); // Move back up
      process.stdout.write(
        chalk.blue.bold("? ") +
          chalk.yellow(message) +
          " " +
          chalk.cyan(choices[selectedIndex]!.name) +
          "\n",
      );
    };

    process.stdin.on("data", (key: string) => {
      if (key === "\u001b[A") {
        // Up arrow
        selectedIndex =
          selectedIndex > 0 ? selectedIndex - 1 : choices.length - 1;
        renderChoices();
      } else if (key === "\u001b[B") {
        // Down arrow
        selectedIndex =
          selectedIndex < choices.length - 1 ? selectedIndex + 1 : 0;
        renderChoices();
      } else if (key === "\r" || key === "\n") {
        // Enter key
        cleanup();
        resolve(choices[selectedIndex]!.value);
      } else if (key === "\u0003") {
        // Ctrl+C
        cleanup();
        process.stdout.write(chalk.red("^C\n"));
        process.exit(0);
      }
    });
  });
}
