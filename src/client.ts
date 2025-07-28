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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel, // Required for DM channels
    Partials.Message, // Required for DM messages
  ],
});

// Initialize the commands collection
client.commands = new Collection<string, any>();
