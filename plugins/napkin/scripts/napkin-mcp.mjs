#!/usr/bin/env node

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  cellReferenceToIndexes,
  defaultWorkbook,
  getDefaultWorkbookId,
  indexesToCellReference,
  readWorkbook,
  resetWorkbook,
  root,
  updateCell,
  updateCells,
  workbookPathFor,
  writeWorkbook
} from "./workbook-store.mjs";

const serverInfo = { name: "napkin", version: "0.1.1" };
const protocolVersion = "2025-06-18";
const defaultPort = Number(process.env.NAPKIN_PORT || 4173);

const tools = [
  {
    name: "napkin_open_sheet",
    description: "Start the local Napkin spreadsheet UI and return the URL to open in the Codex in-app browser.",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "number", description: "Local port for the spreadsheet UI. Defaults to 4173." },
        workbookId: { type: "string", description: "Thread-scoped workbook id. Defaults to the current Codex thread/session id when available." }
      }
    }
  },
  {
    name: "napkin_get_workbook",
    description: "Read the current spreadsheet workbook, including user edits made in the browser.",
    inputSchema: {
      type: "object",
      properties: {
        workbookId: { type: "string", description: "Thread-scoped workbook id. Defaults to the current Codex thread/session id when available." }
      }
    }
  },
  {
    name: "napkin_set_cell",
    description: "Set one spreadsheet cell. Use formulas beginning with = for calculated cells.",
    inputSchema: {
      type: "object",
      properties: {
        cell: { type: "string", description: "A1-style cell reference, for example B4." },
        row: { type: "number", description: "Zero-based row index. Used when cell is omitted." },
        col: { type: "number", description: "Zero-based column index. Used when cell is omitted." },
        workbookId: { type: "string", description: "Thread-scoped workbook id. Defaults to the current Codex thread/session id when available." },
        value: { type: "string", description: "Raw cell value or formula." }
      },
      required: ["value"]
    }
  },
  {
    name: "napkin_update_cells",
    description: "Set multiple spreadsheet cells in one operation.",
    inputSchema: {
      type: "object",
      properties: {
        cells: {
          type: "array",
          items: {
            type: "object",
            properties: {
              cell: { type: "string", description: "A1-style cell reference." },
              row: { type: "number", description: "Zero-based row index. Used when cell is omitted." },
              col: { type: "number", description: "Zero-based column index. Used when cell is omitted." },
              value: { type: "string", description: "Raw cell value or formula." }
            },
            required: ["value"]
          }
        },
        workbookId: { type: "string", description: "Thread-scoped workbook id. Defaults to the current Codex thread/session id when available." }
      },
      required: ["cells"]
    }
  },
  {
    name: "napkin_replace_workbook",
    description: "Replace the whole workbook with a new grid.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        rows: { type: "number" },
        cols: { type: "number" },
        workbookId: { type: "string", description: "Thread-scoped workbook id. Defaults to the current Codex thread/session id when available." },
        cells: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" }
          }
        }
      },
      required: ["cells"]
    }
  },
  {
    name: "napkin_reset_workbook",
    description: "Reset the workbook to the built-in sample calculation sheet.",
    inputSchema: {
      type: "object",
      properties: {
        workbookId: { type: "string", description: "Thread-scoped workbook id. Defaults to the current Codex thread/session id when available." }
      }
    }
  }
];

let inputBuffer = Buffer.alloc(0);
let messageQueue = Promise.resolve();

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  for (const message of readMessages()) {
    messageQueue = messageQueue.then(() => handleMessage(message)).catch((error) => {
      if (message?.id !== undefined) sendError(message.id, -32603, error.message);
    });
  }
});

process.stdin.resume();

function readMessages() {
  const messages = [];

  while (inputBuffer.length > 0) {
    const headerEnd = inputBuffer.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const header = inputBuffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/content-length:\s*(\d+)/i);
      if (!match) {
        inputBuffer = inputBuffer.subarray(headerEnd + 4);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (inputBuffer.length < bodyEnd) break;

      const body = inputBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
      inputBuffer = inputBuffer.subarray(bodyEnd);
      messages.push(JSON.parse(body));
      continue;
    }

    const newline = inputBuffer.indexOf("\n");
    if (newline === -1) break;

    const line = inputBuffer.subarray(0, newline).toString("utf8").trim();
    inputBuffer = inputBuffer.subarray(newline + 1);
    if (line) messages.push(JSON.parse(line));
  }

  return messages;
}

