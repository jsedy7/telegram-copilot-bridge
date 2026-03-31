/**
 * TelegramPoller – Telegram Bot API long-polling bez externích závislostí.
 *
 * Používá pouze Node.js built-in `https` modul.
 * Zabezpečení: token se nikdy nezaloguje; přijímáme zprávy jen z povolených Chat ID.
 */

import * as https from 'https';
import type * as http from 'http';
import {
  TELEGRAM_API_HOST,
  TELEGRAM_API_PORT,
  DEFAULT_POLL_OFFSET,
  HTTP_SERVER_ERROR_THRESHOLD,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  TELEGRAM_POLL_TIMEOUT_SEC,
} from './constants';
import { getTelegramParseMode } from './textFormatter';
import type { TelegramParseMode } from './textFormatter';

// ---------------------------------------------------------------------------
// Typy Telegram API (minimální subset)
// ---------------------------------------------------------------------------

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
}

interface TgGetUpdatesResponse {
  ok: boolean;
  result: TgUpdate[];
  description?: string;
}

interface TgSendMessageResponse {
  ok: boolean;
  result?: TgMessage;
  description?: string;
}

export type MessageHandler = (msg: TgMessage) => void | Promise<void>;
export type ErrorHandler = (err: Error) => void;

// ---------------------------------------------------------------------------
// TelegramPoller
// ---------------------------------------------------------------------------

