const sheet = document.querySelector("#sheet");
const titleInput = document.querySelector("#titleInput");
const statusEl = document.querySelector("#status");
const formulaInput = document.querySelector("#formulaInput");
const cellNameEl = document.querySelector("#cellName");
const addRowButton = document.querySelector("#addRowButton");
const addColumnButton = document.querySelector("#addColumnButton");
const refreshButton = document.querySelector("#refreshButton");
const scenarioSelect = document.querySelector("#scenarioSelect");
const currentCashEl = document.querySelector("#currentCash");
const averageBurnEl = document.querySelector("#averageBurn");
const runwayMonthsEl = document.querySelector("#runwayMonths");
const cashOutDateEl = document.querySelector("#cashOutDate");
const runwayChart = document.querySelector("#runwayChart");
const chartCaption = document.querySelector("#chartCaption");
const params = new URLSearchParams(window.location.search);
const workbookId = params.get("workbook") || "default";
const workbookApi = `/api/workbook?workbook=${encodeURIComponent(workbookId)}`;

let workbook = null;
let selected = { row: 0, col: 0 };
let saveTimer = null;
let lastSavedAt = "";
let isDirty = false;

function emptyGrid(rows, cols) {
  return Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: cols }, (_, colIndex) => workbook?.cells?.[rowIndex]?.[colIndex] ?? "")
  );
}

function normalizeWorkbook(nextWorkbook) {
  const rows = Math.max(1, Number(nextWorkbook.rows) || 24);
  const cols = Math.max(1, Number(nextWorkbook.cols) || 10);
  workbook = {
    version: 1,
    title: nextWorkbook.title || "Burn Rate Calculator",
    rows,
    cols,
    cells: [],
    updatedAt: nextWorkbook.updatedAt || ""
  };
  workbook.cells = emptyGrid(rows, cols);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      workbook.cells[row][col] = String(nextWorkbook.cells?.[row]?.[col] ?? "");
    }
  }
}

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`.trim();
}

function columnName(index) {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellLabel(row, col) {
  return `${columnName(col)}${row + 1}`;
}

function parseCellRef(reference) {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference.trim());
  if (!match) return null;
  const col = [...match[1].toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
  const row = Number(match[2]) - 1;
  if (row < 0 || col < 0 || row >= workbook.rows || col >= workbook.cols) return null;
  return { row, col };
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return "-";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1000000) return `${sign}$${(absolute / 1000000).toFixed(1)}M`;
  if (absolute >= 1000) return `${sign}$${Math.round(absolute / 1000)}k`;
  return `${sign}$${Math.round(absolute).toLocaleString()}`;
}

function formatMonthCount(value) {
  if (!Number.isFinite(value) || value < 0) return "-";
  return `${value.toFixed(value >= 10 ? 0 : 1)} mo`;
}

function rangeValues(range, stack) {
  const [startRef, endRef] = range.split(":");
  const start = parseCellRef(startRef);
  const end = parseCellRef(endRef);
  if (!start || !end) return [];
  const rowStart = Math.min(start.row, end.row);
  const rowEnd = Math.max(start.row, end.row);
  const colStart = Math.min(start.col, end.col);
  const colEnd = Math.max(start.col, end.col);
  const values = [];
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      values.push(asNumber(resolveCell(row, col, stack)));
    }
  }
  return values;
}

function resolveCell(row, col, stack = new Set()) {
  const key = `${row}:${col}`;
  if (stack.has(key)) throw new Error("Circular reference");
  const raw = workbook.cells[row]?.[col] ?? "";
  if (!String(raw).startsWith("=")) return raw;
  stack.add(key);
  const result = evaluateFormula(String(raw).slice(1), stack);
  stack.delete(key);
  return result;
}

function valuesFromArgument(argument, stack) {
  const trimmed = argument.trim();
  if (!trimmed) return [];
  if (/^[A-Z]+\d+:[A-Z]+\d+$/i.test(trimmed)) return rangeValues(trimmed, stack);
  if (/^[A-Z]+\d+$/i.test(trimmed)) {
    const ref = parseCellRef(trimmed);
    return ref ? [asNumber(resolveCell(ref.row, ref.col, stack))] : [0];
  }
  return [asNumber(evaluateArithmetic(replaceReferences(trimmed, stack)))];
}

function expandFunctions(expression, stack) {
  return expression.replace(/\b(SUM|AVG|MIN|MAX|COUNT)\(([^()]*)\)/gi, (_, fn, args) => {
    const values = args.split(",").flatMap((argument) => valuesFromArgument(argument, stack));
    if (fn.toUpperCase() === "COUNT") return String(values.filter((value) => Number.isFinite(value)).length);
    if (!values.length) return "0";
    if (fn.toUpperCase() === "SUM") return String(values.reduce((total, value) => total + value, 0));
    if (fn.toUpperCase() === "AVG") return String(values.reduce((total, value) => total + value, 0) / values.length);
    if (fn.toUpperCase() === "MIN") return String(Math.min(...values));
    if (fn.toUpperCase() === "MAX") return String(Math.max(...values));
    return "0";
  });
}

function replaceReferences(expression, stack) {
  return expression.replace(/\b[A-Z]+\d+\b/gi, (reference) => {
    const ref = parseCellRef(reference);
    return ref ? String(asNumber(resolveCell(ref.row, ref.col, stack))) : "0";
  });
}

function evaluateArithmetic(expression) {
  if (!/^[-+*/().,\d\s]+$/.test(expression)) throw new Error("Unsupported formula");
  const value = Function(`"use strict"; return (${expression});`)();
  if (!Number.isFinite(value)) throw new Error("Invalid result");
  return value;
}

function evaluateFormula(expression, stack = new Set()) {
  const expanded = expandFunctions(expression, stack);
  const arithmetic = replaceReferences(expanded, stack);
  return evaluateArithmetic(arithmetic);
}

function displayValue(row, col) {
  const raw = workbook.cells[row]?.[col] ?? "";
  if (!String(raw).startsWith("=")) return { value: raw, error: false, calculated: false };
  try {
    const result = resolveCell(row, col);
    const value = Number.isInteger(result) ? String(result) : Number(result).toLocaleString(undefined, { maximumFractionDigits: 6 });
    return { value, error: false, calculated: true };
  } catch (error) {
    return { value: `# ${error.message}`, error: true, calculated: true };
  }
}

