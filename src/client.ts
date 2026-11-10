import type { ChatRecord, IdMapFile, MessageRecord, TokenBundle, UserRecord } from "./types";
import { CHATSVC_BASE, USER_AGENT } from "./constants";
import { loadIdMap, saveIdMap } from "./store";
import { httpRequest } from "./http";
import {
  decodeHtmlEntities,
  detectChatType,
  escapeHtml,
  isProbablyConversationId,
  looksLikeGuid,
  makeClientMessageId,
  paragraphsToHtml,
  parseDate,
  stripHtml,
} from "./utils";

export class ApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly body?: string) {
    super(message);
  }
}

export class TeamsIc3Client {
  private readonly baseUrl: string;
  private readonly userMri: string;
  private idMapPromise: Promise<IdMapFile>;

  constructor(private readonly bundle: TokenBundle) {
    this.baseUrl = CHATSVC_BASE(bundle.region);
    this.userMri = `8:orgid:${bundle.userId}`;
    this.idMapPromise = loadIdMap();
  }

  async getChats(options: { top?: number; skip?: number; unreadOnly?: boolean; persistMap?: boolean } = {}): Promise<ChatRecord[]> {
    const top = options.top ?? 25;
    const skip = options.skip ?? 0;
    const unreadOnly = options.unreadOnly ?? false;
    const persistMap = options.persistMap ?? true;
    const fetchSize = Math.max((top + skip) * 2, 200);

    const response = await this.request<{ conversations?: Record<string, unknown>[] }>("GET", "/users/ME/conversations", {
      params: {
        view: "msnp24Equivalent",
        pageSize: String(fetchSize),
        startTime: "0",
        targetType: "Passport|Skype|Lync|Thread|NotificationStream|cnsContact",
      },
    });

    const chats = (response.conversations || [])
      .filter((conv) => {
        const id = String(conv.id || "");
        return !id.startsWith("48:") && !id.startsWith("28:");
      })
      .map((conv) => this.parseChat(conv))
      .filter((chat) => (unreadOnly ? chat.unreadCount > 0 : true))
      .sort((a, b) => Date.parse(b.lastMessageTime) - Date.parse(a.lastMessageTime));

    const page = chats.slice(skip, skip + top).map((chat, index) => ({
      ...chat,
      displayNum: index + 1,
    }));

    if (persistMap) {
      const idMap = await this.idMapPromise;
      idMap.chats = Object.fromEntries(page.map((chat) => [String(chat.displayNum), chat.id]));
      await saveIdMap(idMap);
    }

    return page;
  }

  async getChatMessages(chatRef: string, options: { top?: number; skip?: number; persistMap?: boolean } = {}): Promise<MessageRecord[]> {
    const top = options.top ?? 25;
    const skip = options.skip ?? 0;
    const persistMap = options.persistMap ?? true;
    const convId = await this.resolveChatId(chatRef);

    const response = await this.request<{ messages?: Record<string, unknown>[] }>(
      "GET",
      `/users/ME/conversations/${encodeURIComponent(convId)}/messages`,
      {
        params: {
          view: "msnp24Equivalent|supportsMessageProperties",
          pageSize: String(Math.max(top + skip, 50)),
        },
      },
    );

    let messages = (response.messages || [])
      .map((message) => this.parseMessage(message, convId))
      .filter((message) => ["Text", "RichText/Html", "RichText"].includes(message.messageType))
      .reverse();

    messages = messages.slice(-(top + skip));
    if (skip) {
      messages = messages.slice(skip);
    }

    if (persistMap) {
      await this.rememberMessages(messages);
    }

    return messages;
  }

