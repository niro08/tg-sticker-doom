export interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: {
    retry_after?: number;
    migrate_to_chat_id?: number;
  };
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
}

export interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  type: "regular" | "mask" | "custom_emoji";
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
  emoji?: string;
  set_name?: string;
  custom_emoji_id?: string;
}

export interface TelegramStickerSet {
  name: string;
  title: string;
  sticker_type: "regular" | "mask" | "custom_emoji";
  stickers: TelegramSticker[];
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: {
    id: number;
    type: string;
  };
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  sticker?: TelegramSticker;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface InputSticker {
  sticker: string;
  format: "static" | "animated" | "video";
  emoji_list: string[];
  keywords?: string[];
}

export interface SlotState {
  position: number;
  fileId: string;
  fileUniqueId: string;
  emoji?: string;
  frame: number;
  updatedAt: string;
}

export interface ProbeState {
  version: 1;
  stickerSetName: string;
  ownerUserId: number;
  botId: number;
  botUsername: string;
  nextFrame: number;
  slots: SlotState[];
  screenMessages?: Record<
    string,
    {
      chatId: number;
      messageId: number;
      updatedAt: string;
    }
  >;
  syncedAt: string;
}
