import { getGuildConfig } from "@/database";
import type { FrankGuildSettings } from "@/frank/types";
import { parseJson } from "@/frank/json";

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export async function getFrankGuildSettings(
  guildId: string,
): Promise<FrankGuildSettings> {
  const config = await getGuildConfig(guildId);

  return {
    enabled: true,
    attentionMode:
      config?.attentionMode === "opportunistic"
        ? "opportunistic"
        : "conversation-aware",
    opportunismLevel: clampInt(config?.opportunismLevel ?? 15, 0, 100),
    reactionsEnabled: config?.reactionsEnabled ?? true,
    burstResponsesEnabled: config?.burstResponsesEnabled ?? true,
    maxBurstMessages: clampInt(config?.maxBurstMessages ?? 5, 1, 5),
    cooldownSeconds: clampInt(config?.cooldownDuration ?? 30, 0, 600),
    allowedMentions: config?.allowedMentions ?? true,
    allowedReplies: config?.allowedReplies ?? true,
  };
}

export async function isFrankChannelAllowed(
  guildId: string,
  channelId: string,
): Promise<boolean> {
  const config = await getGuildConfig(guildId);
  if (!config) return true;

  const whitelistedChannels = parseJson<string[]>(
    config.whitelistedChannels,
    [],
  );
  const blacklistedChannels = parseJson<string[]>(
    config.blacklistedChannels,
    [],
  );

  if (whitelistedChannels.length > 0) {
    return whitelistedChannels.includes(channelId);
  }

  return !blacklistedChannels.includes(channelId);
}
