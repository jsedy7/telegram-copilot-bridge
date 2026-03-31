/**
 * extension.ts – hlavní vstupní bod rozšíření Telegram Bridge.
 *
 * Tok zpráv:
 *
 * DIRECT mód (výchozí):
 *   Telegram → TelegramPoller → workbench.action.chat.open {query, isPartialQuery:false}
 *   → zpráva se automaticky odešle v Copilot Chatu
 *
 * PARTICIPANT mód (obousměrný):
 *   Telegram → TelegramPoller → workbench.action.chat.open {query:"@tg <zpráva>"}
 *   → @tg participant → Copilot LM → chat + Telegram odpověď zpět
 *
 * Směrování do konkrétního projektu:
 *   - Příkaz "Nastavit jako aktivní workspace" zapíše ID tohoto okna do globalState
 *   - Pouze okno s odpovídajícím ID zpracovává příchozí Telegram zprávy
 *   - Ostatní okna polling ignorují → žádný konflikt mezi projekty
 *
 * Bezpečnost:
 *   - Bot token uložen v VS Code Secrets API (nikdy v settings.json)
 *   - Zprávy přijímány pouze z povolených Chat ID
 *   - Prázdná množina allowedChatIds = bridge NEBĚŽÍ (secure-by-default)
 */

import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as fspath from 'path';
import * as os from 'os';
import { TelegramPoller } from './telegramPoller';
import { registerChatParticipant, setPendingTelegramReply } from './chatParticipant';
import { StatusViewProvider } from './statusView';
import {
  DEFAULT_VERSION,
  STATUS_BAR_PRIORITY,
  TOOL_PREVIEW_MAX_LENGTH,
  TELEGRAM_MESSAGE_MAX_LENGTH,
  TIME_FORMAT_START,
  TIME_FORMAT_END,
  DEFAULT_WORKSPACE_INDEX,
  MAX_REQUEST_BODY_SIZE,
  MAX_MESSAGE_LENGTH,
  MCP_AUTH_SECRET_LENGTH,
} from './constants';
import { sanitizeError, formatErrorForLog } from './errorHandler';
import { RateLimiter } from './rateLimit';
import { formatForTelegram, type TelegramParseMode } from './textFormatter';

// ---------------------------------------------------------------------------
// Stav modulu
// ---------------------------------------------------------------------------

let poller: TelegramPoller | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let log: vscode.OutputChannel;
let statusViewProvider: StatusViewProvider | undefined;

/** Rate limiter for incoming Telegram messages */
const rateLimiter = new RateLimiter();

/** Chat ID posledního odesilatele – pro příkaz replyDone */
let lastSenderChatId: string | undefined;
/** Jméno posledního odesilatele */
let lastSenderName: string | undefined;
/** Verze extension z package.json – nastavena při aktivaci */
let extensionVersion = DEFAULT_VERSION;

// MCP / HTTP bridge
let httpServer: http.Server | undefined;
/** Shared secret for MCP HTTP authentication */
let mcpSecret: string | undefined;
/** Adresář sdílených souborů bridge (~/.vscode-telegram-bridge/) */
const BRIDGE_DIR = fspath.join(os.homedir(), '.vscode-telegram-bridge');
/** Soubor s portem HTTP serveru (čte ho mcp-server.js) */
const PORT_FILE  = fspath.join(BRIDGE_DIR, 'port');
/** Soubor se shared secret pro MCP autentizaci */
const SECRET_FILE = fspath.join(BRIDGE_DIR, 'secret');

const SECRET_KEY = 'telegramBridge.botToken';
/** Klíč v globalState – uchovává ID aktivního workspace napříč okny */
const ACTIVE_WORKSPACE_KEY = 'telegramBridge.activeWorkspaceId';

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

/** HH:MM:SS.mmm timestamp */
function ts(): string {
  return new Date().toISOString().substring(TIME_FORMAT_START, TIME_FORMAT_END);
}

function logInfo(msg: string): void {
  log.appendLine(`[${ts()}] ${msg}`);
}

function logError(msg: string, err?: unknown): void {
  const detail = formatErrorForLog(err, msg);
  log.appendLine(`[${ts()}] ⚠ ${detail}`);
}


