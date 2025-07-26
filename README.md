# Bot of Doom

**Bot of Doom** is a Discord bot with AI chat capabilities, moderation tools, and community management features.

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0+)
- Discord Bot Token
- OpenRouter API Key (for AI features)

### Installation

1. **Clone the repository**

   ```bash
   gh repo clone DomBom16/bot-of-doom
   cd bot-of-doom
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Environment Setup**
   
   Create a `.env` file in the root directory:

   ```env
   DISCORD_TOKEN =
   CLIENT_ID =
   GUILD_ID =
   OPENROUTER_API_KEY =
   ```

4. **Deploy Commands**

   ```bash
   # Deploy slash commands to Discord
   bun run deploy
   ```

5. **Start the Bot**
   ```bash
   # Runs the bot
   bun run start
   ```

### Adding New Commands

1. Create a new file in `src/commands/` or `src/commands/moderation/`
2. Export the required properties:
   ```typescript
   export const name = "CommandName";
   export const definition = new SlashCommandBuilder()...;
   export async function execute(interaction) {...}
   ```
3. Commands are automatically loaded on startup

### Adding New Events

1. Create a new file in `src/events/`
2. Export the required properties:
   ```typescript
   export const name = "EventName";
   export const type = Events.MessageCreate;
   export async function execute(...args) {...}
   ```

### Environment Variables

Required:

- `DISCORD_TOKEN` - Your Discord bot token
- `OPENROUTER_API_KEY` - OpenRouter API key for AI features

Optional:

- `NODE_ENV` - Set to `production` for production deployment

---

_Built with ❤️ using Bun, TypeScript, and Discord.js_
