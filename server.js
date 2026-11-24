// ============================================================================
// MUMAX0 — Servidor Local (Node.js stdlib, zero dependências)
// Serve a interface web e executa mumax3.exe (-vet / simulação real) na GPU.
// ============================================================================

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFile } = require("child_process");

const HOST = "127.0.0.1";
const args = process.argv.slice(2);
const portFlagIdx = args.indexOf("--port");
const PORT = portFlagIdx >= 0 && args[portFlagIdx + 1] ? parseInt(args[portFlagIdx + 1], 10) : 8765;
const NO_OPEN = args.includes("--no-open");

const BASE_DIR = __dirname;
const SETTINGS_FILE = path.join(BASE_DIR, "mumax0_settings.json");
const DEFAULT_MUMAX_EXE = path.resolve(
  BASE_DIR,
  "..",
  "bin",
  process.platform === "win32" ? "mumax3.exe" : "mumax3"
);
const DEFAULT_WORK_DIR = path.resolve(BASE_DIR, "..", "simulacoes");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

// ---------- Settings ----------
function loadSettings() {
  const defaults = {
    mumaxPath: fs.existsSync(DEFAULT_MUMAX_EXE)
      ? DEFAULT_MUMAX_EXE
      : process.platform === "win32"
      ? "mumax3.exe"
      : "mumax3",
    workDir: DEFAULT_WORK_DIR,
    gpu: 0,
    forceOverwrite: true,
    httpUi: false
  };
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      return { ...defaults, ...parsed };
    }
  } catch (err) {
    console.warn("Aviso ao ler configurações:", err.message);
  }
  return defaults;
}

function saveSettings(cfg) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cfg, null, 2), "utf8");
  } catch (err) {
    console.warn("Aviso ao salvar configurações:", err.message);
  }
}

let settings = loadSettings();

// ---------- Active Job State ----------
let activeProc = null;
let job = {
  running: false,
  pid: null,
  status: "idle", // idle | running | done | error | cancelled
  filename: "",
  scriptPath: "",
  outDir: "",
  command: "",
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  log: ""
};

function appendLog(chunk) {
  job.log += chunk;
  const MAX_LEN = 350000;
  if (job.log.length > MAX_LEN) {
    job.log = "... [log truncado] ...\n" + job.log.slice(-MAX_LEN);
  }
}

function sanitizeFilename(raw) {
  const clean = String(raw || "simulacao.mx3").replace(/[^a-zA-Z0-9._-]/g, "_");
  return clean.toLowerCase().endsWith(".mx3") ? clean : `${clean}.mx3`;
}

function mumaxExecutableExists(p) {
  if (!p) return false;
  if (path.isAbsolute(p)) return fs.existsSync(p);
  return true; // Assume command on PATH if relative name like "mumax3"
}

