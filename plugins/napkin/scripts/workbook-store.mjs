import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));
export const dataDir = process.env.NAPKIN_DATA_DIR || join(homedir(), ".codex", "napkin");
export const napkinVersion = "0.2.2";

export const defaultWorkbook = {
  version: 1,
  title: "Burn Rate Calculator",
  rows: 14,
  cols: 14,
  cells: [
    ["Metric", "Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026", "Nov 2026", "Dec 2026", "Jan 2027"],
    ["Starting cash", "900000", "=B10", "=C10", "=D10", "=E10", "=F10", "=G10", "=H10", "=I10", "=J10", "=K10", "=L10", "=M10"],
    ["Cash in", "28000", "32000", "35000", "38000", "41000", "45000", "47000", "52000", "56000", "61000", "66000", "72000", "78000"],
    ["Payroll", "82000", "85000", "88000", "91000", "94000", "97000", "100000", "103000", "106000", "109000", "112000", "116000", "120000"],
    ["Tools and infra", "14000", "14500", "15000", "15500", "16000", "16500", "17000", "17500", "18000", "18500", "19000", "19500", "20000"],
    ["Marketing", "18000", "20000", "22000", "24000", "26000", "28000", "30000", "32000", "34000", "36000", "38000", "40000", "42000"],
    ["Other OpEx", "12000", "12500", "13000", "13500", "14000", "14500", "15000", "15500", "16000", "16500", "17000", "17500", "18000"],
    ["Total cash out", "=SUM(B4:B7)", "=SUM(C4:C7)", "=SUM(D4:D7)", "=SUM(E4:E7)", "=SUM(F4:F7)", "=SUM(G4:G7)", "=SUM(H4:H7)", "=SUM(I4:I7)", "=SUM(J4:J7)", "=SUM(K4:K7)", "=SUM(L4:L7)", "=SUM(M4:M7)", "=SUM(N4:N7)"],
    ["Net burn", "=B8-B3", "=C8-C3", "=D8-D3", "=E8-E3", "=F8-F3", "=G8-G3", "=H8-H3", "=I8-I3", "=J8-J3", "=K8-K3", "=L8-L3", "=M8-M3", "=N8-N3"],
    ["Ending cash", "=B2+B3-B8", "=C2+C3-C8", "=D2+D3-D8", "=E2+E3-E8", "=F2+F3-F8", "=G2+G3-G8", "=H2+H3-H8", "=I2+I3-I8", "=J2+J3-J8", "=K2+K3-K8", "=L2+L3-L8", "=M2+M3-M8", "=N2+N3-N8"],
    ["Headcount", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20"],
    ["Notes", "Base plan", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["Scenario", "Base", "", "", "", "", "", "", "", "", "", "", "", ""],
    ["Target minimum cash", "75000", "", "", "", "", "", "", "", "", "", "", "", ""]
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
