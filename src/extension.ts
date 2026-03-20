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
import { TelegramPoller } from './telegramPoller';
import { registerChatParticipant, setPendingTelegramReply } from './chatParticipant';
import { StatusViewProvider } from './statusView';

// ---------------------------------------------------------------------------
// Stav modulu
// ---------------------------------------------------------------------------

let poller: TelegramPoller | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let log: vscode.OutputChannel;
let statusViewProvider: StatusViewProvider | undefined;

/** Chat ID posledního odesilatele – pro příkaz replyDone */
let lastSenderChatId: string | undefined;
/** Jméno posledního odesilatele */
let lastSenderName: string | undefined;

const SECRET_KEY = 'telegramBridge.botToken';
/** Klíč v globalState – uchovává ID aktivního workspace napříč okny */
const ACTIVE_WORKSPACE_KEY = 'telegramBridge.activeWorkspaceId';

// ---------------------------------------------------------------------------
// Aktivace
// ---------------------------------------------------------------------------

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log = vscode.window.createOutputChannel('Telegram Bridge', { log: true });
  context.subscriptions.push(log);
  log.appendLine('Telegram Bridge se aktivuje...');

  // Status bar tlačítko
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
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
    log.appendLine('autoStart=false – bridge není spuštěn. Použij příkaz "Telegram Bridge: Spustit bridge".');
  }
}

