#!/usr/bin/env node
/**
 * Serveur de développement minimal (zéro dépendance).
 *
 *   node tools/dev-server.mjs [--port 5173] [--host 0.0.0.0]
 *
 * Sert le dossier du projet en HTTP avec les bons types MIME, sans cache pour
 * le HTML/CSS/JS (rechargement immédiat après modification) et un 404 explicite.
 * Suffisant pour développer et pour déployer sur n'importe quel hébergeur
 * statique — l'application n'a besoin d'aucun backend.
 */

import { createServer } from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function parseArgs(argv) {
  const args = { port: Number(process.env.PORT ?? 5173), host: process.env.HOST ?? "0.0.0.0" };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--port" || value === "-p") args.port = Number(argv[i + 1] ?? args.port);
    else if (value === "--host" || value === "-h") args.host = String(argv[i + 1] ?? args.host);
    else if (value.startsWith("--port=")) args.port = Number(value.slice(7));
    else if (value.startsWith("--host=")) args.host = value.slice(7);
  }
  if (!Number.isFinite(args.port) || args.port < 0 || args.port > 65535) args.port = 5173;
  return args;
}

/** Résout une URL en chemin fichier, en restant strictement dans ROOT. */
function resolveTarget(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const target = path.resolve(ROOT, relative);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

function notFound(res, urlPath) {
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  res.end(
    `<!DOCTYPE html><html lang="fr"><meta charset="utf-8">` +
      `<title>404 — CTR Studio AI</title>` +
      `<body style="font-family:system-ui;background:#07040d;color:#f5f0fc;padding:40px">` +
      `<h1>404</h1><p><code>${urlPath}</code> est introuvable.</p>` +
      `<p><a style="color:#c084fc" href="./index.html">Revenir à l'application</a></p></body></html>`,
  );
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const urlPath = req.url ?? "/";
  const target = resolveTarget(urlPath);

  if (!target) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 — chemin refusé.\n");
    return;
  }

  try {
    const stats = await fs.stat(target);
    let filePath = target;
    if (stats.isDirectory()) {
      filePath = path.join(target, "index.html");
      const inner = await fs.stat(filePath).catch(() => null);
      if (!inner?.isFile()) {
        notFound(res, urlPath);
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const isDev = ext === ".html" || ext === ".js" || ext === ".mjs" || ext === ".css" || ext === ".json";
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": stats.size,
      "Last-Modified": stats.mtime.toUTCString(),
      "Cache-Control": isDev ? "no-cache, must-revalidate" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Opener-Policy": "same-origin",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = createReadStream(filePath);
    stream.on("error", () => {
      res.destroy();
    });
    stream.pipe(res);
    stream.on("close", () => {
      const ms = Date.now() - started;
      console.log(`${req.method} ${urlPath} → 200 (${stats.size} o, ${ms} ms)`);
    });
  } catch (err) {
    if (err?.code === "ENOENT" || err?.code === "EISDIR") {
      notFound(res, urlPath);
      return;
    }
    console.error("[serveur]", err);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("500 — erreur serveur.\n");
  }
});

const { port, host } = parseArgs(process.argv.slice(2));

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[serveur] le port ${port} est déjà utilisé. Essayez : npm start -- --port 5199`);
    process.exit(1);
  }
  console.error("[serveur]", err);
  process.exit(1);
});

server.listen(port, host, () => {
  const shown = host === "0.0.0.0" ? "localhost" : host;
  console.log(`\n  CTR Studio AI — serveur de développement`);
  console.log(`  ▸ http://${shown}:${port}/   (${host}:${port})`);
  console.log(`  ▸ racine : ${ROOT}`);
  console.log(`  Ctrl+C pour arrêter.\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