export class TelegramPoller {
  private offset = DEFAULT_POLL_OFFSET;
  private running = false;
  private currentReq: http.ClientRequest | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly token: string,
    private readonly allowedChatIds: ReadonlySet<string>,
    private readonly onMessage: MessageHandler,
    private readonly onError: ErrorHandler,
    private readonly allowSetupCommands: boolean = false,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedulePoll(0);
  }

  stop(): void {
    this.running = false;
    if (this.currentReq) {
      this.currentReq.destroy();
      this.currentReq = null;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async sendMessage(chatId: string | number, text: string, parseMode: TelegramParseMode = 'plain'): Promise<void> {
    return this.withRetry(() => this.doSendMessage(chatId, text, parseMode), 'sendMessage');
  }

  private doSendMessage(chatId: string | number, text: string, parseMode: TelegramParseMode): Promise<void> {
    const payload: {
      chat_id: string | number;
      text: string;
      parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
    } = {
      chat_id: chatId,
      text,
    };

    // Add parse_mode only if not plain
    const apiParseMode = getTelegramParseMode(parseMode);
    if (apiParseMode) {
      payload.parse_mode = apiParseMode;
    }

    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: TELEGRAM_API_HOST,
        port: TELEGRAM_API_PORT,
        path: `/bot${this.token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          const statusCode = res.statusCode ?? 0;
          if (statusCode >= HTTP_SERVER_ERROR_THRESHOLD) {
            reject(new Error(`Telegram sendMessage: HTTP ${statusCode} server error`));
            return;
          }
          try {
            const parsed: TgSendMessageResponse = JSON.parse(data);
            if (!parsed.ok) reject(new Error(`Telegram sendMessage error: ${parsed.description}`));
            else resolve();
          } catch {
            reject(new Error('Telegram sendMessage: invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10_000, () => {
        req.destroy();
        reject(new Error('Telegram sendMessage: request timeout'));
      });
      req.write(body);
      req.end();
    });
  }

  /** Ověří token a vrátí info o botovi. */
  async getMe(): Promise<TgUser> {
    return this.withRetry(() => this.doGetMe(), 'getMe');
  }

  private doGetMe(): Promise<TgUser> {
    return new Promise((resolve, reject) => {
      const req = https.get(
        `https://api.telegram.org/bot${this.token}/getMe`,
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk.toString()));
          res.on('end', () => {
            const statusCode = res.statusCode ?? 0;
            if (statusCode >= HTTP_SERVER_ERROR_THRESHOLD) {
              reject(new Error(`Telegram getMe: HTTP ${statusCode} server error`));
              return;
            }
            try {
              const parsed = JSON.parse(data) as { ok: boolean; result: TgUser; description?: string };
              if (!parsed.ok) reject(new Error(`Telegram getMe error: ${parsed.description}`));
              else resolve(parsed.result);
            } catch {
              reject(new Error('Telegram getMe: invalid JSON'));
            }
          });
        },
      );
      req.on('error', reject);
      req.setTimeout(10_000, () => {
        req.destroy();
        reject(new Error('Telegram getMe: request timeout'));
      });
    });
  }

  // -------------------------------------------------------------------------
  // Retry helper
  // -------------------------------------------------------------------------

  /** Vrátí true pro přechodné chyby, u kterých má smysl zkusit znovu. */
  private isRetryable(err: Error): boolean {
    const msg = err.message;
    return (
      /HTTP [5]\d\d/.test(msg) ||
      msg.includes('timeout') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('ECONNREFUSED')
    );
  }

  /**
   * Spustí `fn` až MAX_RETRIES-krát.
   * Při přechodné chybě počká RETRY_DELAYS_MS[attempt-1] ms a zkusí znovu.
   * Při neopravitelné chybě (4xx, neplatný JSON …) vyhodí hned.
   */
  private async withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error = new Error('unknown');
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES && this.isRetryable(lastError)) {
          const delay = RETRY_DELAYS_MS[attempt - 1] ?? 2_000;
          console.warn(
            `[TelegramBridge] ${label}: pokus ${attempt}/${MAX_RETRIES} selhal` +
            ` (${lastError.message}), opakuji za ${delay} ms…`,
          );
          await new Promise<void>(r => setTimeout(r, delay));
        } else {
          break;
        }
      }
    }
    throw lastError;
  }

  // -------------------------------------------------------------------------
  // Interní polling smyčka
  // -------------------------------------------------------------------------

  private schedulePoll(delayMs: number): void {
    this.pollTimer = setTimeout(() => {
      if (this.running) this.doPoll();
    }, delayMs);
  }

  private doPoll(): void {
    if (!this.running) return;

    // Long-poll s timeout – Telegram čeká max TELEGRAM_POLL_TIMEOUT_SEC na update
    const url =
      `https://${TELEGRAM_API_HOST}/bot${this.token}/getUpdates` +
      `?offset=${this.offset}&timeout=${TELEGRAM_POLL_TIMEOUT_SEC}&allowed_updates=%5B%22message%22%5D`;

    let data = '';

    const req = https.get(url, (res) => {
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () => {
        this.currentReq = null;
        if (!this.running) return;

        try {
          const parsed: TgGetUpdatesResponse = JSON.parse(data);
          if (parsed.ok) {
            for (const update of parsed.result) {
              // offset zajišťuje, že každý update zpracujeme jen jednou
              this.offset = Math.max(this.offset, update.update_id + 1);
              const msg = update.message ?? update.edited_message ?? update.channel_post;
              if (msg?.text || msg?.caption) {
                const chatIdStr = String(msg.chat.id);
                const text = msg.text ?? msg.caption;
                if (text) {
                  // Setup commands (/chatid, /start) are only allowed during initial setup
                  // to prevent information disclosure attacks
                  const isSetupCommand = /^\/chatid|^\/start/.test(text.trim());
                  const isAllowed = this.allowedChatIds.has(chatIdStr) || 
                                   (isSetupCommand && this.allowSetupCommands);
                  if (isAllowed) {
                    const effectiveMsg: TgMessage = { ...msg, text };
                    void this.safeCallHandler(effectiveMsg);
                  }
                }
              }
            }
          } else {
            const errMsg = parsed.description ?? 'unknown error';
            // Conflict = jiná instance polleru vyhrála. Zastav se aby nebyly dvě instance.
            if (errMsg.toLowerCase().includes('conflict')) {
              this.running = false;
              this.onError(new Error(
                `Telegram getUpdates: Conflict – jiná instance bridge je aktivní. ` +
                `Tento poller se zastavil. Spusť bridge znovu v aktivním okně.`,
              ));
              return; // neplánuj další poll
            }
            this.onError(new Error(`Telegram getUpdates: ${errMsg}`));
          }
        } catch (e) {
          this.onError(e instanceof Error ? e : new Error(String(e)));
        }

        this.schedulePoll(500);
      });
    });

    req.on('error', (err) => {
      this.currentReq = null;
      if (!this.running) return;
      this.onError(err);
      // Backoff při síťové chybě
      this.schedulePoll(5_000);
    });

    // Celkový timeout: 35s (25s polling + rezerva)
    req.setTimeout(35_000, () => {
      req.destroy();
    });

    this.currentReq = req;
  }

  private async safeCallHandler(msg: TgMessage): Promise<void> {
    try {
      await this.onMessage(msg);
    } catch (e) {
      this.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