function selectCell(row, col) {
  selected = { row, col };
  cellNameEl.textContent = cellLabel(row, col);
  formulaInput.value = workbook.cells[row]?.[col] ?? "";
  sheet.querySelectorAll("td.selected").forEach((cell) => cell.classList.remove("selected"));
  sheet.querySelector(`[data-row="${row}"][data-col="${col}"]`)?.classList.add("selected");
}

function commitCell(row, col, value) {
  workbook.cells[row][col] = value;
  isDirty = true;
  render();
  selectCell(row, col);
  queueSave();
}

function render() {
  titleInput.value = workbook.title;
  syncScenarioControl();
  const headCells = Array.from({ length: workbook.cols }, (_, col) => `<th class="col-head">${columnName(col)}</th>`).join("");
  const bodyRows = Array.from({ length: workbook.rows }, (_, row) => {
    const cells = Array.from({ length: workbook.cols }, (_, col) => {
      const display = displayValue(row, col);
      const raw = workbook.cells[row]?.[col] ?? "";
      const classes = [
        row === selected.row && col === selected.col ? "selected" : "",
        display.error ? "error-cell" : ""
      ].filter(Boolean).join(" ");
      const inputClass = display.calculated ? "cell-input calculated" : "cell-input";
      return `<td class="${classes}" data-row="${row}" data-col="${col}">
        <input class="${inputClass}" data-row="${row}" data-col="${col}" value="${escapeHtml(display.value)}" data-raw="${escapeHtml(raw)}">
      </td>`;
    }).join("");
    return `<tr><th class="row-head">${row + 1}</th>${cells}</tr>`;
  }).join("");
  sheet.innerHTML = `<thead><tr><th class="corner"></th>${headCells}</tr></thead><tbody>${bodyRows}</tbody>`;
  renderInsights();
}

function syncScenarioControl() {
  const scenarioRow = findRow("Scenario");
  const scenario = scenarioRow >= 0 ? workbook.cells[scenarioRow]?.[1] : "";
  if (scenario && [...scenarioSelect.options].some((option) => option.value === scenario)) {
    scenarioSelect.value = scenario;
  }
}

function findRow(label) {
  const normalized = label.toLowerCase();
  return workbook.cells.findIndex((row) => String(row?.[0] || "").trim().toLowerCase() === normalized);
}

function getResolvedNumber(row, col) {
  if (row < 0 || col < 0 || row >= workbook.rows || col >= workbook.cols) return 0;
  try {
    return asNumber(resolveCell(row, col));
  } catch {
    return 0;
  }
}

