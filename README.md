# Napkin

Napkin is a Codex plugin prototype for showing calculations in an editable spreadsheet.

It has two integration points:

- A browser UI served at `http://localhost:4173`.
- An MCP server at `scripts/napkin-mcp.mjs` with tools for opening the UI and reading or writing the active thread workbook.

Workbooks are stored under `~/.codex/napkin/workbooks/`. By default Napkin keys them by the current Codex thread or session id, so each thread gets its own sheet while Codex and the browser still operate on the same file.

## Intended Behavior

- Use Napkin automatically when a Codex answer requires non-trivial calculations or tabular numeric analysis.
- Treat the spreadsheet as the source of truth after the user edits cells.
- Re-read the workbook with `napkin_get_workbook` before answering after browser edits.
- Ask in chat before changing user-edited assumptions, formulas, or layout.
- Keep v0 lightweight: one sheet, one browser tab, basic formulas.

## Installing From GitHub

Publish this repository with `.codex-plugin/plugin.json`, `.mcp.json`, `skills/`, `scripts/`, and `public/` at the repo root. Users can then install it as a Codex plugin from the GitHub repository or from a marketplace entry that points at the repository.

The plugin does not require external services or package installation; it uses Node.js and local files only.

## Local Development

```bash
npm run dev
```

Then open `http://localhost:4173`.

## MCP Tools

- `napkin_open_sheet`: starts the spreadsheet UI and returns the thread-scoped local URL.
- `napkin_get_workbook`: reads the current thread workbook, including user browser edits.
- `napkin_set_cell`: sets one cell by A1 reference or zero-based row/column.
- `napkin_update_cells`: sets multiple cells.
- `napkin_replace_workbook`: replaces the whole workbook.
- `napkin_reset_workbook`: restores the sample workbook.

## Plugin Files

- `.codex-plugin/plugin.json`: Codex plugin manifest.
- `.mcp.json`: MCP server configuration.
- `skills/napkin-spreadsheet/SKILL.md`: guidance that tells Codex when to use Napkin.
