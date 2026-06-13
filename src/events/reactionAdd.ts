import { ingestReactionAdd } from "@/frank";
import { Events, MessageReaction, User } from "discord.js";
import type { PartialMessageReaction, PartialUser } from "discord.js";

export const name = "ReactionAdd";
export const type = Events.MessageReactionAdd;

export async function execute(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
) {
  await ingestReactionAdd(reaction, user);
}