function getBurnModel() {
  const monthLabels = workbook.cells[0]?.slice(1).map((month) => String(month || "").trim()) || [];
  const months = monthLabels.map((label, index) => ({ label, col: index + 1 })).filter((month) => month.label);
  const startingRow = findRow("Starting cash");
  const cashInRow = findRow("Cash in");
  const cashOutRow = findRow("Total cash out");
  const netBurnRow = findRow("Net burn");
  const endingCashRow = findRow("Ending cash");
  const targetRow = findRow("Target minimum cash");
  const targetCash = getResolvedNumber(targetRow, 1);

  const values = months.map((month) => ({
    ...month,
    startingCash: getResolvedNumber(startingRow, month.col),
    cashIn: getResolvedNumber(cashInRow, month.col),
    cashOut: getResolvedNumber(cashOutRow, month.col),
    netBurn: getResolvedNumber(netBurnRow, month.col),
    endingCash: getResolvedNumber(endingCashRow, month.col)
  }));

  return { months: values, targetCash };
}

function renderInsights() {
  if (!workbook) return;
  const { months, targetCash } = getBurnModel();
  if (!months.length) {
    currentCashEl.textContent = "-";
    averageBurnEl.textContent = "-";
    runwayMonthsEl.textContent = "-";
    cashOutDateEl.textContent = "-";
    runwayChart.innerHTML = "";
    return;
  }

  const firstMonth = months[0];
  const positiveBurn = months.map((month) => month.netBurn).filter((value) => value > 0);
  const averageBurn = positiveBurn.length ? positiveBurn.reduce((total, value) => total + value, 0) / positiveBurn.length : 0;
  const runway = averageBurn > 0 ? firstMonth.startingCash / averageBurn : Number.POSITIVE_INFINITY;
  const belowTarget = months.find((month) => month.endingCash <= targetCash);
  const finalCash = months[months.length - 1].endingCash;

  currentCashEl.textContent = formatCurrency(firstMonth.startingCash);
  averageBurnEl.textContent = averageBurn > 0 ? formatCurrency(averageBurn) : "$0";
  runwayMonthsEl.textContent = Number.isFinite(runway) ? formatMonthCount(runway) : "Infinite";
  cashOutDateEl.textContent = belowTarget ? belowTarget.label : "Beyond plan";
  chartCaption.textContent = `${months.length}-month forecast. Ending cash: ${formatCurrency(finalCash)}. Target floor: ${formatCurrency(targetCash)}.`;
  runwayChart.innerHTML = buildRunwayChart(months, targetCash);
}

