# Napkin

Napkin is a Codex plugin marketplace containing a local burn-rate calculator and editable spreadsheet.

It has two integration points:

- A browser UI served at `http://localhost:4173` with runway summary cards, a cash chart, and an editable sheet.
- An MCP server at `plugins/napkin/scripts/napkin-mcp.mjs` with tools for opening the UI and reading or writing the active thread workbook.

Workbooks are stored under `~/.codex/napkin/workbooks/`. By default Napkin keys them by the current Codex thread or session id, so each thread gets its own sheet while Codex and the browser still operate on the same file.

## Intended Behavior

- Use Napkin automatically when a Codex answer requires burn-rate modeling, runway forecasting, non-trivial calculations, or tabular numeric analysis.
- Treat the spreadsheet as the source of truth after the user edits cells.
- Re-read the workbook with `napkin_get_workbook` before answering after browser edits.
- Ask in chat before changing user-edited assumptions, formulas, or layout.
- Keep the app lightweight: one sheet, one browser tab, basic formulas.

## Installing From GitHub

Publish this repository with `.agents/plugins/marketplace.json` at the repo root and the plugin under `plugins/napkin/`. Users can add the GitHub repository as a Codex marketplace, then install the Napkin plugin from that marketplace.

The plugin does not require external services or package installation; it uses Node.js and local files only.

## Local Development

```bash
cd plugins/napkin
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

## Troubleshooting

If Codex says the Napkin skill is present but the MCP tools did not surface, first verify the server registration:

```bash
codex mcp get napkin
```

You should see `enabled: true` with a `cwd` inside the installed plugin cache. Then smoke-test the server:

```bash
cd ~/.codex/plugins/cache/napkin-marketplace/napkin/0.2.1
node -e 'const msg=JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list",params:{}}); process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`)' | node scripts/napkin-mcp.mjs
```

If that returns the `napkin_*` tools, the MCP server is healthy. Start a new Codex thread or restart the Codex app so the running conversation gets the newly installed MCP tools.

If the skill loads but the MCP tools are still not exposed in a running session, use the CLI fallback from the installed plugin root:

```bash
cd ~/.codex/plugins/cache/napkin-marketplace/napkin/0.2.1
node scripts/napkin-cli.mjs open '{"workbookId":"manual-test"}'
node scripts/napkin-cli.mjs replace '{"workbookId":"manual-test","title":"Manual Test","cells":[["Item","Amount"],["Base","10"],["Double","=B2*2"]]}'
node scripts/napkin-cli.mjs get '{"workbookId":"manual-test"}'
```

## Plugin Files

- `.codex-plugin/plugin.json`: Codex plugin manifest.
- `.mcp.json`: MCP server configuration.
- `skills/napkin-spreadsheet/SKILL.md`: guidance that tells Codex when to use Napkin.
