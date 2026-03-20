/**
 * statusView.ts – Activity Bar sidebar panel showing bridge status.
 *
 * Registers as a TreeDataProvider for the 'telegram-bridge.statusView' view.
 * Call statusView.update(patch) from extension.ts whenever any state changes.
 */

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Public state shape
// ---------------------------------------------------------------------------

export interface BridgeState {
  running: boolean;
  isActive: boolean;
  workspaceName: string;
  botName?: string;
  allowedChatCount: number;
  lastMessage?: { sender: string; preview: string; time: Date };
}

// ---------------------------------------------------------------------------
// TreeDataProvider
// ---------------------------------------------------------------------------

export class StatusViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: BridgeState;

  constructor(workspaceName: string, allowedChatCount: number) {
    this.state = {
      running: false,
      isActive: false,
      workspaceName,
      allowedChatCount,
    };
  }

  update(patch: Partial<BridgeState>): void {
    this.state = { ...this.state, ...patch };
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) return [];
    return this.buildItems();
  }

  // ---------------------------------------------------------------------------
  // Build the flat list of tree items
  // ---------------------------------------------------------------------------

  private buildItems(): vscode.TreeItem[] {
    const { running, isActive, workspaceName, botName, allowedChatCount, lastMessage } = this.state;
    const items: vscode.TreeItem[] = [];

    // ── Status ───────────────────────────────────────────────────────────────
    const statusItem = new vscode.TreeItem('Status');
    if (!running) {
      statusItem.description = 'Stopped';
      statusItem.iconPath = new vscode.ThemeIcon(
        'circle-slash',
        new vscode.ThemeColor('list.errorForeground'),
      );
      statusItem.tooltip = 'Bridge is stopped. Run "Telegram Bridge: Start bridge".';
    } else if (isActive) {
      statusItem.description = 'Active — receiving messages';
      statusItem.iconPath = new vscode.ThemeIcon(
        'pass-filled',
        new vscode.ThemeColor('testing.iconPassed'),
      );
      statusItem.tooltip = 'This VS Code window is the active Telegram receiver.';
    } else {
      statusItem.description = 'Running — passive';
      statusItem.iconPath = new vscode.ThemeIcon(
        'debug-pause',
        new vscode.ThemeColor('list.warningForeground'),
      );
      statusItem.tooltip =
        'Polling is running but messages are routed to another VS Code window.\n' +
        'Run "Set as active workspace" to receive messages here.';
    }
    items.push(statusItem);

    // ── Bot name ─────────────────────────────────────────────────────────────
    if (botName) {
      const botItem = new vscode.TreeItem('Bot');
      botItem.description = botName;
      botItem.iconPath = new vscode.ThemeIcon('account');
      botItem.tooltip = `Connected as ${botName}`;
      items.push(botItem);
    }

    // ── Workspace ─────────────────────────────────────────────────────────────
    const wsItem = new vscode.TreeItem('Workspace');
    wsItem.description = workspaceName;
    wsItem.iconPath = new vscode.ThemeIcon(running && isActive ? 'pinned' : 'pin');
    wsItem.tooltip =
      running && isActive
        ? `"${workspaceName}" is the active Telegram receiver.`
        : `Run "Set as active workspace" to send messages to "${workspaceName}".`;
    items.push(wsItem);

    // ── Allowed chats ─────────────────────────────────────────────────────────
    const chatsItem = new vscode.TreeItem('Allowed chats');
    if (allowedChatCount === 0) {
      chatsItem.description = '⚠ none — run Setup Wizard';
      chatsItem.iconPath = new vscode.ThemeIcon(
        'warning',
        new vscode.ThemeColor('list.warningForeground'),
      );
      chatsItem.command = {
        command: 'telegram-bridge.configure',
        title: 'Run Setup Wizard',
        arguments: [],
      };
      chatsItem.tooltip = 'No Chat IDs configured. Click to open the Setup Wizard.';
    } else {
      chatsItem.description = `${allowedChatCount} configured`;
      chatsItem.iconPath = new vscode.ThemeIcon('shield');
      chatsItem.tooltip = `${allowedChatCount} Telegram Chat ID(s) are allowed to send messages.`;
    }
    items.push(chatsItem);

    // ── Last message ──────────────────────────────────────────────────────────
    if (lastMessage) {
      const msgItem = new vscode.TreeItem('Last message');
      const preview =
        lastMessage.preview.length > 45
          ? lastMessage.preview.substring(0, 42) + '…'
          : lastMessage.preview;
      msgItem.description = `${lastMessage.sender}: ${preview}`;
      msgItem.iconPath = new vscode.ThemeIcon('comment');
      msgItem.tooltip = new vscode.MarkdownString(
        `**From:** ${lastMessage.sender}  \n` +
          `**Time:** ${lastMessage.time.toLocaleTimeString()} (${formatAgo(lastMessage.time)})  \n` +
          `**Text:** ${lastMessage.preview}`,
      );
      items.push(msgItem);
    }

    return items;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAgo(time: Date): string {
  const diff = Math.floor((Date.now() - time.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
