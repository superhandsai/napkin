import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));
export const dataDir = process.env.NAPKIN_DATA_DIR || join(homedir(), ".codex", "napkin");

export const defaultWorkbook = {
  version: 1,
  title: "Codex Calculation Sheet",
  rows: 24,
  cols: 10,
  cells: [
    ["Item", "Value", "Notes"],
    ["Revenue", "12500", "", ""],
    ["Costs", "7300", "", ""],
    ["Profit", "=B2-B3", "", ""],
    ["Margin", "=B4/B2", "", ""],
    ["Check total", "=SUM(B2:B3)", "", ""]
  ],
  updatedAt: new Date().toISOString()
};

export function getDefaultWorkbookId() {
  return sanitizeWorkbookId(
    process.env.NAPKIN_WORKBOOK_ID ||
      process.env.CODEX_THREAD_ID ||
      process.env.CODEX_SESSION_ID ||
      process.env.CODEX_TASK_ID ||
      process.env.CODEX_CONVERSATION_ID ||
      "default"
  );
}

export function workbookPathFor(workbookId = getDefaultWorkbookId()) {
  return join(dataDir, "workbooks", `${sanitizeWorkbookId(workbookId)}.json`);
}

export async function ensureWorkbook(workbookId = getDefaultWorkbookId()) {
  const path = workbookPathFor(workbookId);
  await mkdir(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    await writeWorkbook(defaultWorkbook, workbookId);
  }
}

export async function readWorkbook(workbookId = getDefaultWorkbookId()) {
  await ensureWorkbook(workbookId);
  return JSON.parse(await readFile(workbookPathFor(workbookId), "utf8"));
}

export async function writeWorkbook(workbook, workbookId = getDefaultWorkbookId()) {
  const path = workbookPathFor(workbookId);
  await mkdir(dirname(path), { recursive: true });
  const normalized = normalizeWorkbook(workbook, workbookId);
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export async function updateCell({ row, col, value, workbookId = getDefaultWorkbookId() }) {
  const workbook = await readWorkbook(workbookId);
  const rowIndex = normalizeIndex(row);
  const colIndex = normalizeIndex(col);
  const rows = Math.max(workbook.rows, rowIndex + 1);
  const cols = Math.max(workbook.cols, colIndex + 1);
  workbook.rows = rows;
  workbook.cols = cols;
  workbook.cells = expandCells(workbook.cells, rows, cols);
  workbook.cells[rowIndex][colIndex] = String(value ?? "");
  return writeWorkbook(workbook, workbookId);
}

export async function updateCells(cells, workbookId = getDefaultWorkbookId()) {
  const workbook = await readWorkbook(workbookId);
  for (const cell of cells) {
    const rowIndex = normalizeIndex(cell.row);
    const colIndex = normalizeIndex(cell.col);
    workbook.rows = Math.max(workbook.rows, rowIndex + 1);
    workbook.cols = Math.max(workbook.cols, colIndex + 1);
    workbook.cells = expandCells(workbook.cells, workbook.rows, workbook.cols);
    workbook.cells[rowIndex][colIndex] = String(cell.value ?? "");
  }
  return writeWorkbook(workbook, workbookId);
}

export async function resetWorkbook(workbook = defaultWorkbook, workbookId = getDefaultWorkbookId()) {
  return writeWorkbook(workbook, workbookId);
}

export function normalizeWorkbook(workbook, workbookId = getDefaultWorkbookId()) {
  const rows = Math.max(1, Math.min(200, Number(workbook.rows) || defaultWorkbook.rows));
  const cols = Math.max(1, Math.min(50, Number(workbook.cols) || defaultWorkbook.cols));
  return {
    version: 1,
    workbookId: sanitizeWorkbookId(workbook.workbookId || workbookId),
    title: String(workbook.title || defaultWorkbook.title),
    rows,
    cols,
    cells: expandCells(workbook.cells, rows, cols),
    updatedAt: new Date().toISOString()
  };
}

export function cellReferenceToIndexes(reference) {
  const match = /^([A-Z]+)(\d+)$/i.exec(String(reference || "").trim());
  if (!match) throw new Error(`Invalid cell reference: ${reference}`);
  const col = [...match[1].toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
  const row = Number(match[2]) - 1;
  if (row < 0 || col < 0) throw new Error(`Invalid cell reference: ${reference}`);
  return { row, col };
}

export function indexesToCellReference(row, col) {
  let name = "";
  let value = col + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return `${name}${row + 1}`;
}

function expandCells(cells, rows, cols) {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => String(cells?.[row]?.[col] ?? ""))
  );
}

function sanitizeWorkbookId(value) {
  return String(value || "default")
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96) || "default";
}

function normalizeIndex(value) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid zero-based cell index: ${value}`);
  return index;
}
