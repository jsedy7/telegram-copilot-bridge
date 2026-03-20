/**
 * chatParticipant.ts
 *
 * @tg Chat Participant with full tool-calling loop.
 *
 * Uses request.model (the model selected by the user in the chat UI) and
 * vscode.lm.tools to get the same file-read / file-search / terminal tools
 * that @workspace uses.  After the model finishes, the full response is sent
 * back to Telegram.
 *
 * Tool loop cap: MAX_TOOL_ITERATIONS (10) to avoid infinite loops.
 */

import * as vscode from 'vscode';
import type { TelegramPoller } from './telegramPoller';

const MAX_TOOL_ITERATIONS = 10;

// ---------------------------------------------------------------------------
// Sdílený stav – nastaví extension.ts před programatickým otevřením chatu
// ---------------------------------------------------------------------------

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
          '👋 **Telegram Bridge** (@tg) is active.\n\n' +
            'Send a message from Telegram or type a question here directly.\n\n' +
            '_Tip: @tg has full file access via tool calls — it can read, search and write files._',
        );
        return {};
      }

      // Use the model the user has selected in the chat UI.
      // This preserves their model choice and avoids an extra selectChatModels call.
      const model = request.model;
      const availableTools = vscode.lm.tools;

      log.appendLine(
        `[${ts()}] [participant] model=${model.name} tools=${availableTools.length} msg="${userMessage.substring(0, 80)}"`,
      );

      // Build conversation history
      const messages: vscode.LanguageModelChatMessage[] = [
        ...buildHistory(chatContext),
        vscode.LanguageModelChatMessage.User(userMessage),
      ];

      // Expose all registered LM tools (includes @workspace file/search/terminal tools)
      const chatTools: vscode.LanguageModelChatTool[] = availableTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema ?? {},
      }));

      // ---------------------------------------------------------------------------
      // Tool-calling loop
      // ---------------------------------------------------------------------------
      let fullResponse = '';
      let iterations = 0;

      try {
        while (iterations < MAX_TOOL_ITERATIONS) {
          iterations++;

          const response = await model.sendRequest(
            messages,
            { tools: chatTools },
            token,
          );

          const textParts: string[] = [];
          const toolCalls: vscode.LanguageModelToolCallPart[] = [];

          // response.stream is the async iterable of parts (LanguageModelChatResponse API)
          for await (const part of response.stream) {
            if (token.isCancellationRequested) break;

            if (part instanceof vscode.LanguageModelTextPart) {
              stream.markdown(part.value);
              textParts.push(part.value);
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
              log.appendLine(`[${ts()}] [participant] tool call: ${part.name}`);
              stream.progress(`🔧 ${part.name}…`);
              toolCalls.push(part);
            }
          }

          // Append assistant turn to message history
          const assistantContent: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [
            ...(textParts.length ? [new vscode.LanguageModelTextPart(textParts.join(''))] : []),
            ...toolCalls,
          ];
          messages.push(vscode.LanguageModelChatMessage.Assistant(assistantContent));

          // No tool calls → model is done
          if (toolCalls.length === 0) {
            fullResponse = textParts.join('');
            break;
          }

          // Invoke each requested tool and collect results
          const toolResults: vscode.LanguageModelToolResultPart[] = [];

          for (const call of toolCalls) {
            try {
              const result = await vscode.lm.invokeTool(
                call.name,
                { input: call.input, toolInvocationToken: request.toolInvocationToken },
                token,
              );
              toolResults.push(
                new vscode.LanguageModelToolResultPart(call.callId, result.content),
              );
              log.appendLine(`[${ts()}] [participant] tool ${call.name} → OK`);
            } catch (toolErr) {
              const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
              log.appendLine(`[${ts()}] [participant] tool ${call.name} → ERROR: ${errMsg}`);
              toolResults.push(
                new vscode.LanguageModelToolResultPart(call.callId, [
                  new vscode.LanguageModelTextPart(`Tool error (${call.name}): ${errMsg}`),
                ]),
              );
            }
          }

          // Feed tool results back for next iteration
          messages.push(vscode.LanguageModelChatMessage.User(toolResults));
        }

        if (iterations >= MAX_TOOL_ITERATIONS) {
          stream.markdown('\n\n> ⚠️ Tool call limit reached — response may be incomplete.');
          log.appendLine(`[${ts()}] [participant] hit MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS})`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.appendLine(`[${ts()}] [participant] LM error: ${msg}`);
        stream.markdown(`\n\n❌ **Copilot error:** ${msg}`);

        // Clear pending reply and signal error back to Telegram
        const failedReply = pendingTelegramReply;
        pendingTelegramReply = null;
        if (failedReply) {
          void failedReply.poller
            .sendMessage(failedReply.chatId, `❌ *Copilot error:*\n\`${msg}\``)
            .catch((e) => log.appendLine(`[${ts()}] [participant] Error sending failure notice: ${e}`));
        }

        return { errorDetails: { message: msg } };
      }

      // ---------------------------------------------------------------------------
      // Send response back to Telegram
      // ---------------------------------------------------------------------------
      const reply = pendingTelegramReply;
      pendingTelegramReply = null;

      if (reply && fullResponse) {
        await sendTelegramReply(reply.chatId, reply.poller, fullResponse, log);
      } else if (reply && !fullResponse) {
        // Model responded only with tool calls, no final text — notify user
        log.appendLine(`[${ts()}] [participant] No text response to send back to Telegram`);
        void reply.poller
          .sendMessage(reply.chatId, '✅ _Done — no text response. Check VS Code chat for details._')
          .catch((e) => log.appendLine(`[${ts()}] [participant] Error sending done notice: ${e}`));
      }

      return {};
    },
  );

  participant.iconPath = new vscode.ThemeIcon('broadcast');
  participant.followupProvider = {
    provideFollowups(
      _result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken,
    ): vscode.ChatFollowup[] {
      return [
        { prompt: 'Continue', label: '▶ Continue', command: '' },
        { prompt: 'Explain in more detail', label: '🔍 Explain in detail', command: '' },
      ];
    },
  };

  context.subscriptions.push(participant);
  return participant;
}