async function handleMessage(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  if (message.method?.startsWith("notifications/")) return;

  if (message.method === "initialize") {
    return sendResult(message.id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo
    });
  }

  if (message.method === "tools/list") {
    return sendResult(message.id, { tools });
  }

  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params || {};
    const result = await callTool(name, args);
    return sendResult(message.id, {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    });
  }

  if (message.method === "resources/list") return sendResult(message.id, { resources: [] });
  if (message.method === "prompts/list") return sendResult(message.id, { prompts: [] });

  sendError(message.id, -32601, `Unknown method: ${message.method}`);
}

async function callTool(name, args) {
  switch (name) {
    case "napkin_open_sheet":
      return openSheet(args);
    case "napkin_get_workbook":
      return getWorkbook(args);
    case "napkin_set_cell":
      return setCell(args);
    case "napkin_update_cells":
      return setCells(args);
    case "napkin_replace_workbook":
      return replaceWorkbook(args);
    case "napkin_reset_workbook":
      return resetWorkbookTool(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function openSheet(args) {
  const port = Number(args.port || defaultPort);
  const workbookId = getWorkbookId(args);
  const baseUrl = `http://localhost:${port}`;
  const url = `${baseUrl}?workbook=${encodeURIComponent(workbookId)}`;
  if (!(await isReachable(baseUrl))) {
    const child = spawn(process.execPath, ["server.mjs"], {
      cwd: root,
      env: { ...process.env, PORT: String(port), NAPKIN_WORKBOOK_ID: workbookId },
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    await waitForServer(baseUrl);
  }

  return {
    url,
    workbookId,
    workbookPath: workbookPathFor(workbookId),
    nextSteps: [
      `Open ${url} in the Codex in-app browser.`,
      "Use napkin_get_workbook after the user edits cells.",
      "Ask in chat before changing user-edited assumptions or formulas.",
      "Use napkin_update_cells or napkin_replace_workbook only after the user confirms changes."
    ],
    openInCodexBrowser: {
      url,
      reason: "Editable Napkin spreadsheet for the current calculation."
    }
  };
}

async function getWorkbook(args) {
  const workbookId = getWorkbookId(args);
  const workbook = await readWorkbook(workbookId);
  return { workbookId, workbook, workbookPath: workbookPathFor(workbookId) };
}

async function setCell(args) {
  const workbookId = getWorkbookId(args);
  const location = normalizeCellLocation(args);
  const workbook = await updateCell({ ...location, value: args.value, workbookId });
  return {
    workbookId,
    cell: indexesToCellReference(location.row, location.col),
    workbook,
    workbookPath: workbookPathFor(workbookId)
  };
}

async function setCells(args) {
  const workbookId = getWorkbookId(args);
  if (!Array.isArray(args.cells)) throw new Error("cells must be an array");
  const normalizedCells = args.cells.map((cell) => ({
    ...normalizeCellLocation(cell),
    value: cell.value
  }));
  const workbook = await updateCells(normalizedCells, workbookId);
  return {
    workbookId,
    changedCells: normalizedCells.map((cell) => indexesToCellReference(cell.row, cell.col)),
    workbook,
    workbookPath: workbookPathFor(workbookId)
  };
}

async function replaceWorkbook(args) {
  const workbookId = getWorkbookId(args);
  const workbook = await writeWorkbook({
    workbookId,
    title: args.title || "Codex Calculation Sheet",
    rows: args.rows || args.cells.length,
    cols: args.cols || Math.max(1, ...args.cells.map((row) => row.length)),
    cells: args.cells
  }, workbookId);
  return { workbookId, workbook, workbookPath: workbookPathFor(workbookId) };
}

async function resetWorkbookTool(args) {
  const workbookId = getWorkbookId(args);
  const workbook = await resetWorkbook(defaultWorkbook, workbookId);
  return { workbookId, workbook, workbookPath: workbookPathFor(workbookId) };
}

function getWorkbookId(args = {}) {
  return args.workbookId || getDefaultWorkbookId();
}

function normalizeCellLocation(args) {
  if (args.cell) return cellReferenceToIndexes(args.cell);
  if (args.row === undefined || args.col === undefined) {
    throw new Error("Either cell or both row and col are required");
  }
  return { row: Number(args.row), col: Number(args.col) };
}

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isReachable(url)) return;
    await delay(150);
  }
  throw new Error(`Napkin UI did not start at ${url}`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}
