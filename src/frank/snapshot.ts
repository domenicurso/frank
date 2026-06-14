import { decideAttentionWithClassifier } from "@/frank/attention";
import { frankDebug } from "@/frank/debug";
import { summarizeMessages, summarizeSnapshot } from "@/frank/debugView";
import { retrieveProfileMemory } from "@/frank/memory";
import type {
  ChannelRuntimeProjection,
  FrankGuildSettings,
  ResponseSnapshot,
} from "@/frank/types";
import { randomUUID } from "node:crypto";

export async function buildResponseSnapshot(
  runtime: ChannelRuntimeProjection,
  settings: FrankGuildSettings,
  botUserId: string,
): Promise<ResponseSnapshot | null> {
  const latestMessage = runtime.visibleMessages[runtime.visibleMessages.length - 1] ?? null;
  const attentionDecision = await decideAttentionWithClassifier(
    runtime,
    latestMessage,
    settings,
    botUserId,
  );

  if (!attentionDecision.shouldRespond) {
    frankDebug("snapshot", "skipped", {
      channelId: runtime.channelId,
      reason: attentionDecision.reason,
      latestMessage: latestMessage?.content ?? null,
    });
    return null;
  }

  const focusUserId =
    attentionDecision.reason === "direct_mention" ||
    attentionDecision.reason === "reply_to_bot" ||
    attentionDecision.reason === "continuation"
      ? latestMessage?.authorId ?? null
      : null;
  const memory = await retrieveProfileMemory(runtime.guildId, runtime.visibleMessages, {
    focusUserId,
  });

  const snapshot = {
    id: randomUUID(),
    guildId: runtime.guildId,
    channelId: runtime.channelId,
    createdAt: new Date().toISOString(),
    anchorMessageId: attentionDecision.targetMessageId,
    visibleMessages: runtime.visibleMessages.slice(-12),
    pendingIntent: runtime.pendingIntent,
    memory,
    attentionDecision,
  };

  frankDebug("snapshot", "built", {
    ...summarizeSnapshot(snapshot),
    visibleChat: summarizeMessages(snapshot.visibleMessages),
  });

  return snapshot;
}
