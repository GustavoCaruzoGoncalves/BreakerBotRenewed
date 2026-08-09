import type { proto, WAMessage, WAMessageKey, WASocket } from '@whiskeysockets/baileys';

/** Tipos de mensagem que o bot trata como mídia baixável. */
export type MediaMessageType = 'imageMessage' | 'videoMessage' | 'stickerMessage';

/**
 * Mídia da própria mensagem ou da mensagem citada, já resolvida.
 * O conteúdo é derivado de `proto.IMessage` para acompanhar os tipos do Baileys.
 */
export type MediaRef = {
  [K in MediaMessageType]: {
    type: K;
    content: NonNullable<proto.IMessage[K]>;
    /**
     * Chave da mensagem que carrega a mídia (a citada, quando for o caso).
     * `sock.updateMediaMessage` depende dela para pedir o reupload à WhatsApp.
     */
    key: WAMessageKey;
  };
}[MediaMessageType];

/** Mensagem normalizada produzida por `lib/message.parse`. */
export interface BotMessage {
  jid: string;
  /** Chave do primeiro campo de `raw.message` (ex.: `conversation`, `imageMessage`). */
  type: string;
  text: string;
  media: MediaRef | null;
  quoted: proto.IMessage | null;
  raw: WAMessage;
}

/**
 * Handlers retornam `true` quando consomem o comando; o router para na primeira
 * resposta truthy.
 */
export type CommandResult = boolean | void;

export type CommandHandler = (sock: WASocket, msg: BotMessage) => Promise<CommandResult>;

/** Seções do `!menu`. Entradas marcadas como `admin` são agrupadas à parte. */
export type CommandCategory =
  | 'Gerais'
  | 'Figurinhas e mídia'
  | 'Zueiras'
  | 'IA'
  | 'Níveis'
  | 'Aura'
  | 'Truco'
  | 'Preferências'
  | 'Moderação';

/** Variação ou subcomando, ex.: `!trivia resposta <n>`. */
export interface CommandUsage {
  syntax: string;
  description: string;
}

export interface CommandEntry {
  /** Gatilho principal, ex.: `!sticker`. */
  trigger: string;
  /** Gatilhos equivalentes, ex.: `!ajuda` para `!menu`. */
  aliases?: readonly string[];
  description: string;
  usages?: readonly CommandUsage[];
  /** Listado apenas para administradores. */
  admin?: boolean;
  /** Só funciona dentro de grupos. */
  groupOnly?: boolean;
}

export interface CommandMeta {
  category: CommandCategory;
  entries: readonly CommandEntry[];
}

/**
 * Um comando registrado. O `meta` é obrigatório de propósito: o `!menu` é gerado
 * a partir daqui, então não há como registrar um comando sem descrevê-lo.
 */
export interface Command {
  meta: CommandMeta;
  handle: CommandHandler;
}

/** Item emitido pelo evento `messages.reaction` do Baileys. */
export interface ReactionEvent {
  key: WAMessageKey;
  reaction: proto.IReaction;
}

export type { WAMessage, WAMessageKey, WASocket };
