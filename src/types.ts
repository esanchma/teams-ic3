export type AuthSource = "cache" | "missing";

export interface TokenBundle {
  ic3: string;
  region: string;
  userId: string;
  displayName: string;
  exp: number;
}

export interface CachedTokenBundle {
  ic3: string;
  ic3_exp: number;
  region: string;
  user_id: string;
  display_name?: string;
}

export interface AuthStatus {
  ok: boolean;
  schema_version: "1.0";
  data: {
    auth_source: AuthSource;
    cache: {
      token_cache_exists: boolean;
      token_cache_path: string;
      id_map_exists: boolean;
      id_map_path: string;
    };
    identity: {
      region: string;
      user_id: string;
      display_name: string;
    };
    tokens: {
      ic3: boolean;
    };
    ic3: {
      expires_at: string | null;
      expires_in_seconds: number | null;
      expires_in_human: string | null;
      valid: boolean | null;
    };
  };
}

export interface ChatRecord {
  id: string;
  topic: string;
  chatType: string;
  title: string;
  members: string[];
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageTime: string;
  lastMessageSender: string;
  displayNum: number;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  sender: string;
  senderId: string;
  content: string;
  textContent: string;
  messageType: string;
  timestamp: string;
  clientMessageId: string;
  isFromMe: boolean;
  displayNum: number;
  chatTitle?: string;
}

export interface UserRecord {
  id: string;
  displayName: string;
  email?: string;
  conversationId?: string;
}

export interface IdMapFile {
  chats: Record<string, string>;
  messages: Record<string, { conv: string; msg: string }>;
}

export interface ListenerStateEntry {
  conversationId: string;
  messageId: string;
  processedAt: string;
  status: "ok" | "error";
  sender: string;
  command: string;
  responsePreview?: string;
  error?: string;
}

export interface ListenerState {
  version: 1;
  startedAt: string;
  processed: Record<string, ListenerStateEntry>;
}