// ---------------------------------------------------------------------------
// Send reply back to Telegram (with chunking for long responses)
// ---------------------------------------------------------------------------

async function sendTelegramReply(
  chatId: string,
  poller: TelegramPoller,
  fullResponse: string,
  log: vscode.OutputChannel,
): Promise<void> {
  // Telegram max message length is 4096 chars. We strip markdown code fences
  // if needed and truncate to avoid silent failures.
  const TELEGRAM_MAX = 3800;
  const text = fullResponse.length > TELEGRAM_MAX
    ? fullResponse.substring(0, TELEGRAM_MAX) + '\n…_(truncated — see VS Code chat for full response)_'
    : fullResponse;

  const telegramText = `🤖 *Copilot:*\n${text}`;

  try {
    await poller.sendMessage(chatId, telegramText);
    log.appendLine(`[${ts()}] [participant] Reply sent to Telegram (chatId=${chatId}, ${text.length} chars)`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.appendLine(`[${ts()}] [participant] FAILED to send reply to Telegram: ${errMsg}`);

    // Show VS Code notification so user knows
    const action = await vscode.window.showErrorMessage(
      `📱 Telegram Bridge: Failed to send reply to Telegram — ${errMsg}`,
      'Retry',
      'View Log',
    );
    if (action === 'Retry') {
      try {
        await poller.sendMessage(chatId, telegramText);
        log.appendLine(`[${ts()}] [participant] Retry succeeded`);
      } catch (retryErr) {
        log.appendLine(`[${ts()}] [participant] Retry also failed: ${retryErr}`);
        vscode.window.showErrorMessage(`📱 Telegram Bridge: Retry failed — ${retryErr}`);
      }
    } else if (action === 'View Log') {
      log.show();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** HH:MM:SS.mmm timestamp for log lines */
function ts(): string {
  return new Date().toISOString().substring(11, 23);
}

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