export function deactivate(): void {
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
  log.appendLine(`[routing] Nastaven jako aktivní příjemce: "${myName}"`);
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
  log.appendLine('[setup] Bot token uložen do VS Code Secrets.');

  // Krok 2: Ověření tokenu
  vscode.window.showInformationMessage('⏳ Ověřuji token u Telegram API...');
  try {
    const tempPoller = new TelegramPoller(token, new Set(), () => {}, () => {});
    const me = await tempPoller.getMe();
    log.appendLine(`[setup] Bot ověřen: @${me.username ?? me.first_name} (id=${me.id})`);
    vscode.window.showInformationMessage(
      `✅ Připojen bot: @${me.username ?? me.first_name}\n` +
        `Pošli botovi /chatid ze svého Telegramu pro zjištění svého Chat ID.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(`❌ Chyba ověření tokenu: ${err}`);
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
  log.appendLine(`[setup] Chat ID ${chatIdInput} přidáno do allowedChatIds.`);

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
    log.appendLine(`[bridge] Nastaven jako primární příjemce: "${myName}"`);
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
      log.appendLine(`[bridge] Přesměrován jako aktivní příjemce: "${myName}"`);
    } else if (!action) {
      return; // Uživatel zrušil
    }
    // 'Jen spustit polling' – poller běží, ale zprávy se zpracují jen pokud
    // se toto okno stane aktivním (viz handleTelegramMessage guard)
  }

  log.appendLine(`[bridge] Spouštím – povolená Chat ID: ${[...allowedSet].join(', ')}`);

  poller = new TelegramPoller(
    token,
    allowedSet,
    (msg) => handleTelegramMessage(msg, context, cfg),
    (err) => {
      log.appendLine(`[bridge] Chyba: ${err.message}`);
    },
  );

  poller.start();
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
    log.appendLine(`[bridge] Připojen: ${botName}`);
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
  setStatusBar(false, false);
  statusViewProvider?.update({ running: false, isActive: false, botName: undefined, lastMessage: undefined });
  log.appendLine('[bridge] Zastaven.');
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
    log.appendLine(`[msg] Ignoruji – toto okno není aktivní příjemce. ("${vscode.workspace.name ?? 'workspace'}")`);
    return;
  }

  log.appendLine(`[msg] ${senderName} (${chatId}): ${text.substring(0, 120)}`);

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
      await poller?.sendMessage(
        chatId,
        `🆔 *Tvoje Chat ID:* \`${chatId}\`\n\n` +
          `Přidej ho do VS Code nastavení \`telegramBridge.allowedChatIds\`.\n` +
          `Nebo spusť příkaz: *Telegram Bridge: Průvodce nastavením*`,
      );
    } catch {}
    return;
  }

  const mode = cfg.get<string>('chatMode') ?? 'direct';
  const prefix = cfg.get<boolean>('prefixMessage') ?? true;

  const displayText = prefix ? `📱 ${senderName}: ${text}` : text;

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
    if (!poller) return;
    setPendingTelegramReply(chatId, poller);
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@tg ${text}`,
        isPartialQuery: false,
      });
    } catch (err) {
      log.appendLine(`[msg] Chyba otevření chatu: ${err}`);
      await fallbackToClipboard(displayText);
    }
  } else {
    // Direct mód: zpráva jde přímo do Copilot chatu
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: displayText,
        isPartialQuery: false,
      });
    } catch (err) {
      log.appendLine(`[msg] Chyba otevření chatu (direct): ${err}`);
      await fallbackToClipboard(displayText);
    }
  }
}

// ---------------------------------------------------------------------------
// Příkazy pro rychlé odpovědi zpět do Telegramu
// ---------------------------------------------------------------------------

/** Odešle "✅ Hotovo!" zpět poslednímu odesilateli */
async function replyDone(): Promise<void> {
  if (!lastSenderChatId || !poller) {
    vscode.window.showWarningMessage('Telegram Bridge: Žádná předchozí zpráva k odpovězení.');
    return;
  }
  const workspaceName = vscode.workspace.name ?? 'VS Code';
  const msg = `✅ *Hotovo!*\n_Projekt: ${workspaceName}_`;
  try {
    await poller.sendMessage(lastSenderChatId, msg);
    log.appendLine(`[reply] Odesláno "Hotovo" do ${lastSenderChatId}`);
    vscode.window.showInformationMessage(`✅ Odesláno do Telegramu (${lastSenderName ?? lastSenderChatId})`);
  } catch (err) {
    vscode.window.showErrorMessage(`Chyba odesílání do Telegramu: ${err}`);
  }
}

/** Odešle vlastní zprávu zpět poslednímu odesilateli */
async function replyCustom(): Promise<void> {
  if (!lastSenderChatId || !poller) {
    vscode.window.showWarningMessage('Telegram Bridge: Žádná předchozí zpráva k odpovězení.');
    return;
  }
  const workspaceName = vscode.workspace.name ?? 'VS Code';
  const input = await vscode.window.showInputBox({
    title: `📤 Odpověď do Telegramu → ${lastSenderName ?? lastSenderChatId}`,
    prompt: 'Text odpovědi (Markdown podporován)',
    placeHolder: `Projekt ${workspaceName}: vygenerování dokončeno, soubor uložen.`,
    ignoreFocusOut: true,
  });
  if (!input) return;
  try {
    await poller.sendMessage(lastSenderChatId, input);
    log.appendLine(`[reply] Vlastní odpověď odeslána do ${lastSenderChatId}`);
    vscode.window.showInformationMessage(`📤 Odesláno do Telegramu`);
  } catch (err) {
    vscode.window.showErrorMessage(`Chyba odesílání: ${err}`);
  }
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
      `Telegram Bridge: AKTIVNÍ příjemce${wsName ? ' – "' + wsName + '"' : ''}\n` +
      'Zprávy z Telegramu jdou sem.\nKlikni pro zastavení.';
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBar.color = undefined;
  } else if (running && !isActive) {
    statusBar.text = `$(broadcast) TG $(debug-pause)${shortName ? ' ' + shortName : ''}`;
    statusBar.tooltip =
      `Telegram Bridge: běží, ale PASIVNÍ${wsName ? ' – "' + wsName + '"' : ''}\n` +
      'Zprávy jdou do jiného okna.\nKlikni pro zastavení. Příkaz "Nastavit jako aktivní" pro přesměrování sem.';
    statusBar.backgroundColor = undefined;
    statusBar.color = new vscode.ThemeColor('statusBarItem.foreground');
  } else {
    statusBar.text = `$(broadcast) TG${shortName ? ' ' + shortName : ''}`;
    statusBar.tooltip =
      `Telegram Bridge: Neaktivní${wsName ? ' – "' + wsName + '"' : ''}\n` +
      'Klikni pro spuštění.';
    statusBar.backgroundColor = undefined;
    statusBar.color = new vscode.ThemeColor('statusBarItem.foreground');
  }
}