export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionVersion = context.extension.packageJSON.version ?? DEFAULT_VERSION;
  log = vscode.window.createOutputChannel('Telegram Bridge', { log: true });
  context.subscriptions.push(log);
  logInfo(`[init] Telegram Bridge v${extensionVersion} activating...`);

  // Zkopíruj MCP server do stabilní cesty a zaregistruj do settings.json jednou
  copyMcpServer(context);
  await ensureMcpRegistered(context);

  // Status bar tlačítko
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, STATUS_BAR_PRIORITY);
  statusBar.command = 'telegram-bridge.toggle';
  statusBar.tooltip = 'Telegram Bridge (klikni pro přepnutí)';
  context.subscriptions.push(statusBar);
  setStatusBar(false);
  statusBar.show();

  // Activity Bar sidebar panel
  const wsName = vscode.workspace.name ?? 'workspace';
  const initialAllowedCount = (config().get<string[]>('allowedChatIds') ?? []).length;
  statusViewProvider = new StatusViewProvider(wsName, initialAllowedCount);
  const treeView = vscode.window.createTreeView('telegram-bridge.statusView', {
    treeDataProvider: statusViewProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  // Akčnost: sleduj změny allowedChatIds v nastavení
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('telegramBridge.allowedChatIds')) {
        const count = (config().get<string[]>('allowedChatIds') ?? []).length;
        statusViewProvider?.update({ allowedChatCount: count });
      }
    }),
  );

  // Periodická obnova stavu (detekce změny aktivního workspace z jiného okna)
  const refreshTimer = setInterval(() => {
    if (poller) {
      const active = isActiveWorkspace(context);
      statusViewProvider?.update({ isActive: active });
      setStatusBar(true, active);
    }
  }, 5_000);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });

  // Registrace chatového participanta @tg
  registerChatParticipant(context, log);

  // ---------------------------------------------------------------------------
  // LM tool: telegram_reply
  //
  // Copilot agent mode (a jakýkoli jiný VS Code agent) může volat #telegram_reply
  // pro odeslání zprávy zpět Telegram uživateli, který aktuální úkol zadal.
  //
  // Použití v chatu:
  //   Přidej do zprávy nebo system promptu instrukci jako:
  //   "Až dokončíš práci, zavolej telegram_reply s výsledkem."
  //
  // Formát vstupu: { "message": "text zprávy (podporuje Telegram Markdown)" }
  //
  // Telegram Markdown:
  //   *tučně*  _kurzíva_  `inline kód`  ```\nblokkódu\n```
  // ---------------------------------------------------------------------------
  const telegramReplyTool = vscode.lm.registerTool<{ message: string }>(
    'telegram_reply',
    {
      prepareInvocation(options) {
        const preview = (options.input?.message ?? '').substring(0, TOOL_PREVIEW_MAX_LENGTH);
        return {
          invocationMessage: `📱 Telegram Bridge: odesílám zprávu… "${preview}${preview.length >= TOOL_PREVIEW_MAX_LENGTH ? '…' : ''}"`,
        };
      },

      async invoke(options, _token) {
        const message = options.input?.message;

        if (!message) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Error: parametr "message" je povinný.'),
          ]);
        }
        if (!lastSenderChatId) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              'Error: Žádný Telegram příjemce. Bridge zatím nepřijal žádnou zprávu — ' +
              'nejdřív pošli zprávu ze svého Telegramu.',
            ),
          ]);
        }
        if (!poller) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              'Error: Telegram Bridge není spuštěn. Spusť ho příkazem "Telegram Bridge: Spustit bridge".',
            ),
          ]);
        }

        // Format text with configured parse mode
        const { formatted, parseMode } = formatTelegramText(message);

        // Telegram API limit: max TELEGRAM_MESSAGE_MAX_LENGTH znaků na zprávu
        const chunks: string[] = [];
        for (let i = 0; i < formatted.length; i += TELEGRAM_MESSAGE_MAX_LENGTH) {
          chunks.push(formatted.substring(i, i + TELEGRAM_MESSAGE_MAX_LENGTH));
        }

        try {
          for (const chunk of chunks) {
            await poller.sendMessage(lastSenderChatId, chunk, parseMode);
          }
          const summary = `✅ Odesláno do Telegramu (${chunks.length} zpráv${chunks.length > 1 ? '' : 'a'}, ${message.length} znaků). [Telegram Bridge v${extensionVersion}]`;
          logInfo(`[tool:telegram_reply] ${summary} chatId=${lastSenderChatId}`);
          vscode.window.showInformationMessage(`📱 ${summary}`);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(summary),
          ]);
        } catch (err) {
          logError('[tool:telegram_reply] Chyba odeslání', err);
          const sanitized = sanitizeError(err, 'telegram_reply');
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Error: ${sanitized}`),
          ]);
        }
      },
    },
  );
  context.subscriptions.push(telegramReplyTool);

  // Příkazy
  context.subscriptions.push(
    vscode.commands.registerCommand('telegram-bridge.configure', () => runSetupWizard(context)),
    vscode.commands.registerCommand('telegram-bridge.start', () => startBridge(context)),
    vscode.commands.registerCommand('telegram-bridge.stop', () => stopBridge()),
    vscode.commands.registerCommand('telegram-bridge.toggle', () =>
      poller ? stopBridge() : startBridge(context),
    ),
    vscode.commands.registerCommand('telegram-bridge.showLog', () => log.show()),
    vscode.commands.registerCommand('telegram-bridge.setAsActive', () => setAsActive(context)),
    vscode.commands.registerCommand('telegram-bridge.replyDone', () => replyDone()),
    vscode.commands.registerCommand('telegram-bridge.replyCustom', () => replyCustom()),
  );

  // Automatický start
  const cfg = config();
  if (cfg.get<boolean>('autoStart')) {
    // Při autoStart nastav toto okno jako aktivní, pokud žádné jiné není
    const activeId = context.globalState.get<string>(ACTIVE_WORKSPACE_KEY);
    if (!activeId) {
      await context.globalState.update(ACTIVE_WORKSPACE_KEY, workspaceId(context));
    }
    await startBridge(context);
  } else {
    logInfo('[init] autoStart=false – bridge není spuštěn. Použij příkaz "Telegram Bridge: Spustit bridge".');
  }
}

export function deactivate(): void {
  stopHttpServer();
  poller?.stop();
  poller = undefined;
}

// ---------------------------------------------------------------------------
// Správa aktivního workspace
// ---------------------------------------------------------------------------

/** Stabilní ID tohoto workspace (kombinace názvu + prvního workspaceFolder) */
function workspaceId(context: vscode.ExtensionContext): string {
  const name = vscode.workspace.name ?? 'untitled';
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  return `${name}::${folder}`;
}

/** Vrátí true pokud toto okno smí zpracovávat Telegram zprávy */
function isActiveWorkspace(context: vscode.ExtensionContext): boolean {
  const activeId = context.globalState.get<string>(ACTIVE_WORKSPACE_KEY);
  return activeId === workspaceId(context);
}

async function setAsActive(context: vscode.ExtensionContext): Promise<void> {
  const myId = workspaceId(context);
  const myName = vscode.workspace.name ?? 'tento workspace';
  await context.globalState.update(ACTIVE_WORKSPACE_KEY, myId);
  setStatusBar(!!poller, true);
  statusViewProvider?.update({ isActive: true, workspaceName: myName });
  logInfo(`[routing] Nastaven jako aktivní příjemce: "${myName}"`);
  vscode.window.showInformationMessage(
    `📍 Telegram zprávy nyní směřují do: **${myName}**`,
  );
}

// ---------------------------------------------------------------------------
// Setup wizard – uložení tokenu + chat ID
// ---------------------------------------------------------------------------

async function runSetupWizard(context: vscode.ExtensionContext): Promise<void> {
  // Krok 1: Bot token
  const token = await vscode.window.showInputBox({
    title: '📱 Telegram Bridge – Nastavení (1/2)',
    prompt:
      'Zadej Telegram Bot Token z @BotFather.\n' +
      'Příkaz: /newbot → zkopíruj token ve tvaru 1234567890:ABCdef...',
    password: true,
    placeHolder: '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz',
    ignoreFocusOut: true,
    validateInput(value) {
      if (!value.match(/^\d+:[A-Za-z0-9_-]{35,}$/)) {
        return 'Neplatný formát tokenu. Token vypadá jako: 1234567890:ABCdef...';
      }
      return null;
    },
  });

  if (!token) {
    vscode.window.showWarningMessage('Nastavení zrušeno – token nebyl zadán.');
    return;
  }

  await context.secrets.store(SECRET_KEY, token);
  logInfo('[setup] Bot token uložen do VS Code Secrets.');

  // Krok 2: Ověření tokenu
  vscode.window.showInformationMessage('⏳ Ověřuji token u Telegram API...');
  try {
    const tempPoller = new TelegramPoller(token, new Set(), () => {}, () => {});
    const me = await tempPoller.getMe();
    logInfo(`[setup] Bot ověřen: @${me.username ?? me.first_name} (id=${me.id})`);
    vscode.window.showInformationMessage(
      `✅ Připojen bot: @${me.username ?? me.first_name}\n` +
        `Pošli botovi /chatid ze svého Telegramu pro zjištění svého Chat ID.`,
    );
  } catch (err) {
    const sanitized = sanitizeError(err, 'setup');
    vscode.window.showErrorMessage(`❌ Chyba ověření tokenu: ${sanitized}`);
    logError('[setup] Token validation failed', err);
    return;
  }

  // Krok 3: Chat ID
  const chatIdInput = await vscode.window.showInputBox({
    title: '📱 Telegram Bridge – Nastavení (2/2)',
    prompt:
      'Zadej své Telegram Chat ID.\n' +
      'Jak zjistit: pošli botovi /chatid NEBO zprávu botovi @userinfobot.\n' +
      'Chat ID je číslo (může být záporné pro skupiny).',
    placeHolder: '123456789',
    ignoreFocusOut: true,
    validateInput(value) {
      if (!value.match(/^-?\d+$/)) return 'Chat ID musí být číslo (např. 123456789 nebo -1001234567890)';
      return null;
    },
  });

  if (!chatIdInput) {
    vscode.window.showWarningMessage('Chat ID nebylo zadáno – bridge nebude přijímat zprávy.');
    return;
  }

  // Přidat Chat ID do allowedChatIds
  const cfg = config();
  const existing = cfg.get<string[]>('allowedChatIds') ?? [];
  if (!existing.includes(chatIdInput)) {
    await cfg.update('allowedChatIds', [...existing, chatIdInput], vscode.ConfigurationTarget.Global);
  }
  logInfo(`[setup] Chat ID ${chatIdInput} přidáno do allowedChatIds.`);

  const start = await vscode.window.showInformationMessage(
    `✅ Nastavení dokončeno!\nChat ID: ${chatIdInput} přidáno.\n\nSpustit bridge nyní?`,
    'Spustit',
    'Později',
  );

  if (start === 'Spustit') {
    await startBridge(context);
  }
}

// ---------------------------------------------------------------------------
// Spuštění bridge
// ---------------------------------------------------------------------------

async function startBridge(context: vscode.ExtensionContext): Promise<void> {
  if (poller) {
    vscode.window.showWarningMessage('Telegram Bridge již běží.');
    return;
  }

  // Token z secrets
  const token = await context.secrets.get(SECRET_KEY);
  if (!token) {
    const action = await vscode.window.showErrorMessage(
      '❌ Bot token není nastaven. Spusť průvodce nastavením.',
      'Nastavit',
    );
    if (action === 'Nastavit') {
      await runSetupWizard(context);
    }
    return;
  }

  // Povolená Chat ID
  const cfg = config();
  const allowedIds = cfg.get<string[]>('allowedChatIds') ?? [];

  if (allowedIds.length === 0) {
    const action = await vscode.window.showErrorMessage(
      '❌ Žádné povolené Chat ID! Bridge odmítá přijímat zprávy bez explicitního povolení.\n' +
        'Přidej své Chat ID v nastavení nebo spusť průvodce.',
      'Průvodce',
      'Otevřít nastavení',
    );
    if (action === 'Průvodce') {
      await runSetupWizard(context);
    } else if (action === 'Otevřít nastavení') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'telegramBridge.allowedChatIds');
    }
    return;
  }

  const allowedSet = new Set(allowedIds);

  // Zkontroluj/nastav aktivní workspace
  const activeId = context.globalState.get<string>(ACTIVE_WORKSPACE_KEY);
  const myId = workspaceId(context);
  const myName = vscode.workspace.name ?? 'workspace';

  if (!activeId) {
    // Žádné okno ještě není aktivní → toto se stane primárním
    await context.globalState.update(ACTIVE_WORKSPACE_KEY, myId);
    logInfo(`[bridge] Nastaven jako primární příjemce: "${myName}"`);
  } else if (activeId !== myId) {
    const action = await vscode.window.showWarningMessage(
      `⚠️ Telegram Bridge již běží v jiném okně.\n` +
        `Zprávy půjdou do aktivního projektu.\n\n` +
        `Chceš přesměrovat zprávy sem? ("${myName}")`,
      'Přesměrovat sem',
      'Jen spustit polling',
    );
    if (action === 'Přesměrovat sem') {
      await context.globalState.update(ACTIVE_WORKSPACE_KEY, myId);
      logInfo(`[bridge] Přesměrován jako aktivní příjemce: "${myName}"`);
    } else if (!action) {
      return; // Uživatel zrušil
    }
    // 'Jen spustit polling' – poller běží, ale zprávy se zpracují jen pokud
    // se toto okno stane aktivním (viz handleTelegramMessage guard)
  }

  logInfo(`[bridge] Spouštím Telegram Bridge v${extensionVersion} – povolená Chat ID: ${[...allowedSet].join(', ')}`);

  // Setup commands (/chatid, /start) are only allowed if allowlist is empty (initial setup)
  // Otherwise they're disabled to prevent information disclosure
  const allowSetupCommands = allowedSet.size === 0;
  if (allowSetupCommands) {
    logInfo('[bridge] Setup mode ENABLED – /chatid and /start commands are allowed for initial configuration');
  } else {
    logInfo('[bridge] Setup mode DISABLED – /chatid and /start commands are blocked for security');
  }

  poller = new TelegramPoller(
    token,
    allowedSet,
    (msg) => handleTelegramMessage(msg, context, cfg),
    (err) => {
      logInfo(`[bridge] Chyba: ${err.message}`);
      // Conflict = dvě instance polleru. Zastav a upozorni.
      if (err.message.includes('Conflict')) {
        poller = undefined;
        stopHttpServer();
        setStatusBar(false, false);
        statusViewProvider?.update({ running: false, isActive: false });
        void vscode.window.showWarningMessage(
          '⚠️ Telegram Bridge: Conflict — jiná instance bridge je aktivní v jiném VS Code okně. ' +
          'Tento poller byl zastaven.',
          'Spustit znovu zde',
        ).then((action) => {
          if (action === 'Spustit znovu zde') void startBridge(context);
        });
      }
    },
    allowSetupCommands,
  );

  poller.start();
  await startHttpServer(); // spustí HTTP server pro MCP komunikaci
  const isActive = isActiveWorkspace(context);
  setStatusBar(true, isActive);
  statusViewProvider?.update({
    running: true,
    isActive,
    workspaceName: myName,
    allowedChatCount: allowedIds.length,
  });

  // Ověření bota
  try {
    const me = await poller.getMe();
    const botName = me.username ? `@${me.username}` : me.first_name;
    logInfo(`[bridge] Připojen: ${botName}`);
    statusViewProvider?.update({ botName });
    const activeLabel = isActive ? '📍 aktivní příjemce' : '⏸ pasivní (zprávy jdou jinam)';
    vscode.window.showInformationMessage(
      `📡 Telegram Bridge spuštěn (${botName}) – ${activeLabel}: "${myName}"`,
    );
  } catch {
    // Poller stále běží, jen jsme nemohli ověřit jméno bota
  }
}

// ---------------------------------------------------------------------------
// Zastavení bridge
// ---------------------------------------------------------------------------

function stopBridge(): void {
  if (!poller) {
    vscode.window.showInformationMessage('Telegram Bridge není spuštěn.');
    return;
  }
  poller.stop();
  poller = undefined;
  stopHttpServer();
  setStatusBar(false, false);
  statusViewProvider?.update({ running: false, isActive: false, botName: undefined, lastMessage: undefined });
  logInfo('[bridge] Zastaven.');
  vscode.window.showInformationMessage('📴 Telegram Bridge zastaven.');
}

// ---------------------------------------------------------------------------
// Zpracování příchozí Telegram zprávy
// ---------------------------------------------------------------------------

async function handleTelegramMessage(
  msg: import('./telegramPoller').TgMessage,
  context: vscode.ExtensionContext,
  cfg: vscode.WorkspaceConfiguration,
): Promise<void> {
  const text = msg.text ?? '';
  if (!text) return;

  const chatId = String(msg.chat.id);
  const senderName =
    msg.from
      ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ')
      : msg.chat.title ?? 'Telegram';

  // Guard: zpracovávej zprávy pouze pokud je toto okno aktivním příjemcem
  if (!isActiveWorkspace(context)) {
    logInfo(`[msg] Ignoruji – toto okno není aktivní příjemce. ("${vscode.workspace.name ?? 'workspace'}")`);
    return;
  }

  // Rate limiting check
  if (!rateLimiter.check(chatId)) {
    const retryAfter = Math.ceil(rateLimiter.getRetryAfter(chatId) / 1000);
    logInfo(`[msg] Rate limit exceeded for ${chatId} (${senderName}). Retry after ${retryAfter}s.`);
    try {
      const rateLimitMsg = `⚠️ *Rate limit exceeded*\n\n` +
        `You're sending messages too quickly. Please wait ${retryAfter} second${retryAfter > 1 ? 's' : ''} before trying again.\n\n` +
        `Limit: 10 messages per minute.`;
      const { formatted, parseMode } = formatTelegramText(rateLimitMsg);
      await poller?.sendMessage(chatId, formatted, parseMode);
    } catch (err) {
      logError('[msg] Failed to send rate limit notification', err);
    }
    return;
  }

  logInfo(`[msg] ${senderName} (${chatId}): ${text.substring(0, 120)}`);

  // Zapamatuj si posledního odesilatele pro replyDone
  lastSenderChatId = chatId;
  lastSenderName = senderName;

  // Aktualizuj sidebar s poslední zprávou
  statusViewProvider?.update({
    lastMessage: {
      sender: senderName,
      preview: text.substring(0, 80),
      time: new Date(),
    },
  });

  // Speciální příkaz /chatid – odešle botovi zpět chat ID
  if (text.trim() === '/chatid' || text.trim() === '/start') {
    try {
      const chatIdMsg = `🆔 *Tvoje Chat ID:* \`${chatId}\`\n\n` +
        `Přidej ho do VS Code nastavení \`telegramBridge.allowedChatIds\`.\n` +
        `Nebo spusť příkaz: *Telegram Bridge: Průvodce nastavením*`;
      const { formatted, parseMode } = formatTelegramText(chatIdMsg);
      await poller?.sendMessage(chatId, formatted, parseMode);
    } catch {}
    return;
  }

  const mode = cfg.get<string>('chatMode') ?? 'inject';
  const prefix = cfg.get<boolean>('prefixMessage') ?? true;
  const wsContext = cfg.get<string>('workspaceContext') ?? 'workspace';
  const addTelegramReplyInstruction = cfg.get<boolean>('addTelegramReplyInstruction') ?? true;

  const displayText = prefix ? `📱 ${senderName}: ${text}` : text;
  const instructedText = buildTelegramChatText(displayText, senderName, addTelegramReplyInstruction);

  // Upozornění v VS Code
  void vscode.window.showInformationMessage(
    `📱 Telegram: ${text.length > 60 ? text.substring(0, 57) + '…' : text}`,
    'Zobrazit log',
    '✅ Hotovo!',
  ).then((action) => {
    if (action === 'Zobrazit log') log.show();
    else if (action === '✅ Hotovo!') void replyDone();
  });

  if (mode === 'participant') {
    // Participant mód: "@tg <zpráva>" → @tg zpracuje + odešle odpověď zpátky
    // NOTE: @tg has its own isolated context – use inject/direct for ongoing conversations.
    // Workspace context is handled inside chatParticipant.ts by forwarding to @workspace.
    if (!poller) return;
    setPendingTelegramReply(chatId, poller);
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@tg ${text}`,
        isPartialQuery: false,
      });
    } catch (err) {
      logInfo(`[msg] Chyba otevření chatu: ${err}`);
      await fallbackToClipboard(displayText);
    }
  } else if (mode === 'inject') {
    // Inject mód (výchozí): vloží text do input boxu stávajícího chatu.
    // autoSubmit=true (výchozí): po submitDelay ms se odešle automaticky.
    // autoSubmit=false: uživatel stiskne Enter ručně.
    const autoSubmit = cfg.get<boolean>('autoSubmit') ?? true;
    const submitDelay = Math.max(300, cfg.get<number>('submitDelay') ?? 1500);

    const contextPrefix =
      wsContext === 'workspace' ? '@workspace '
      : wsContext === 'agent'   ? '@workspace /new '
      : '';

    const query = contextPrefix + instructedText;
    logInfo(`[msg] Inject mode (autoSubmit=${autoSubmit}, delay=${submitDelay}ms, wsContext=${wsContext})`);

    try {
      // Fáze 1: zobraz text v input boxu bez odeslání
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query,
        isPartialQuery: true,
      });
    } catch (err) {
      logInfo(`[msg] Chyba inject módu (fáze 1): ${err}`);
      await fallbackToClipboard(instructedText);
      return;
    }

    if (!autoSubmit) {
      logInfo('[msg] autoSubmit=false – čekám na Enter od uživatele');
      return;
    }

    // Fáze 2: po submitDelay odešli do stávajícího chat threadu.
    // Uživatel vidí po dobu delay co se chystá odeslat – Escape = zruší fókus a zastaví to.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(async () => {
        try {
          await vscode.commands.executeCommand('workbench.action.chat.open', {
            query,
            isPartialQuery: false,
          });
          logInfo('[msg] Inject: zpráva automaticky odeslána do chatu');
        } catch (err) {
          logInfo(`[msg] Chyba inject módu (fáze 2 – submit): ${err}`);
        }
        resolve();
      }, submitDelay);
      context.subscriptions.push({ dispose: () => { clearTimeout(timer); resolve(); } });
    });
  } else {
    // Direct mód: sestavíme query s volitelným workspace kontextem
    //
    // wsContext = 'workspace' → prepend "@workspace " → Copilot prohledá codebase
    // wsContext = 'agent'     → prepend "@workspace /new " → agent mode (čte/píše soubory)
    // wsContext = 'none'      → jen holý text (chování jako dřív)
    const contextPrefix =
      wsContext === 'workspace' ? '@workspace '
      : wsContext === 'agent'   ? '@workspace /new '
      : '';

    const query = contextPrefix + instructedText;
    logInfo(`[msg] Direct mode, wsContext=${wsContext}, query prefix: "${contextPrefix.trim() || '(none)'}"`);

    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query,
        isPartialQuery: false,
      });
    } catch (err) {
      logInfo(`[msg] Chyba otevření chatu (direct): ${err}`);
      await fallbackToClipboard(instructedText);
    }
  }
}

function buildTelegramChatText(
  messageText: string,
  senderName: string,
  addTelegramReplyInstruction: boolean,
): string {
  if (!addTelegramReplyInstruction) return messageText;

  return (
    `[Telegram message from ${senderName}. ` +
    `When you finish the task, call telegram_reply with a concise summary of what was done, ` +
    `which files changed, and any warnings or next steps.]\n\n` +
    messageText
  );
}

// ---------------------------------------------------------------------------
// Příkazy pro rychlé odpovědi zpět do Telegramu
// ---------------------------------------------------------------------------

/** Odešle "✅ Hotovo!" zpět poslednímu odesilateli */
async function replyDone(): Promise<void> {
  const targetChatId = getReplyTargetChatId();
  if (!targetChatId || !poller) {
    vscode.window.showWarningMessage('Telegram Bridge: No previous message to reply to.');
    return;
  }
  const workspaceName = vscode.workspace.name ?? 'VS Code';
  const msg = `✅ *Done!*\n_Project: ${workspaceName}_`;
  await sendReplyWithRetry(targetChatId, msg, '✅ Sent to Telegram');
}

/** Odešle vlastní zprávu zpět poslednímu odesilateli */
async function replyCustom(): Promise<void> {
  const targetChatId = getReplyTargetChatId();
  if (!targetChatId || !poller) {
    vscode.window.showWarningMessage('Telegram Bridge: No previous message to reply to.');
    return;
  }
  const workspaceName = vscode.workspace.name ?? 'VS Code';
  const input = await vscode.window.showInputBox({
    title: `📤 Reply to Telegram → ${lastSenderName ?? targetChatId}`,
    prompt: 'Message text (Markdown supported)',
    placeHolder: `Project ${workspaceName}: generation complete, file saved.`,
    ignoreFocusOut: true,
  });
  if (!input) return;
  await sendReplyWithRetry(targetChatId, input, '📤 Sent to Telegram');
}

/**
 * Sends a Telegram message with automatic error notification + Retry button.
 * Used by replyDone, replyCustom, and any other place that needs a reliable send.
 */
async function sendReplyWithRetry(chatId: string, text: string, successMsg: string): Promise<void> {
  if (!poller) {
    vscode.window.showWarningMessage('Telegram Bridge: Bridge is not running.');
    return;
  }

  const trySend = async (): Promise<boolean> => {
    try {
      const { formatted, parseMode } = formatTelegramText(text);
      await poller!.sendMessage(chatId, formatted, parseMode);
      logInfo(`[reply] Sent to chatId=${chatId} (${text.length} chars)`);
      vscode.window.showInformationMessage(successMsg);
      return true;
    } catch (err) {
      logError(`[reply] Failed to send to chatId=${chatId}`, err);
      return false;
    }
  };

  if (await trySend()) return;

  // Failed — show error with Retry + View Log
  const action = await vscode.window.showErrorMessage(
    `📱 Telegram Bridge: Failed to send message to Telegram.`,
    'Retry',
    'View Log',
  );
  if (action === 'Retry') {
    if (!await trySend()) {
      vscode.window.showErrorMessage('📱 Telegram Bridge: Retry also failed. See log for details.');
      log.show();
    }
  } else if (action === 'View Log') {
    log.show();
  }
}

// ---------------------------------------------------------------------------
// Výběr cílového Telegram chatId pro odpovědi
//
// Preferujeme posledního skutečného odesilatele. Pokud ale bridge po reloadu
// běží bez nové příchozí zprávy a v allowlistu je přesně jedno Chat ID,
// použijeme ho jako bezpečný fallback.
// ---------------------------------------------------------------------------

/**
 * Get configured Telegram reply format from VS Code settings.
 */
function getReplyFormat(): TelegramParseMode {
  const cfg = vscode.workspace.getConfiguration('telegramBridge');
  return (cfg.get<string>('replyFormat') || 'HTML') as TelegramParseMode;
}

/**
 * Format text for Telegram with the configured parse mode.
 * Applies appropriate escaping based on the format.
 */
function formatTelegramText(text: string): { formatted: string; parseMode: TelegramParseMode } {
  const parseMode = getReplyFormat();
  return {
    formatted: formatForTelegram(text, parseMode),
    parseMode,
  };
}

function getReplyTargetChatId(): string | undefined {
  if (lastSenderChatId) return lastSenderChatId;

  const allowedIds = config().get<string[]>('allowedChatIds') ?? [];
  if (allowedIds.length === 1) {
    return allowedIds[0];
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Fallback – kopírovat do schránky
// ---------------------------------------------------------------------------

async function fallbackToClipboard(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  const action = await vscode.window.showInformationMessage(
    '📋 Zpráva zkopírována do schránky. Vlož do Copilot Chatu (Ctrl+Shift+I, pak Paste).',
    'Otevřít Chat',
  );
  if (action === 'Otevřít Chat') {
    try {
      await vscode.commands.executeCommand('github.copilot.chat.focus');
    } catch {
      await vscode.commands.executeCommand('workbench.action.chat.open');
    }
  }
}

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('telegramBridge');
}

// ---------------------------------------------------------------------------
// HTTP server pro MCP komunikaci
//
// mcp-server.js volá POST http://127.0.0.1:{port}/send s { message: string }.
// Extension přepošle zprávu do Telegramu, zaznamená výsledek a vrátí JSON.
// Server naslouchá pouze na loopback – žádný síťový přístup zvenčí.
//
// Security (v0.2.0):
// - Shared secret authentication via X-MCP-Secret header
// - Request body size limit (MAX_REQUEST_BODY_SIZE)
// - Message length validation (MAX_MESSAGE_LENGTH)
// ---------------------------------------------------------------------------

function generateSecret(): string {
  const bytes = new Uint8Array(MCP_AUTH_SECRET_LENGTH);
  // Use Node.js crypto for secure random generation
  const nodeCrypto = require('crypto');
  nodeCrypto.randomFillSync(bytes);
  return Buffer.from(bytes).toString('base64');
}

async function startHttpServer(): Promise<void> {
  if (httpServer) return; // již běží

  // Generate shared secret for authentication
  mcpSecret = generateSecret();

  let requestSizeExceeded = false;

  httpServer = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/send') {
      res.writeHead(404); res.end(); return;
    }

    // Verify authentication header
    const providedSecret = req.headers['x-mcp-secret'];
    if (providedSecret !== mcpSecret) {
      logError('[http/mcp] Authentication failed: invalid or missing X-MCP-Secret header');
      res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing secret' }));
      return;
    }

    let body = '';
    let bodySize = 0;
    requestSizeExceeded = false;

    req.on('data', (d: Buffer) => {
      bodySize += d.length;
      if (bodySize > MAX_REQUEST_BODY_SIZE) {
        requestSizeExceeded = true;
        req.destroy();
        res.writeHead(413); // Payload Too Large
        res.end(JSON.stringify({ error: `Request body too large (max ${MAX_REQUEST_BODY_SIZE} bytes)` }));
        return;
      }
      body += d.toString();
    });
    req.on('end', async () => {
      if (requestSizeExceeded) return; // Already handled

      try {
        const parsed = JSON.parse(body) as { message?: unknown };
        if (typeof parsed.message !== 'string' || !parsed.message) {
          res.writeHead(400); res.end(JSON.stringify({ error: 'message field (string) required' })); return;
        }

        // Validate message length
        const msg = parsed.message;
        const msgBytes = Buffer.byteLength(msg, 'utf8');
        if (msgBytes > MAX_MESSAGE_LENGTH) {
          res.writeHead(413);
          res.end(JSON.stringify({ 
            error: `Message too large (${msgBytes} bytes, max ${MAX_MESSAGE_LENGTH} bytes)` 
          }));
          return;
        }

        const targetChatId = getReplyTargetChatId();
        if (!targetChatId || !poller) {
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'No Telegram sender yet, or bridge is not running.' }));
          return;
        }
        // Format text with configured parse mode
        const { formatted, parseMode } = formatTelegramText(msg);
        const chunks: string[] = [];
        for (let i = 0; i < formatted.length; i += TELEGRAM_MESSAGE_MAX_LENGTH) {
          chunks.push(formatted.slice(i, i + TELEGRAM_MESSAGE_MAX_LENGTH));
        }
        for (const chunk of chunks) await poller.sendMessage(targetChatId, chunk, parseMode);

        const n = chunks.length;
        const summary =
          `✅ Odesláno do Telegramu (${msg.length} znaků, ${n} zpráv${n > 1 ? '' : 'a'}) ` +
          `[Telegram Bridge v${extensionVersion}]`;
        logInfo(`[http/mcp] ${summary} → chatId=${targetChatId}`);
        vscode.window.showInformationMessage(`📱 ${summary}`);
        res.writeHead(200); res.end(JSON.stringify({ summary }));
      } catch (err) {
        logError('[http/mcp] Chyba odeslání', err);
        const sanitized = sanitizeError(err, 'http_send');
        res.writeHead(500); res.end(JSON.stringify({ error: sanitized }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer!.listen(0, '127.0.0.1', () => resolve());
    httpServer!.on('error', reject);
  });

  const port = (httpServer.address() as { port: number }).port;
  try {
    fs.mkdirSync(BRIDGE_DIR, { recursive: true });
    fs.writeFileSync(PORT_FILE, String(port), 'utf8');
    if (mcpSecret) {
      fs.writeFileSync(SECRET_FILE, mcpSecret, 'utf8');
    }
  } catch (err) {
    logError('[http/mcp] Nepodařilo se zapsat port/secret files', err);
  }
  logInfo(`[http/mcp] HTTP server naslouchá na 127.0.0.1:${port} (authenticated)`);
}

function stopHttpServer(): void {
  if (!httpServer) return;
  httpServer.close();
  httpServer = undefined;
  mcpSecret = undefined;
  try { 
    fs.unlinkSync(PORT_FILE); 
    fs.unlinkSync(SECRET_FILE);
  } catch { /* soubory neexistovaly, ok */ }
  logInfo('[http/mcp] HTTP server zastaven.');
}

// ---------------------------------------------------------------------------
// Kopírování MCP serveru do stabilní cesty
//
// mcp-server.js se kopíruje do ~/.vscode-telegram-bridge/mcp-server.js
// při každé aktivaci extension (aby se aktualizoval při upgrade).
// Tato cesta je stabilní – nezávisí na verzi extension.
// ---------------------------------------------------------------------------

function copyMcpServer(context: vscode.ExtensionContext): void {
  try {
    const src  = fspath.join(context.extensionPath, 'resources', 'mcp-server.js');
    const dest = fspath.join(BRIDGE_DIR, 'mcp-server.js');
    fs.mkdirSync(BRIDGE_DIR, { recursive: true });
    fs.copyFileSync(src, dest);
    logInfo(`[mcp] MCP server zkopírován → ${dest}`);
  } catch (err) {
    logError('[mcp] Nepodařilo se zkopírovat MCP server', err);
  }
}

// ---------------------------------------------------------------------------
// Registrace MCP serveru do VS Code settings.json
//
// Provede se jednou (globalState flag). Přidá záznam do mcp.servers tak,
// aby Copilot automaticky spustil mcp-server.js při startu VS Code.
// ---------------------------------------------------------------------------

async function ensureMcpRegistered(context: vscode.ExtensionContext): Promise<void> {
  const mcpServerPath = fspath.join(BRIDGE_DIR, 'mcp-server.js');

  // Zkontroluj jestli je již registrováno
  const mcpCfg = vscode.workspace.getConfiguration('mcp');
  const existingServers = mcpCfg.get<Record<string, unknown>>('servers') ?? {};
  if ('telegram-bridge' in existingServers) {
    logInfo('[mcp] MCP server již registrován v settings.json.');
    return;
  }

  const nodeBin = findNodeBinary();
  const newServers = {
    ...existingServers,
    'telegram-bridge': {
      type: 'stdio',
      command: nodeBin,
      args: [mcpServerPath],
    },
  };

  try {
    await mcpCfg.update('servers', newServers, vscode.ConfigurationTarget.Global);
    logInfo(`[mcp] MCP server zaregistrován v settings.json (node: ${nodeBin}).`);
  } catch (err) {
    logError('[mcp] Nepovedlo se zapsat do settings.json', err);
    void vscode.window.showWarningMessage(
      '📱 Telegram Bridge: Nepodařilo se automaticky zaregistrovat MCP server. ' +
      'Přidej ho ručně – viz README → Releases.',
    );
    return;
  }

  const action = await vscode.window.showInformationMessage(
    '📱 Telegram Bridge: MCP server zaregistrován! ' +
    'Pro aktivaci #telegram_reply toolu restartuj VS Code.',
    'Restartovat nyní',
    'Později',
  );
  if (action === 'Restartovat nyní') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

/** Najde spustitelný node binary. Vrátí absolutní cestu nebo 'node' jako fallback. */
function findNodeBinary(): string {
  const candidates = [
    '/opt/homebrew/bin/node',       // macOS Homebrew (Apple Silicon)
    '/usr/local/bin/node',          // macOS Homebrew (Intel) / nvm default
    `${os.homedir()}/.nvm/versions/node/$(node --version 2>/dev/null)/bin/node`,
    '/usr/bin/node',                // Linux system
  ];
  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* zkus další */ }
  }
  return 'node'; // fallback – spoléháme na PATH
}

/**
 * @param running  - poller je spuštěn
 * @param isActive - toto okno je aktivní příjemce zpráv (relevantní jen pokud running=true)
 */
function setStatusBar(running: boolean, isActive = true): void {
  if (!statusBar) return;
  const wsName = vscode.workspace.name ?? '';
  const shortName = wsName.length > 12 ? wsName.substring(0, 12) + '…' : wsName;

  if (running && isActive) {
    statusBar.text = `$(broadcast) TG $(check)${shortName ? ' ' + shortName : ''}`;
    statusBar.tooltip =
      `Telegram Bridge v${extensionVersion}: AKTIVNÍ příjemce${wsName ? ' – "' + wsName + '"' : ''}\n` +
      'Zprávy z Telegramu jdou sem.\nKlikni pro zastavení.';
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBar.color = undefined;
  } else if (running && !isActive) {
    statusBar.text = `$(broadcast) TG $(debug-pause)${shortName ? ' ' + shortName : ''}`;
    statusBar.tooltip =
      `Telegram Bridge v${extensionVersion}: běží, ale PASIVNÍ${wsName ? ' – "' + wsName + '"' : ''}\n` +
      'Zprávy jdou do jiného okna.\nKlikni pro zastavení. Příkaz "Nastavit jako aktivní" pro přesměrování sem.';
    statusBar.backgroundColor = undefined;
    statusBar.color = new vscode.ThemeColor('statusBarItem.foreground');
  } else {
    statusBar.text = `$(broadcast) TG${shortName ? ' ' + shortName : ''}`;
    statusBar.tooltip =
      `Telegram Bridge v${extensionVersion}: Neaktivní${wsName ? ' – "' + wsName + '"' : ''}\n` +
      'Klikni pro spuštění.';
    statusBar.backgroundColor = undefined;
    statusBar.color = new vscode.ThemeColor('statusBarItem.foreground');
  }
}
