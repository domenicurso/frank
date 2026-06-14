import { Client, Collection, GatewayIntentBits, Partials } from "discord.js";

declare module "discord.js" {
  interface Client {
    commands: Collection<string, any>;
  }
}

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
});

// Initialize the commands collection
client.commands = new Collection<string, any>();
