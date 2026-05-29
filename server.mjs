import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWorkbook, getDefaultWorkbookId, readWorkbook, workbookPathFor, writeWorkbook } from "./scripts/workbook-store.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) return {};
  return JSON.parse(body);
}

function send(response, status, body, type = "application/json; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicDir, requestedPath));
  if (!filePath.startsWith(publicDir)) {
    send(response, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }

  try {
    const file = await readFile(filePath);
    send(response, 200, file, contentTypes[extname(filePath)] || "application/octet-stream");
  } catch {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
  }
}

async function handleApi(request, response, pathname) {
  if (pathname !== "/api/workbook") {
    send(response, 404, JSON.stringify({ error: "Unknown API route" }));
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const workbookId = url.searchParams.get("workbook") || getDefaultWorkbookId();

  if (request.method === "GET") {
    const workbook = await readWorkbook(workbookId);
    send(response, 200, JSON.stringify({ ...workbook, workbookPath: workbookPathFor(workbookId) }));
    return;
  }

  if (request.method === "PUT") {
    const workbook = await readJsonBody(request);
    const normalized = await writeWorkbook(workbook, workbookId);
    send(response, 200, JSON.stringify(normalized));
    return;
  }

  send(response, 405, JSON.stringify({ error: "Method not allowed" }));
}

await ensureWorkbook();

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    send(response, 500, JSON.stringify({ error: error.message }));
  }
}).listen(port, () => {
  console.log(`Napkin running at http://localhost:${port}`);
});