  async getMessageDetail(msgRef: string): Promise<MessageRecord> {
    const idMap = await this.idMapPromise;
    const mapped = idMap.messages[msgRef];
    if (!mapped) {
      throw new Error(`Unknown message #${msgRef}. Run 'teams-ic3 chat <chat>' or 'teams-ic3 search <query>' first.`);
    }

    const response = await this.request<{ messages?: Record<string, unknown>[] }>(
      "GET",
      `/users/ME/conversations/${encodeURIComponent(mapped.conv)}/messages`,
      {
        params: {
          view: "msnp24Equivalent|supportsMessageProperties",
          pageSize: "100",
        },
      },
    );

    const raw = (response.messages || []).find((message) => {
      const id = String(message.id || message.sequenceId || message.version || "");
      return id === String(mapped.msg);
    });

    if (!raw) {
      throw new Error(`Message #${msgRef} not found`);
    }

    const message = this.parseMessage(raw, mapped.conv);
    message.displayNum = Number(msgRef);
    message.chatTitle = (await this.getChatTitle(mapped.conv)) || undefined;
    return message;
  }

  async searchMessages(query: string, options: { top?: number; offset?: number; chatRef?: string } = {}): Promise<MessageRecord[]> {
    const top = options.top ?? 25;
    const offset = options.offset ?? 0;
    const queryLower = query.toLowerCase();
    let results: MessageRecord[] = [];

    if (options.chatRef) {
      const convId = await this.resolveChatId(options.chatRef);
      const title = await this.getChatTitle(convId);
      const messages = await this.getChatMessages(convId, { top: 200, persistMap: false });
      results = messages.filter((message) => message.textContent.toLowerCase().includes(queryLower));
      for (const message of results) message.chatTitle = title;
    } else {
      const chats = await this.getChats({ top: 12, persistMap: false });
      for (const chat of chats) {
        try {
          const messages = await this.getChatMessages(chat.id, { top: 60, persistMap: false });
          for (const message of messages) {
            if (message.textContent.toLowerCase().includes(queryLower)) {
              message.chatTitle = chat.title;
              results.push(message);
            }
          }
        } catch {
          // Best effort search
        }
        if (results.length >= top + offset) break;
      }
    }

    results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const page = results.slice(offset, offset + top).map((message, index) => ({ ...message, displayNum: index + 1 }));
    await this.rememberMessages(page);
    return page;
  }

  async searchUsers(query: string, top = 10): Promise<UserRecord[]> {
    const direct = query.trim();
    if (looksLikeGuid(direct)) {
      return [{ id: direct, displayName: direct }];
    }
    if (direct.startsWith("8:orgid:")) {
      const id = direct.slice("8:orgid:".length);
      return [{ id, displayName: id }];
    }

    const chats = await this.getChats({ top: 25, persistMap: false });
    const knownUsers = new Map<string, UserRecord>();

    const addUser = (id: string, displayName: string, conversationId?: string) => {
      const cleanId = id.replace(/^8:orgid:/, "").trim();
      const cleanName = decodeHtmlEntities(displayName || "").trim();
      if (!cleanId || cleanId === this.bundle.userId) return;
      const existing = knownUsers.get(cleanId);
      if (!existing) {
        knownUsers.set(cleanId, { id: cleanId, displayName: cleanName || cleanId, conversationId });
        return;
      }
      if ((!existing.displayName || existing.displayName === existing.id) && cleanName) {
        existing.displayName = cleanName;
      }
      if (!existing.conversationId && conversationId) {
        existing.conversationId = conversationId;
      }
    };

    for (const chat of chats) {
      const otherId = this.extractOtherUserId(chat.id);
      if (otherId && chat.lastMessageSender && chat.lastMessageSender !== this.bundle.displayName) {
        addUser(otherId, chat.lastMessageSender, chat.id);
      }

      try {
        const messages = await this.getChatMessages(chat.id, { top: 20, persistMap: false });
        for (const message of messages) {
          addUser(message.senderId, message.sender, chat.id);
        }
      } catch {
        // Best effort discovery
      }
    }

    const q = query.toLowerCase().trim();
    const ranked = [...knownUsers.values()]
      .filter((user) => {
        const name = user.displayName.toLowerCase();
        const email = (user.email || "").toLowerCase();
        return name.includes(q) || email.includes(q) || user.id.toLowerCase().includes(q);
      })
      .sort((a, b) => this.userScore(a, q) - this.userScore(b, q) || a.displayName.localeCompare(b.displayName));

    return ranked.slice(0, top);
  }

