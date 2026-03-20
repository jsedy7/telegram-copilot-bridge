#!/usr/bin/env node
/**
 * Telegram Bridge – MCP stdio server
 *
 * Implements the Model Context Protocol (MCP) over stdin/stdout.
 * Exposes a single tool: telegram_reply
 *
 * Communication flow:
 *   Copilot agent → MCP (this script) → HTTP POST 127.0.0.1:{port}/send → VS Code extension → Telegram
 *
 * The VS Code extension writes its HTTP port to:
 *   ~/.vscode-telegram-bridge/port
 *
 * Zero external dependencies — only Node.js built-ins.
 */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT_FILE = path.join(os.homedir(), '.vscode-telegram-bridge', 'port');

// ---------------------------------------------------------------------------
// HTTP call to the VS Code extension
// ---------------------------------------------------------------------------

function callExtension(message) {
  return new Promise((resolve, reject) => {
    let port;
    try { port = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10); }
    catch { reject(new Error('Telegram Bridge is not running. Start it in VS Code first.')); return; }
    if (!port || isNaN(port)) { reject(new Error('Invalid port file. Restart the bridge in VS Code.')); return; }

    const body = JSON.stringify({ message });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (d) => { data += d; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(data)); }
            catch { resolve({ summary: '✅ Sent.' }); }
          } else {
            try { reject(new Error(JSON.parse(data).error || `HTTP ${res.statusCode}`)); }
            catch { reject(new Error(`HTTP ${res.statusCode}: ${data}`)); }
          }
        });
      },
    );
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Request timed out.')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'telegram_reply',
    description:
      'Sends a text message back to the Telegram user who triggered the current task via Telegram Bridge. ' +
      'Call this tool after you have completed the requested work to notify the user on their mobile device. ' +
      'The user is likely away from the computer (e.g. on a couch) and waiting for a summary of results. ' +
      'Supports Telegram Markdown: *bold*, _italic_, `inline code`, ```multiline code block```. ' +
      'Be informative: summarise what was done, which files were changed, and any warnings or next steps.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description:
            'The message text to send to Telegram. ' +
            'Summarise completed work and outcomes. ' +
            'Telegram Markdown supported: *bold* _italic_ `code` ```block```.',
        },
      },
      required: ['message'],
    },
  },
];

// ---------------------------------------------------------------------------
// MCP JSON-RPC 2.0 over stdin/stdout
// ---------------------------------------------------------------------------

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

let buf = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', async (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop(); // keep any incomplete trailing fragment
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try { msg = JSON.parse(trimmed); }
    catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    await dispatch(msg);
  }
});

async function dispatch(msg) {
  const { id, method, params } = msg;

  // Notifications (no id): no response required
  if (method === 'notifications/initialized' || method === 'initialized') return;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'telegram-bridge', version: '0.1.5' },
      },
    });

  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });

  } else if (method === 'tools/call') {
    const toolName = params?.name;
    if (toolName !== 'telegram_reply') {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } });
      return;
    }
    try {
      const result = await callExtension(params?.arguments?.message ?? '');
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: result.summary ?? '✅ Sent.' }] },
      });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        },
      });
    }

  } else {
    if (id !== undefined && id !== null) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  }
}

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