function buildRunwayChart(months, targetCash) {
  const width = 960;
  const height = 260;
  const padding = { top: 18, right: 24, bottom: 42, left: 58 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = months.map((month) => month.endingCash);
  const minValue = Math.min(0, targetCash, ...values);
  const maxValue = Math.max(targetCash, ...values);
  const spread = maxValue - minValue || 1;
  const xFor = (index) => padding.left + (months.length === 1 ? chartWidth / 2 : (index / (months.length - 1)) * chartWidth);
  const yFor = (value) => padding.top + (1 - (value - minValue) / spread) * chartHeight;
  const path = months.map((month, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(1)} ${yFor(month.endingCash).toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${xFor(months.length - 1).toFixed(1)} ${height - padding.bottom} L ${xFor(0).toFixed(1)} ${height - padding.bottom} Z`;
  const targetY = yFor(targetCash);
  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const y = padding.top + (index / 4) * chartHeight;
    const value = maxValue - (index / 4) * spread;
    return `<line x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" class="grid-line"></line>
      <text x="${padding.left - 10}" y="${(y + 4).toFixed(1)}" class="axis-label" text-anchor="end">${formatCurrency(value)}</text>`;
  }).join("");
  const monthTicks = months.map((month, index) => {
    if (index !== 0 && index !== months.length - 1 && index % Math.ceil(months.length / 5) !== 0) return "";
    return `<text x="${xFor(index).toFixed(1)}" y="${height - 14}" class="axis-label" text-anchor="middle">${escapeHtml(month.label)}</text>`;
  }).join("");
  const points = months.map((month, index) =>
    `<circle cx="${xFor(index).toFixed(1)}" cy="${yFor(month.endingCash).toFixed(1)}" r="3.5" class="cash-point">
      <title>${escapeHtml(month.label)}: ${formatCurrency(month.endingCash)}</title>
    </circle>`
  ).join("");

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Ending cash runway forecast">
    <style>
      .grid-line { stroke: #d8dee4; stroke-dasharray: 3 5; }
      .axis-label { fill: #65727e; font: 12px system-ui, sans-serif; }
      .target-line { stroke: #7a8793; stroke-width: 2; stroke-dasharray: 7 6; }
      .cash-area { fill: rgba(29, 127, 194, 0.12); }
      .cash-line { fill: none; stroke: #1d7fc2; stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
      .cash-point { fill: #ffffff; stroke: #1d7fc2; stroke-width: 2; }
    </style>
    ${gridLines}
    <path d="${areaPath}" class="cash-area"></path>
    <line x1="${padding.left}" y1="${targetY.toFixed(1)}" x2="${width - padding.right}" y2="${targetY.toFixed(1)}" class="target-line"></line>
    <path d="${path}" class="cash-line"></path>
    ${points}
    ${monthTicks}
  </svg>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function loadWorkbook({ quiet = false } = {}) {
  const response = await fetch(workbookApi);
  if (!response.ok) throw new Error("Could not load workbook");
  const nextWorkbook = await response.json();
  normalizeWorkbook(nextWorkbook);
  lastSavedAt = workbook.updatedAt;
  isDirty = false;
  render();
  selectCell(Math.min(selected.row, workbook.rows - 1), Math.min(selected.col, workbook.cols - 1));
  if (!quiet) setStatus(`Loaded ${new Date().toLocaleTimeString()}`);
}

async function saveWorkbook() {
  if (!workbook || !isDirty) return;
  workbook.title = titleInput.value.trim() || "Codex Calculation Sheet";
  setStatus("Saving");
  const response = await fetch(workbookApi, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workbook)
  });
  if (!response.ok) throw new Error("Could not save workbook");
  const saved = await response.json();
  lastSavedAt = saved.updatedAt;
  workbook.updatedAt = saved.updatedAt;
  isDirty = false;
  setStatus(`Saved ${new Date().toLocaleTimeString()}`);
}

function queueSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveWorkbook().catch((error) => setStatus(error.message, "error"));
  }, 300);
}

sheet.addEventListener("focusin", (event) => {
  const input = event.target.closest(".cell-input");
  if (!input) return;
  const row = Number(input.dataset.row);
  const col = Number(input.dataset.col);
  selectCell(row, col);
  input.value = workbook.cells[row][col];
});

sheet.addEventListener("change", (event) => {
  const input = event.target.closest(".cell-input");
  if (!input) return;
  commitCell(Number(input.dataset.row), Number(input.dataset.col), input.value);
});

sheet.addEventListener("keydown", (event) => {
  const input = event.target.closest(".cell-input");
  if (!input || event.key !== "Enter") return;
  event.preventDefault();
  input.blur();
  const row = Math.min(workbook.rows - 1, Number(input.dataset.row) + 1);
  const col = Number(input.dataset.col);
  sheet.querySelector(`input[data-row="${row}"][data-col="${col}"]`)?.focus();
});

formulaInput.addEventListener("change", () => {
  commitCell(selected.row, selected.col, formulaInput.value);
});

titleInput.addEventListener("input", () => {
  workbook.title = titleInput.value;
  isDirty = true;
  queueSave();
});

scenarioSelect.addEventListener("change", () => {
  const scenarioRow = findRow("Scenario");
  if (scenarioRow >= 0 && workbook.cols > 1) {
    commitCell(scenarioRow, 1, scenarioSelect.value);
  }
});

addRowButton.addEventListener("click", () => {
  workbook.rows += 1;
  workbook.cells.push(Array.from({ length: workbook.cols }, () => ""));
  isDirty = true;
  render();
  selectCell(workbook.rows - 1, 0);
  queueSave();
});

addColumnButton.addEventListener("click", () => {
  workbook.cols += 1;
  workbook.cells.forEach((row) => row.push(""));
  isDirty = true;
  render();
  selectCell(0, workbook.cols - 1);
  queueSave();
});

refreshButton.addEventListener("click", () => {
  loadWorkbook().catch((error) => setStatus(error.message, "error"));
});

window.setInterval(async () => {
  if (isDirty) return;
  try {
    const response = await fetch(workbookApi);
    const nextWorkbook = await response.json();
    if (nextWorkbook.updatedAt && nextWorkbook.updatedAt !== lastSavedAt) {
      normalizeWorkbook(nextWorkbook);
      lastSavedAt = workbook.updatedAt;
      render();
      selectCell(Math.min(selected.row, workbook.rows - 1), Math.min(selected.col, workbook.cols - 1));
      setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    }
  } catch (error) {
    setStatus(error.message, "error");
  }
}, 2000);

loadWorkbook().catch((error) => setStatus(error.message, "error"));