  async sendMessage(chatRef: string, content: string, html = false): Promise<Record<string, unknown>> {
    const convId = await this.resolveChatId(chatRef);
    const now = new Date().toISOString();

    const payload = {
      id: "-1",
      type: "Message",
      conversationid: convId,
      from: this.userMri,
      composetime: now,
      originalarrivaltime: now,
      content: html ? content : paragraphsToHtml(content),
      messagetype: "RichText/Html",
      contenttype: "Text",
      imdisplayname: this.bundle.displayName || "User",
      clientmessageid: makeClientMessageId(),
      properties: {
        formatVariant: "TEAMS",
        cards: "[]",
        links: "[]",
        mentions: "[]",
        files: "[]",
      },
      crossPostChannels: [],
    };

    return this.request<Record<string, unknown>>(
      "POST",
      `/users/ME/conversations/${encodeURIComponent(convId)}/messages`,
      { body: payload },
    );
  }

  async replyToMessage(msgRef: string, content: string): Promise<Record<string, unknown>> {
    const original = await this.getMessageDetail(msgRef);
    return this.replyToMessageRecord(original, content);
  }

  async replyToMessageRecord(message: MessageRecord, content: string): Promise<Record<string, unknown>> {
    const html = this.buildReplyHtml(message, content);
    return this.sendMessage(message.conversationId, html, true);
  }

  async editMessage(msgRef: string, newText: string): Promise<Record<string, unknown>> {
    const mapped = await this.resolveMessageId(msgRef);
    return this.request<Record<string, unknown>>(
      "PUT",
      `/users/ME/conversations/${encodeURIComponent(mapped.conv)}/messages/${encodeURIComponent(mapped.msg)}`,
      {
        body: {
          content: paragraphsToHtml(newText),
          messagetype: "RichText/Html",
        },
      },
    );
  }

  async deleteMessage(msgRef: string): Promise<Record<string, unknown>> {
    const mapped = await this.resolveMessageId(msgRef);
    return this.request<Record<string, unknown>>(
      "DELETE",
      `/users/ME/conversations/${encodeURIComponent(mapped.conv)}/messages/${encodeURIComponent(mapped.msg)}`,
      {
        body: {
          deletetime: Date.now(),
        },
      },
    );
  }

  async sendMessageToUser(query: string, content: string): Promise<Record<string, unknown>> {
    const user = await this.resolveUser(query);
    const convId = await this.getOrCreateOneOnOne(user.id, user.conversationId);
    return this.sendMessage(convId, content, false);
  }

  private parseChat(data: Record<string, unknown>): ChatRecord {
    const threadProps = asRecord(data.threadProperties);
    const props = asRecord(data.properties);
    const lastMessage = asRecord(data.lastMessage);
    const id = String(data.id || "");
    const topic = String(threadProps.topic || "");
    const members = this.parseMembers(threadProps.members);
    const lastContent = String(lastMessage.content || lastMessage.preview || "");
    const lastSender = String(lastMessage.imdisplayname || lastMessage.from || "");
    const lastTimeRaw = String(lastMessage.composetime || lastMessage.originalarrivaltime || "");
    const unreadCount = this.parseUnreadCount(threadProps, props, lastTimeRaw, String(lastMessage.from || ""));
    const title = topic || (members.length ? members.join(", ") : id.includes("@unq.gbl.spaces") ? "1:1 Chat" : "Chat");

    return {
      id,
      topic,
      chatType: detectChatType(id, threadProps),
      title,
      members,
      unreadCount,
      lastMessagePreview: stripHtml(lastContent).slice(0, 100),
      lastMessageTime: parseDate(lastTimeRaw).toISOString(),
      lastMessageSender: decodeHtmlEntities(lastSender),
      displayNum: 0,
    };
  }

