import { getTopMessageUsers } from "@/database/userStats";
import { CooldownManager } from "@/utils/cooldown";
import { Events, Guild, TextChannel, User, VoiceState } from "discord.js";

export const name = "AutoHopOnPing";
export const type = Events.VoiceStateUpdate;

export async function execute(oldState: VoiceState, newState: VoiceState) {
  if (newState.channelId && !oldState.channelId) {
    const member = newState.member;
    const user: User | null = member ? member.user : null;

    if (user && newState.channel && newState.guild) {
      const guild: Guild = newState.guild;

      // Check guild-wide cooldown to prevent spam
      const cooldownResult = await CooldownManager.checkGuildCooldown(
        guild.id,
        name,
      );

      if (cooldownResult.onCooldown) {
        return;
      }

      const targetChannel = guild.channels.cache.find(
        (channel) => channel.name === "blasphemy",
      );

      if (targetChannel && targetChannel.isTextBased()) {
        try {
          // Get top 3 users by message count
          const topUsers = await getTopMessageUsers(guild.id, 3);

          let message = "Hop on bitches";
          if (topUsers.length > 0) {
            const userPings = topUsers
              .map((user) => `<@${user.userId}>`)
              .join(" ");
            message = `${userPings} Hop on`;
          }

          await (targetChannel as TextChannel).send({ content: message });

          await CooldownManager.setGuildCooldown(
            guild.id,
            name,
            4 * 60 * 60 * 1000,
          );
        } catch (error) {
          console.error(`Error sending message to general channel: ${error}`);
        }
      } else {
        console.log(
          'Could not find the "blasphemy" channel or it is not a text channel.',
        );
      }
    }
  }
}
