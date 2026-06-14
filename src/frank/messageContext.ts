import type { ResponseSnapshot, VisibleMessage } from "@/frank/types";

function truncate(value: string, max = 80) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function fallbackUsername(value: string | undefined, displayName: string) {
  const base = value?.trim() || displayName.trim() || "user";
  return base.replace(/^@+/, "");
}

export function humanizedUserToken(user: {
  username?: string;
  displayName: string;
}) {
  const username = fallbackUsername(user.username, user.displayName);
  return `@${username} (${user.displayName})`;
}

export function humanizedChannelToken(channel: { name: string }) {
  return `#${channel.name}`;
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const itemKey = key(item);
    if (seen.has(itemKey)) continue;
    seen.add(itemKey);
    result.push(item);
  }

  return result;
}

export function collectHumanizedUsers(messages: VisibleMessage[]) {
  const authors = messages.map((message) => ({
    id: message.authorId,
    username: fallbackUsername(message.authorUsername, message.authorName),
    displayName: message.authorName,
  }));
  const mentions = messages.flatMap((message) => message.mentionedUsers ?? []);

  return uniqueBy([...authors, ...mentions], (user) => user.id);
}

export function collectHumanizedChannels(messages: VisibleMessage[]) {
  return uniqueBy(
    messages.flatMap((message) => message.mentionedChannels ?? []),
    (channel) => channel.id,
  );
}

export function humanizeDiscordContent(message: Pick<
  VisibleMessage,
  "content" | "mentionedUsers" | "mentionedChannels"
>) {
  let content = message.content;

  for (const user of message.mentionedUsers ?? []) {
    const token = humanizedUserToken(user);
    content = content
      .split(`<@${user.id}>`)
      .join(token)
      .split(`<@!${user.id}>`)
      .join(token);
  }

  for (const channel of message.mentionedChannels ?? []) {
    content = content
      .split(`<#${channel.id}>`)
      .join(humanizedChannelToken(channel));
  }

  return content.trim();
}

function resolveReplyContext(
  message: VisibleMessage,
  visibleMessages: VisibleMessage[],
) {
  if (!message.replyToMessageId) {
    return null;
  }

  const resolved =
    visibleMessages.find((candidate) => candidate.id === message.replyToMessageId) ??
    null;

  if (resolved) {
    return {
      authorToken: humanizedUserToken({
        username: resolved.authorUsername,
        displayName: resolved.authorName,
      }),
      content: humanizeDiscordContent(resolved),
    };
  }

  if (message.replyPreview) {
    return {
      authorToken: humanizedUserToken({
        username: message.replyPreview.authorUsername,
        displayName: message.replyPreview.authorName,
      }),
      content: message.replyPreview.content,
    };
  }

  return null;
}

function attachmentLabel(message: VisibleMessage) {
  return (message.attachments ?? []).slice(0, 3).map((attachment) => {
    const mediaType = attachment.contentType.toLowerCase();
    const kind = mediaType.startsWith("image/gif")
      ? "gif"
      : mediaType.startsWith("image/")
        ? "image"
        : mediaType.startsWith("video/")
          ? "video"
          : "file";

    return `+ ${kind}: ${attachment.name}`;
  });
}

export function renderVisibleMessage(
  message: VisibleMessage,
  visibleMessages: VisibleMessage[],
) {
  const replyContext = resolveReplyContext(message, visibleMessages);
  const content = humanizeDiscordContent(message) || "<empty>";
  const authorToken = humanizedUserToken({
    username: message.authorUsername,
    displayName: message.authorName,
  });
  const contextLines: string[] = [];

  if (replyContext) {
    contextLines.push(
      `  + reply: [${replyContext.authorToken}] "${truncate(
        replyContext.content || "<empty>",
        72,
      )}"`,
    );
  }

  contextLines.push(...attachmentLabel(message).map((line) => `  ${line.trimStart()}`));

  if (contextLines.length === 0) {
    return `[${authorToken}] ${content}`;
  }

  return [`[${authorToken}] ${content}`, ...contextLines].join("\n");
}

export function renderTokenGuide(snapshot: ResponseSnapshot) {
  const tokenMessages =
    snapshot.focusMessages && snapshot.focusMessages.length > 0
      ? snapshot.focusMessages
      : snapshot.visibleMessages;

  const users = collectHumanizedUsers(tokenMessages)
    .map((user) => `- ${humanizedUserToken(user)}`)
    .slice(0, 12);
  const channels = collectHumanizedChannels(tokenMessages)
    .map((channel) => `- ${humanizedChannelToken(channel)}`)
    .slice(0, 12);

  return [
    users.length > 0 ? `People:\n${users.join("\n")}` : "People:\n- none",
    channels.length > 0
      ? `Channels:\n${channels.join("\n")}`
      : "Channels:\n- none",
  ].join("\n\n");
}

export function toDiscordContent(
  text: string,
  visibleMessages: VisibleMessage[],
) {
  let content = text;

  const users = collectHumanizedUsers(visibleMessages).sort(
    (left, right) =>
      humanizedUserToken(right).length - humanizedUserToken(left).length,
  );
  const channels = collectHumanizedChannels(visibleMessages).sort(
    (left, right) =>
      humanizedChannelToken(right).length - humanizedChannelToken(left).length,
  );

  for (const user of users) {
    const fullToken = humanizedUserToken(user);
    const shortToken = `@${user.username}`;
    content = content.split(fullToken).join(`<@${user.id}>`);
    content = content.split(shortToken).join(`<@${user.id}>`);
  }

  for (const channel of channels) {
    const token = humanizedChannelToken(channel);
    content = content.split(token).join(`<#${channel.id}>`);
  }

  return content;
}