  private parseMessage(data: Record<string, unknown>, conversationId: string): MessageRecord {
    const senderIdRaw = String(data.from || "");
    const senderId = senderIdRaw.includes("8:orgid:") ? senderIdRaw.split("8:orgid:").pop() || senderIdRaw : senderIdRaw;
    const content = String(data.content || "");
    const messageType = String(data.messagetype || "");

    return {
      id: String(data.id || data.sequenceId || data.version || ""),
      conversationId,
      sender: decodeHtmlEntities(String(data.imdisplayname || senderId || "")),
      senderId,
      content,
      textContent: stripHtml(content),
      messageType,
      timestamp: parseDate(String(data.composetime || data.originalarrivaltime || "")).toISOString(),
      clientMessageId: String(data.clientmessageid || ""),
      isFromMe: senderId === this.bundle.userId,
      displayNum: 0,
    };
  }

  private parseMembers(raw: unknown): string[] {
    let members = raw;
    if (typeof members === "string") {
      try {
        members = JSON.parse(members);
      } catch {
        members = [];
      }
    }
    if (!Array.isArray(members)) return [];
    return members
      .map((member) => {
        if (typeof member === "string") return member;
        if (member && typeof member === "object") {
          const rec = member as Record<string, unknown>;
          return String(rec.friendlyName || rec.id || "");
        }
        return "";
      })
      .filter(Boolean);
  }

