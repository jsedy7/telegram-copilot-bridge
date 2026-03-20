/**
 * chatParticipant.ts
 *
 * Registrace VS Code Chat Participanta @tg.
 *
 * Použití v chatu: @tg Napiš unit test pro funkci xyz
 *
 * V "participant" módu:
 *  - Telegram zpráva → příkaz otevřít chat s "@tg <zpráva>"
 *  - @tg participant zavolá Copilot LM, streamuje odpověď do chatu
 *  - Odpověď je odeslána zpět do Telegramu
 *
 * Sdílený stav (lastTelegramSource) se nastavuje z extension.ts
 * před tím, než je chat otevřen.
 */

import * as vscode from 'vscode';
import type { TelegramPoller } from './telegramPoller';

// ---------------------------------------------------------------------------
// Sdílený stav – nastaví extension.ts před programatickým otevřením chatu
// ---------------------------------------------------------------------------

/** Chat ID, kam odeslat odpověď (nastaveno z extension.ts). */
let pendingTelegramReply: { chatId: string; poller: TelegramPoller } | null = null;

export function setPendingTelegramReply(chatId: string, poller: TelegramPoller): void {
  pendingTelegramReply = { chatId, poller };
}

export function clearPendingTelegramReply(): void {
  pendingTelegramReply = null;
}

// ---------------------------------------------------------------------------
// Registrace participanta
// ---------------------------------------------------------------------------

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  log: vscode.OutputChannel,
): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant(
    'telegram-bridge.tg',
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> => {
      const userMessage = request.prompt.trim();

      if (!userMessage) {
        stream.markdown(
          '👋 Telegram Bridge (@tg) je aktivní!\n\n' +
            'Pošli zprávu z Telegramu nebo napiš dotaz přímo zde.',
        );
        return {};
      }

      // Vyber dostupný Copilot model
      const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
      if (models.length === 0) {
        stream.markdown(
          '❌ **Copilot LM není dostupný.**\n\n' +
            'Ujisti se, že:\n' +
            '- Je nainstalované rozšíření **GitHub Copilot Chat**\n' +
            '- Jsi přihlášen/a do GitHub účtu s Copilot přístupem',
        );
        return { errorDetails: { message: 'No Copilot model available' } };
      }

      const model = models[0];
      log.appendLine(`[participant] Model: ${model.name}, zpráva: "${userMessage.substring(0, 80)}"`);

      // Sestav historii konverzace pro kontext
      const messages: vscode.LanguageModelChatMessage[] = buildHistory(chatContext);
      messages.push(vscode.LanguageModelChatMessage.User(userMessage));

      // Volání LM
      let fullResponse = '';
      try {
        const response = await model.sendRequest(messages, {}, token);
        for await (const chunk of response.text) {
          if (token.isCancellationRequested) break;
          stream.markdown(chunk);
          fullResponse += chunk;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.appendLine(`[participant] LM chyba: ${msg}`);
        stream.markdown(`❌ Chyba při volání Copilot: ${msg}`);
        return { errorDetails: { message: msg } };
      }

      // Odeslat odpověď zpět do Telegramu (pokud byl požadavek z Telegramu)
      const reply = pendingTelegramReply;
      pendingTelegramReply = null; // vyčisti ihned – jen jednou odešleme

      if (reply && fullResponse) {
        const preview = fullResponse.substring(0, 3500); // Telegram limit ~4096 znaků
        const telegramText = `🤖 *Copilot:*\n${preview}${fullResponse.length > 3500 ? '\n…_(zkráceno)_' : ''}`;
        try {
          await reply.poller.sendMessage(reply.chatId, telegramText);
          log.appendLine(`[participant] Odpověď odeslána zpět do Telegramu (chatId=${reply.chatId})`);
        } catch (err) {
          log.appendLine(`[participant] Chyba odesílání do Telegramu: ${err}`);
          stream.markdown(
            '\n\n> ⚠️ Nepodařilo se odeslat odpověď zpět do Telegramu.',
          );
        }
      }

      return {};
    },
  );

  // Ikona a popis participanta
  participant.iconPath = new vscode.ThemeIcon('broadcast');
  participant.followupProvider = {
    provideFollowups(
      _result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken,
    ): vscode.ChatFollowup[] {
      return [
        {
          prompt: 'Pokračuj',
          label: '▶ Pokračuj',
          command: '',
        },
        {
          prompt: 'Vysvětli to podrobněji',
          label: '🔍 Vysvětli podrobněji',
          command: '',
        },
      ];
    },
  };

  context.subscriptions.push(participant);
  return participant;
}

// ---------------------------------------------------------------------------
// Pomocná funkce – sestavení historie
// ---------------------------------------------------------------------------

function buildHistory(ctx: vscode.ChatContext): vscode.LanguageModelChatMessage[] {
  const messages: vscode.LanguageModelChatMessage[] = [];

  for (const turn of ctx.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      let content = '';
      for (const part of turn.response) {
        if (part instanceof vscode.ChatResponseMarkdownPart) {
          content += part.value.value;
        }
      }
      if (content) {
        messages.push(vscode.LanguageModelChatMessage.Assistant(content));
      }
    }
  }

  return messages;
}