// ---------- HTTP Helpers ----------
function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error("Payload muito grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(reqPath, res) {
  const rel = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
  const safePath = path.normalize(path.join(BASE_DIR, rel));
  if (!safePath.startsWith(BASE_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(safePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

// ---------- API Handlers ----------
async function handleApi(req, res, urlPath) {
  // GET /api/status
  if (req.method === "GET" && urlPath === "/api/status") {
    return sendJson(res, 200, {
      ok: true,
      mumaxPath: settings.mumaxPath,
      mumaxExists: mumaxExecutableExists(settings.mumaxPath),
      workDir: settings.workDir,
      gpu: settings.gpu,
      forceOverwrite: settings.forceOverwrite,
      httpUi: settings.httpUi,
      job
    });
  }

  // POST /api/config
  if (req.method === "POST" && urlPath === "/api/config") {
    const body = await readJsonBody(req);
    if (typeof body.mumaxPath === "string" && body.mumaxPath.trim()) {
      settings.mumaxPath = body.mumaxPath.trim();
    }
    if (typeof body.workDir === "string" && body.workDir.trim()) {
      settings.workDir = body.workDir.trim();
    }
    if (body.gpu !== undefined) {
      settings.gpu = Math.max(0, parseInt(body.gpu, 10) || 0);
    }
    if (body.forceOverwrite !== undefined) {
      settings.forceOverwrite = Boolean(body.forceOverwrite);
    }
    if (body.httpUi !== undefined) {
      settings.httpUi = Boolean(body.httpUi);
    }
    saveSettings(settings);
    return sendJson(res, 200, {
      ok: true,
      mumaxPath: settings.mumaxPath,
      mumaxExists: mumaxExecutableExists(settings.mumaxPath),
      workDir: settings.workDir,
      gpu: settings.gpu,
      forceOverwrite: settings.forceOverwrite,
      httpUi: settings.httpUi
    });
  }

  // POST /api/vet  (valida sintaxe com mumax3 -vet)
  if (req.method === "POST" && urlPath === "/api/vet") {
    const body = await readJsonBody(req);
    const filename = sanitizeFilename(body.filename);
    const code = String(body.code || "");

    if (!mumaxExecutableExists(settings.mumaxPath)) {
      return sendJson(res, 400, {
        ok: false,
        error: `Executável não encontrado: ${settings.mumaxPath}`
      });
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mumax0_vet_"));
    const tmpFile = path.join(tmpDir, filename);
    fs.writeFileSync(tmpFile, code, "utf8");

    execFile(settings.mumaxPath, ["-vet", tmpFile], { timeout: 25000, windowsHide: true }, (err, stdout, stderr) => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}

      const combined = `${stdout || ""}${stderr || ""}`.trim();
      if (err) {
        return sendJson(res, 200, {
          ok: false,
          exitCode: typeof err.code === "number" ? err.code : 1,
          output: combined || err.message
        });
      }
      return sendJson(res, 200, {
        ok: true,
        exitCode: 0,
        output: combined || "Sintaxe validada com sucesso (0 erros)."
      });
    });
    return;
  }

  // POST /api/run  (salva .mx3 e executa mumax3.exe)
  if (req.method === "POST" && urlPath === "/api/run") {
    if (job.running && activeProc) {
      return sendJson(res, 409, { ok: false, error: "Já existe uma simulação em execução." });
    }

    const body = await readJsonBody(req);
    const filename = sanitizeFilename(body.filename);
    const code = String(body.code || "");

    if (body.gpu !== undefined) settings.gpu = Math.max(0, parseInt(body.gpu, 10) || 0);
    if (body.forceOverwrite !== undefined) settings.forceOverwrite = Boolean(body.forceOverwrite);
    if (body.httpUi !== undefined) settings.httpUi = Boolean(body.httpUi);
    saveSettings(settings);

    if (!mumaxExecutableExists(settings.mumaxPath)) {
      return sendJson(res, 400, {
        ok: false,
        error: `Executável não encontrado: ${settings.mumaxPath}`
      });
    }

    fs.mkdirSync(settings.workDir, { recursive: true });
    const scriptPath = path.join(settings.workDir, filename);
    const outDir = path.join(settings.workDir, filename.replace(/\.mx3$/i, ".out"));
    fs.writeFileSync(scriptPath, code, "utf8");

    const cliArgs = [];
    if (settings.forceOverwrite) cliArgs.push("-f");
    cliArgs.push("-gpu", String(settings.gpu));
    if (!settings.httpUi) cliArgs.push("-http", "");
    cliArgs.push(scriptPath);

    job = {
      running: true,
      pid: null,
      status: "running",
      filename,
      scriptPath,
      outDir,
      command: `"${settings.mumaxPath}" ${cliArgs.join(" ")}`,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      log: `▶ Iniciando: ${filename}\n📁 Pasta: ${settings.workDir}\n💻 Comando: ${settings.mumaxPath} ${cliArgs.join(" ")}\n${"─".repeat(60)}\n`
    };

    try {
      const child = spawn(settings.mumaxPath, cliArgs, {
        cwd: settings.workDir,
        windowsHide: true
      });
      activeProc = child;
      job.pid = child.pid;

      child.stdout.on("data", (d) => appendLog(d.toString("utf8")));
      child.stderr.on("data", (d) => appendLog(d.toString("utf8")));

      child.on("error", (err) => {
        appendLog(`\n❌ Erro ao iniciar processo: ${err.message}\n`);
        job.running = false;
        job.status = "error";
        job.exitCode = -1;
        job.finishedAt = new Date().toISOString();
        activeProc = null;
      });

      child.on("close", (codeExit) => {
        job.running = false;
        job.exitCode = codeExit;
        job.finishedAt = new Date().toISOString();
        if (job.status !== "cancelled") {
          job.status = codeExit === 0 ? "done" : "error";
        }
        appendLog(`\n${"─".repeat(60)}\n${codeExit === 0 ? "✅ Simulação concluída com sucesso!" : `⚠️ Encerrado com código ${codeExit}.`}\n`);
        activeProc = null;
      });

      return sendJson(res, 200, { ok: true, job });
    } catch (err) {
      job.running = false;
      job.status = "error";
      job.finishedAt = new Date().toISOString();
      appendLog(`\n❌ Falha: ${err.message}\n`);
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/stop  (cancela execução atual)
  if (req.method === "POST" && urlPath === "/api/stop") {
    if (!job.running || !activeProc) {
      return sendJson(res, 200, { ok: true, message: "Nenhuma simulação rodando." });
    }
    job.status = "cancelled";
    appendLog("\n⏹ Cancelando simulação a pedido do usuário...\n");
    const pid = activeProc.pid;
    if (process.platform === "win32" && pid) {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    } else {
      activeProc.kill("SIGTERM");
    }
    return sendJson(res, 200, { ok: true, job });
  }

  // POST /api/open-folder  (abre pasta de resultados no Explorer / Finder / xdg-open)
  if (req.method === "POST" && urlPath === "/api/open-folder") {
    const body = await readJsonBody(req);
    const target = body.folderPath && fs.existsSync(body.folderPath) ? body.folderPath : settings.workDir;
    fs.mkdirSync(target, { recursive: true });
    if (process.platform === "win32") {
      spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
    }
    return sendJson(res, 200, { ok: true, opened: target });
  }

  // GET /api/outputs  (lista pastas .out encontradas em workDir e na pasta pai)
  if (req.method === "GET" && urlPath === "/api/outputs") {
    const searchRoots = [];
    const addRoot = (dir) => {
      if (!dir) return;
      const resolved = path.resolve(dir);
      if (fs.existsSync(resolved) && !searchRoots.includes(resolved)) {
        searchRoots.push(resolved);
      }
    };
    addRoot(settings.workDir);
    addRoot(path.resolve(BASE_DIR, ".."));
    if (job.outDir) addRoot(path.dirname(job.outDir));

    const outFolders = [];
    const seen = new Set();

    for (const root of searchRoots) {
      let entries = [];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch (_) {
        continue;
      }
      for (const ent of entries) {
        if (!ent.isDirectory() || !ent.name.toLowerCase().endsWith(".out")) continue;
        const full = path.join(root, ent.name);
        if (seen.has(full)) continue;
        seen.add(full);

        let files = [];
        try {
          files = fs.readdirSync(full);
        } catch (_) {
          continue;
        }
        const ovfFiles = files
          .filter((f) => f.toLowerCase().endsWith(".ovf"))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
        const hasTable = files.some((f) => f.toLowerCase() === "table.txt");
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch (_) {}

        outFolders.push({
          name: ent.name,
          path: full,
          ovfFiles,
          hasTable,
          mtimeMs
        });
      }
    }

    outFolders.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return sendJson(res, 200, { ok: true, folders: outFolders, lastOutDir: job.outDir || "" });
  }

  // GET /api/ovf?dir=...&file=...  (retorna bytes brutos do .ovf)
  if (req.method === "GET" && urlPath === "/api/ovf") {
    const u = new URL(req.url, `http://${HOST}:${PORT}`);
    const dir = u.searchParams.get("dir") || "";
    const file = path.basename(u.searchParams.get("file") || "");
    if (!dir || !file || !file.toLowerCase().endsWith(".ovf")) {
      return sendJson(res, 400, { ok: false, error: "Parâmetros dir/file inválidos" });
    }
    const target = path.resolve(dir, file);
    if (!fs.existsSync(target)) {
      return sendJson(res, 404, { ok: false, error: "Arquivo .ovf não encontrado" });
    }
    fs.readFile(target, (err, buf) => {
      if (err) return sendJson(res, 500, { ok: false, error: err.message });
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store"
      });
      res.end(buf);
    });
    return;
  }

  // GET /api/table?dir=...  (retorna conteúdo de table.txt)
  if (req.method === "GET" && urlPath === "/api/table") {
    const u = new URL(req.url, `http://${HOST}:${PORT}`);
    const dir = u.searchParams.get("dir") || "";
    const target = path.resolve(dir, "table.txt");
    if (!dir || !fs.existsSync(target)) {
      return sendJson(res, 404, { ok: false, error: "table.txt não encontrado" });
    }
    fs.readFile(target, "utf8", (err, txt) => {
      if (err) return sendJson(res, 500, { ok: false, error: err.message });
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(txt);
    });
    return;
  }

  return sendJson(res, 404, { ok: false, error: "Endpoint não encontrado" });
}

// ---------- Server Bootstrap ----------
const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  if (urlPath.startsWith("/api/")) {
    try {
      await handleApi(req, res, urlPath);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }
  serveStatic(reqPathFromUrl(urlPath), res);
});

function reqPathFromUrl(urlPath) {
  return urlPath || "/";
}

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log("==========================================================");
  console.log("  MUMAX0 — Servidor Local de Execução MuMax3");
  console.log(`  Interface Web : ${url}`);
  console.log(`  MuMax3        : ${settings.mumaxPath}`);
  console.log(`  Pasta Saída   : ${settings.workDir}`);
  console.log("  Pressione Ctrl+C para encerrar o servidor.");
  console.log("==========================================================");

  if (!NO_OPEN) {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  }
});
