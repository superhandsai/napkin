---
name: napkin-spreadsheet
description: Automatically use when the user asks for burn rate, runway, cash forecast, startup finance, budgets, estimates, forecasts, or numeric analysis that should be visible in an editable spreadsheet inside the Codex in-app browser.
---

# Napkin Spreadsheet

Use Napkin when a user asks Codex to do calculations and would benefit from seeing or editing the numbers in a spreadsheet instead of receiving only prose. It is optimized for burn-rate and runway modeling: monthly starting cash, cash in, cash out, net burn, ending cash, runway, and target cash floor.

Prefer using it automatically for startup finance, burn rate, runway, cash forecasts, budgets, estimates, comparisons, or table-shaped numeric work.

## Workflow

1. If `napkin_open_sheet`, `napkin_replace_workbook`, and `napkin_get_workbook` are visible as callable tools, use them.
2. If those tools are not already visible in the current tool list, immediately use the CLI fallback below. Do not search for hidden Napkin hooks, do not inspect plugin internals, and do not tell the user the tools are missing unless asked to debug the plugin.
3. Open the returned URL in the Codex in-app browser.
4. Put the calculation into the current thread workbook with the MCP tools or CLI commands. For burn-rate work, use rows named `Starting cash`, `Cash in`, expense categories, `Total cash out`, `Net burn`, `Ending cash`, `Scenario`, and `Target minimum cash` so the dashboard can compute summary metrics.
5. Use formulas beginning with `=` for calculated cells. Supported browser formulas include arithmetic, cell references, ranges, and `SUM`, `AVG`, `MIN`, `MAX`, and `COUNT`.
6. After the user edits the sheet, read the workbook before answering. Treat the workbook as the source of truth.
7. Ask in chat before changing user-edited assumptions, formulas, or layout. Make changes only after the user confirms.

## Fallback When MCP Tools Are Not Exposed

If the Napkin skill is loaded but the `napkin_*` MCP tools are not available in the current host session, use the local CLI from the plugin root instead of stopping. This is a normal supported path.

The plugin root is the ancestor directory containing `.codex-plugin/plugin.json`. From that directory:

```bash
node scripts/napkin-cli.mjs open '{"workbookId":"current-thread"}'
node scripts/napkin-cli.mjs replace '{"workbookId":"current-thread","title":"Quote","cells":[["Item","Amount"],["Total","100"]]}'
node scripts/napkin-cli.mjs get '{"workbookId":"current-thread"}'
```

Use a stable workbook id for the current thread. If the host exposes a thread/session id in the environment, use that; otherwise derive a short id from the task. Open the returned URL in the Codex in-app browser.

## Workbook Shape

Each Codex thread/session gets a separate workbook. Workbooks are stored under `~/.codex/napkin/workbooks/` and have this shape:

```json
{
  "version": 1,
  "workbookId": "thread-id",
  "title": "Burn Rate Calculator",
  "rows": 24,
  "cols": 10,
  "cells": [["Metric", "Jan 2026", "Feb 2026"]]
}
```

Cells are raw strings. Formula cells should store the formula text, for example `=B2-B3`, not the displayed result.

## Good Use

- Build a sheet for multi-step arithmetic, financial estimates, metrics, budgets, timelines, or comparisons.
- Keep source assumptions visible in cells rather than burying them in prose.
- Re-read the workbook before responding after the user edits cells in the browser.
- Keep the first version to one simple sheet in one browser tab.
