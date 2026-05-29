#!/usr/bin/env node

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  cellReferenceToIndexes,
  defaultWorkbook,
  getDefaultWorkbookId,
  indexesToCellReference,
  napkinVersion,
  readWorkbook,
  resetWorkbook,
  root,
  updateCell,
  updateCells,
  workbookPathFor,
  writeWorkbook
} from "./workbook-store.mjs";

const command = process.argv[2];
const args = await readArgs();

try {
  const result = await run(command, args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

async function run(name, args) {
  switch (name) {
    case "open":
      return openSheet(args);
    case "get":
      return getWorkbook(args);
    case "set-cell":
      return setCell(args);
    case "update-cells":
      return setCells(args);
    case "replace":
      return replaceWorkbook(args);
    case "reset":
      return resetWorkbookTool(args);
    default:
      throw new Error([
        "Usage: node scripts/napkin-cli.mjs <command> [json-args]",
        "Commands: open, get, set-cell, update-cells, replace, reset",
        "Examples:",
        "  node scripts/napkin-cli.mjs open '{\"workbookId\":\"quote-thread\"}'",
        "  node scripts/napkin-cli.mjs replace '{\"workbookId\":\"quote-thread\",\"title\":\"Quote\",\"cells\":[[\"Item\",\"Amount\"],[\"Total\",\"100\"]]}'"
      ].join("\n"));
  }
}

async function readArgs() {
  const inline = process.argv[3];
  if (inline) return JSON.parse(inline);

  if (process.stdin.isTTY) return {};

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8").trim();
  return body ? JSON.parse(body) : {};
}

async function openSheet(args) {
  const port = await resolvePort(Number(args.port || process.env.NAPKIN_PORT || 4173));
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
    openInCodexBrowser: {
      url,
      reason: "Editable Napkin spreadsheet for the current calculation."
    }
  };
}

async function resolvePort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    const status = await getServerStatus(`http://localhost:${port}`);
    if (status === "compatible" || status === "free") return port;
  }
  throw new Error(`No available Napkin port found starting at ${preferredPort}`);
}

async function getWorkbook(args) {
  const workbookId = getWorkbookId(args);
  return {
    workbookId,
    workbook: await readWorkbook(workbookId),
    workbookPath: workbookPathFor(workbookId)
  };
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
  if (!Array.isArray(args.cells)) throw new Error("cells must be an array");
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

function normalizeCellLocation(args) {
  if (args.cell) return cellReferenceToIndexes(args.cell);
  if (args.row === undefined || args.col === undefined) {
    throw new Error("Either cell or both row and col are required");
  }
  return { row: Number(args.row), col: Number(args.col) };
}

function getWorkbookId(args = {}) {
  return args.workbookId || getDefaultWorkbookId();
}

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function getServerStatus(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/info`);
    if (!response.ok) return "occupied";
    const info = await response.json();
    return info.name === "napkin" && info.version === napkinVersion ? "compatible" : "occupied";
  } catch {
    return "free";
  }
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isReachable(url)) return;
    await delay(150);
  }
  throw new Error(`Napkin UI did not start at ${url}`);
}