  private parseUnreadCount(
    threadProps: Record<string, unknown>,
    props: Record<string, unknown>,
    lastMessageTimeRaw: string,
    lastSenderMri: string,
  ): number {
    const consumption = asRecord(threadProps.consumptionhorizon);
    const direct = Number(consumption.unreadCount || threadProps.unreadMessageCount || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;

    if (lastSenderMri.includes(this.bundle.userId)) return 0;

    const horizon = String(props.consumptionhorizon || "");
    if (!horizon) return 0;

    const readTs = Number(horizon.split(";")[0] || 0);
    const msgTs = parseDate(lastMessageTimeRaw).getTime();
    return msgTs > readTs ? 1 : 0;
  }

  private async rememberMessages(messages: MessageRecord[]): Promise<void> {
    const idMap = await this.idMapPromise;
    idMap.messages = {};
    for (const [index, message] of messages.entries()) {
      const displayNum = index + 1;
      message.displayNum = displayNum;
      idMap.messages[String(displayNum)] = {
        conv: message.conversationId,
        msg: message.id,
      };
    }
    await saveIdMap(idMap);
  }

  private async resolveChatId(chatRef: string): Promise<string> {
    if (isProbablyConversationId(chatRef)) {
      return chatRef;
    }

    const idMap = await this.idMapPromise;
    const mapped = idMap.chats[chatRef];
    if (mapped) return mapped;

    throw new Error(`Unknown chat #${chatRef}. Run 'teams-ic3 chats' first.`);
  }

  private async resolveMessageId(msgRef: string): Promise<{ conv: string; msg: string }> {
    const idMap = await this.idMapPromise;
    const mapped = idMap.messages[msgRef];
    if (!mapped) {
      throw new Error(`Unknown message #${msgRef}. Run 'teams-ic3 chat <chat>' or 'teams-ic3 search <query>' first.`);
    }
    return mapped;
  }

  private buildReplyHtml(message: MessageRecord, content: string): string {
    const msgId = escapeHtml(String(message.id));
    const senderMri = escapeHtml(message.senderId.includes(":") ? message.senderId : `8:orgid:${message.senderId}`);
    const senderName = escapeHtml(message.sender || "Unknown");
    const preview = escapeHtml((message.textContent || "").trim() || "[message]");
    const body = paragraphsToHtml(content);

    return (
      `<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="${msgId}">\r\n` +
      `<strong itemprop="mri" itemid="${senderMri}">${senderName}</strong>` +
      `<span itemprop="time" itemid="${msgId}"></span>\r\n` +
      `<p itemprop="preview">${preview}</p>\r\n` +
      `</blockquote>\r\n` +
      body
    );
  }

  private async resolveUser(query: string): Promise<UserRecord> {
    const users = await this.searchUsers(query, 10);
    if (!users.length) {
      throw new Error(`No user found matching '${query}'`);
    }

    const q = query.toLowerCase().trim();
    const exact = users.find((user) => user.displayName.toLowerCase() === q || user.id.toLowerCase() === q);
    if (exact) return exact;

    const strong = users.filter((user) => this.userScore(user, q) <= 3);
    if (strong.length === 1) return strong[0];
    if (strong.length > 1) {
      throw new Error(`Ambiguous user query '${query}'. Matches: ${strong.slice(0, 5).map((u) => u.displayName).join(", ")}`);
    }

    return users[0];
  }

  private async getOrCreateOneOnOne(userId: string, existingConvId?: string): Promise<string> {
    if (userId === this.bundle.userId) {
      return "48:notes";
    }
    if (existingConvId && existingConvId.includes("@unq.gbl.spaces")) {
      return existingConvId;
    }

    const fromMap = await this.findExistingOneOnOne(userId);
    if (fromMap) return fromMap;

    const response = await this.request<Record<string, unknown>>(
      "POST",
      "/threads",
      {
        body: {
          members: [
            { id: this.userMri, role: "Admin" },
            { id: `8:orgid:${userId}`, role: "Admin" },
          ],
          properties: {
            threadType: "chat",
            chatFileBehavior: "chat",
            fixedRoster: "true",
            uniquerosterthread: "true",
          },
        },
      },
    );

    const convId = String(response.id || response.conversationId || "");
    if (!convId) {
      throw new Error("Could not create 1:1 conversation");
    }
    return convId;
  }

  private async findExistingOneOnOne(targetUserId: string): Promise<string | null> {
    const idMap = await this.idMapPromise;
    for (const convId of Object.values(idMap.chats)) {
      if (this.convIdMatchesUser(convId, targetUserId)) return convId;
    }

    const chats = await this.getChats({ top: 100, persistMap: false });
    for (const chat of chats) {
      if (this.convIdMatchesUser(chat.id, targetUserId)) return chat.id;
    }

    return null;
  }

  private convIdMatchesUser(convId: string, targetUserId: string): boolean {
    const otherId = this.extractOtherUserId(convId);
    return Boolean(otherId && otherId === targetUserId);
  }

  private extractOtherUserId(convId: string): string | null {
    if (!convId.includes("@unq.gbl.spaces")) return null;
    const ids = convId.split("19:").pop()?.split("@")[0]?.split("_") || [];
    if (ids.length !== 2) return null;
    return ids.find((id) => id !== this.bundle.userId) || null;
  }

  private async getChatTitle(convId: string): Promise<string> {
    const idMap = await this.idMapPromise;
    const match = Object.entries(idMap.chats).find(([, id]) => id === convId)?.[0];
    if (match) {
      const chats = await this.getChats({ top: 100, persistMap: false });
      const chat = chats.find((item) => item.id === convId);
      if (chat) return chat.title;
    }

    const chats = await this.getChats({ top: 30, persistMap: false });
    return chats.find((item) => item.id === convId)?.title || convId;
  }

  private userScore(user: UserRecord, query: string): number {
    const name = user.displayName.toLowerCase();
    const email = (user.email || "").toLowerCase();
    if (name === query || user.id.toLowerCase() === query) return 0;
    if (name.startsWith(query)) return 1;
    const words = query.split(/\s+/).filter(Boolean);
    if (words.length && words.every((word) => name.includes(word) || email.includes(word))) return 2;
    if (name.includes(query) || email.includes(query)) return 3;
    return 10;
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      params?: Record<string, string>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.params || {})) {
      url.searchParams.set(key, value);
    }

    const response = await httpRequest(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.bundle.ic3}`,
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        behavioroverride: "redirectAs404",
        "x-ms-migration": "True",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(`Teams API error ${response.status}`, response.status, response.body);
    }

    if (response.status === 204 || !response.body) {
      return {} as T;
    }

    return JSON.parse(response.body) as T;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
