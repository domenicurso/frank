#!/usr/bin/env bun

import chalk from "chalk";
import { initializeDatabase } from "./src/database/index.js";
import { CooldownManager } from "./src/utils/cooldown.js";

console.log(chalk.cyan.bold("🧪 Cooldown System Test\n"));

async function runTests() {
  try {
    // Initialize database
    console.log(chalk.yellow("Initializing database..."));
    await initializeDatabase();
    console.log(chalk.green("✅ Database initialized\n"));

    // Test 1: Basic user cooldown
    console.log(chalk.blue("Test 1: Basic user cooldown"));
    const userId = "test_user_123";
    const identifier = "test_command";

    // Check initial state (should not be on cooldown)
    let result = await CooldownManager.checkUserCooldown(userId, identifier);
    console.log(
      `Initial check: ${result.onCooldown ? "❌ ON COOLDOWN" : "✅ NOT ON COOLDOWN"}`,
    );

    // Set cooldown
    await CooldownManager.setUserCooldown(userId, identifier, 5000); // 5 seconds
    console.log("Set 5-second cooldown");

    // Check again (should be on cooldown)
    result = await CooldownManager.checkUserCooldown(userId, identifier);
    console.log(
      `After setting: ${result.onCooldown ? "✅ ON COOLDOWN" : "❌ NOT ON COOLDOWN"}`,
    );
    if (result.onCooldown) {
      console.log(`Time left: ${result.timeLeftFormatted}`);
    }

    // Test 2: Global cooldown
    console.log(chalk.blue("\nTest 2: Global cooldown"));

    // Check global cooldown (should not be on cooldown)
    result = await CooldownManager.checkGlobalCooldown("global_test");
    console.log(
      `Global initial: ${result.onCooldown ? "❌ ON COOLDOWN" : "✅ NOT ON COOLDOWN"}`,
    );

    // Set global cooldown
    await CooldownManager.setGlobalCooldown("global_test", 3000); // 3 seconds
    console.log("Set 3-second global cooldown");

    // Check again
    result = await CooldownManager.checkGlobalCooldown("global_test");
    console.log(
      `Global after setting: ${result.onCooldown ? "✅ ON COOLDOWN" : "❌ NOT ON COOLDOWN"}`,
    );
    if (result.onCooldown) {
      console.log(`Global time left: ${result.timeLeftFormatted}`);
    }

    // Test 3: Guild cooldown
    console.log(chalk.blue("\nTest 3: Guild cooldown"));
    const guildId = "test_guild_456";

    result = await CooldownManager.checkGuildCooldown(guildId, "guild_test");
    console.log(
      `Guild initial: ${result.onCooldown ? "❌ ON COOLDOWN" : "✅ NOT ON COOLDOWN"}`,
    );

    await CooldownManager.setGuildCooldown(guildId, "guild_test", 2000); // 2 seconds
    console.log("Set 2-second guild cooldown");

    result = await CooldownManager.checkGuildCooldown(guildId, "guild_test");
    console.log(
      `Guild after setting: ${result.onCooldown ? "✅ ON COOLDOWN" : "❌ NOT ON COOLDOWN"}`,
    );

    // Test 4: Channel cooldown
    console.log(chalk.blue("\nTest 4: Channel cooldown"));
    const channelId = "test_channel_789";

    result = await CooldownManager.checkChannelCooldown(
      channelId,
      "channel_test",
    );
    console.log(
      `Channel initial: ${result.onCooldown ? "❌ ON COOLDOWN" : "✅ NOT ON COOLDOWN"}`,
    );

    await CooldownManager.setChannelCooldown(channelId, "channel_test", 1000); // 1 second
    console.log("Set 1-second channel cooldown");

    result = await CooldownManager.checkChannelCooldown(
      channelId,
      "channel_test",
    );
    console.log(
      `Channel after setting: ${result.onCooldown ? "✅ ON COOLDOWN" : "❌ NOT ON COOLDOWN"}`,
    );

    // Test 5: Multiple cooldowns for same user
    console.log(chalk.blue("\nTest 5: Multiple cooldowns for same user"));
    await CooldownManager.setUserCooldown(userId, "command1", 10000);
    await CooldownManager.setUserCooldown(userId, "command2", 15000);
    await CooldownManager.setUserCooldown(userId, "command3", 20000);

    const userCooldowns = await CooldownManager.getUserCooldowns(userId);
    console.log(`User has ${userCooldowns.length} active cooldowns:`);
    for (const cooldown of userCooldowns) {
      const timeLeft = new Date(cooldown.expiresAt).getTime() - Date.now();
      const formatted = CooldownManager.formatTime(Math.max(0, timeLeft));
      console.log(`  - ${cooldown.cooldownKey}: ${formatted}`);
    }

    // Test 6: Wait for expiration
    console.log(chalk.blue("\nTest 6: Wait for cooldown expiration"));
    console.log("Waiting 2 seconds for some cooldowns to expire...");

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check channel cooldown (should be expired)
    result = await CooldownManager.checkChannelCooldown(
      channelId,
      "channel_test",
    );
    console.log(
      `Channel after 2s: ${result.onCooldown ? "❌ STILL ON COOLDOWN" : "✅ EXPIRED"}`,
    );

    // Check guild cooldown (should be expired)
    result = await CooldownManager.checkGuildCooldown(guildId, "guild_test");
    console.log(
      `Guild after 2s: ${result.onCooldown ? "❌ STILL ON COOLDOWN" : "✅ EXPIRED"}`,
    );

    // Check global cooldown (should be expired)
    result = await CooldownManager.checkGlobalCooldown("global_test");
    console.log(
      `Global after 2s: ${result.onCooldown ? "❌ STILL ON COOLDOWN" : "✅ EXPIRED"}`,
    );

    // Test 7: Removal
    console.log(chalk.blue("\nTest 7: Manual cooldown removal"));
    const removed = await CooldownManager.removeCooldown(
      userId,
      "command1",
      "user",
    );
    console.log(
      `Removed command1 cooldown: ${removed ? "✅ SUCCESS" : "❌ FAILED"}`,
    );

    // Test 8: Clear all user cooldowns
    console.log(chalk.blue("\nTest 8: Clear all user cooldowns"));
    const cleared = await CooldownManager.clearUserCooldowns(userId);
    console.log(`Cleared ${cleared} cooldown(s) for user`);

    const remainingCooldowns = await CooldownManager.getUserCooldowns(userId);
    console.log(`User now has ${remainingCooldowns.length} active cooldowns`);

    // Test 9: Format time function
    console.log(chalk.blue("\nTest 9: Time formatting"));
    console.log(`5000ms = ${CooldownManager.formatTime(5000)}`);
    console.log(`65000ms = ${CooldownManager.formatTime(65000)}`);
    console.log(`3661000ms = ${CooldownManager.formatTime(3661000)}`);
    console.log(`0ms = ${CooldownManager.formatTime(0)}`);
    console.log(`NaN = ${CooldownManager.formatTime(NaN)}`);

    // Test 10: Duration parsing
    console.log(chalk.blue("\nTest 10: Duration parsing"));
    try {
      console.log(`"5s" = ${CooldownManager.parseDuration("5s")}ms`);
      console.log(`"10m" = ${CooldownManager.parseDuration("10m")}ms`);
      console.log(`"1h" = ${CooldownManager.parseDuration("1h")}ms`);
      console.log(`"1d" = ${CooldownManager.parseDuration("1d")}ms`);
    } catch (error) {
      console.log(`Parse error: ${error}`);
    }

    try {
      console.log(`"invalid" = ${CooldownManager.parseDuration("invalid")}ms`);
    } catch (error) {
      console.log(`✅ Correctly caught invalid format: ${error}`);
    }

    console.log(chalk.green.bold("\n🎉 All tests completed successfully!"));
  } catch (error) {
    console.error(chalk.red.bold("\n❌ Test failed:"), error);
    process.exit(1);
  }
}

// Run tests
runTests().then(() => {
  console.log(chalk.cyan("\n✨ Test suite finished"));
  process.exit(0);
});
