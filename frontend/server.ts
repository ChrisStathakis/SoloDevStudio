import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || process.env.FRONTEND_PORT || 3000);
// Also support --port CLI arg (used by some launchers)
const portArg = process.argv.find((a, i) => a === "--port" && process.argv[i + 1]);
const CLI_PORT = portArg ? Number(process.argv[process.argv.indexOf("--port") + 1]) : NaN;
const EFFECTIVE_PORT = Number.isFinite(CLI_PORT) ? CLI_PORT : PORT;

app.use(express.json());

// Django backend origin for /api proxy (same-origin bypass, no CORS needed).
// VITE_API_URL may be "http://localhost:8001/api" or "/api".
function getDjangoOrigin(): string {
  const raw = process.env.VITE_API_URL || process.env.BACKEND_URL || "http://localhost:8001";
  try {
    if (raw.startsWith("/")) return "http://localhost:8001";
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://localhost:8001";
  }
}
const DJANGO_ORIGIN = getDjangoOrigin();

// Quiet favicon 404 log spam and serve 204 if file missing
app.get("/favicon.ico", (_req, res) => {
  const icoPath = path.join(process.cwd(), "public", "favicon.ico");
  const distIco = path.join(process.cwd(), "dist", "favicon.ico");
  const svgPath = path.join(process.cwd(), "public", "favicon.svg");
  // express.static / vite middlewares will serve it if exists; this is fallback
  res.sendFile(icoPath, (err) => {
    if (err) res.sendFile(distIco, (e2) => {
      if (e2) res.sendFile(svgPath, (e3) => {
        if (e3) res.status(204).end();
      });
    });
  });
});

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
  });
});

// Proxy all /api/* to Django (same-origin for browser, no CORS preflight).
// The local /api/health handler above runs first and is never proxied.
app.use("/api", async (req, res, next) => {
  // Let local handlers serve their exact paths.
  if (req.method === "GET" && req.path === "/health") return next();
  try {
    const target = DJANGO_ORIGIN + req.originalUrl;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      const key = k.toLowerCase();
      if (key === "host" || key === "connection" || key === "content-length") continue;
      headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
    }
    const init: RequestInit = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined) {
      if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
        (init as any).body = req.body;
      } else if (Object.keys(req.body).length > 0) {
        if (!headers["content-type"] && !(headers as any)["Content-Type"]) {
          headers["content-type"] = "application/json";
        }
        (init as any).body = JSON.stringify(req.body);
      }
    }
    const upstream = await fetch(target, init);
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) return;
      res.setHeader(key, value);
    });
    if (upstream.body) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } else {
      res.end();
    }
  } catch (err: any) {
    console.error(`[api-proxy] ${req.method} ${req.originalUrl} -> ${DJANGO_ORIGIN} failed:`, err?.message || err);
    res.status(502).json({ detail: `Backend unreachable at ${DJANGO_ORIGIN}. Is Django running on 8001?` });
  }
});

// Vite middleware & Static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(EFFECTIVE_PORT, "0.0.0.0", () => {
    console.log(`SoloDev Studio server running on http://0.0.0.0:${EFFECTIVE_PORT}`);
  });
}

startServer();
