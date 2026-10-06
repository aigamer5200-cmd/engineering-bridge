import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";


const listenHost = process.env.DEVSPACE_GUARD_PROXY_HOST ?? "127.0.0.1";
const listenPort = Number(process.env.DEVSPACE_GUARD_PROXY_PORT ?? "7677");
const upstreamHost = process.env.DEVSPACE_GUARD_UPSTREAM_HOST ?? "127.0.0.1";
const upstreamPort = Number(process.env.DEVSPACE_GUARD_UPSTREAM_PORT ?? "7679");
const guardPython = process.env.DEVSPACE_GUARD_PYTHON;
const guardScript = process.env.DEVSPACE_GUARD_SCRIPT;
const guardRuntimeRoot = process.env.DEVSPACE_GUARD_RUNTIME_ROOT;
const workspaceDbPath = process.env.DEVSPACE_GUARD_WORKSPACE_DB;
const workspaceMapPath = process.env.DEVSPACE_GUARD_WORKSPACE_MAP ??
  path.join(
    guardRuntimeRoot ?? "D:\\ShoestringGoalData\\development-execution-guard",
    "devspace-workspaces.json"
  );
const guardLeaseSeconds = Number(process.env.DEVSPACE_GUARD_LEASE_SECONDS ?? "180");
const maxRequestBytes = Number(process.env.DEVSPACE_GUARD_MAX_REQUEST_BYTES ?? String(64 * 1024 * 1024));

if (!guardPython || !guardScript) {
  throw new Error("DEVSPACE_GUARD_PYTHON and DEVSPACE_GUARD_SCRIPT are required.");
}
if (!Number.isInteger(listenPort) || !Number.isInteger(upstreamPort)) {
  throw new Error("Invalid proxy/upstream port.");
}
if (!Number.isInteger(guardLeaseSeconds) || guardLeaseSeconds < 30 || guardLeaseSeconds > 3600) {
  throw new Error("DEVSPACE_GUARD_LEASE_SECONDS must be between 30 and 3600.");
}

const workspaceRoots = loadWorkspaceMap();
if (workspaceDbPath && existsSync(workspaceDbPath)) {
  persistWorkspaceMap();
}

function loadWorkspaceMap() {
  const result = new Map();
  if (existsSync(workspaceMapPath)) {
    try {
      const parsed = JSON.parse(readFileSync(workspaceMapPath, "utf8"));
      if (parsed && parsed.schema_version === 1 && typeof parsed.workspaces === "object" && !Array.isArray(parsed.workspaces)) {
        for (const [workspaceId, worktree] of Object.entries(parsed.workspaces)) {
          if (typeof workspaceId !== "string" || !workspaceId || typeof worktree !== "string" || !worktree) continue;
          result.set(workspaceId, path.resolve(worktree));
        }
      }
    } catch {
      // The SQLite bootstrap below may still recover the map.
    }
  }
  if (workspaceDbPath && existsSync(workspaceDbPath)) {
    const script = [
      "import json, sqlite3, sys",
      "db = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)",
      "rows = db.execute(\"select id, root from workspace_sessions where id is not null and root is not null and root <> ''\").fetchall()",
      "db.close()",
      "print(json.dumps({str(i): str(root) for i, root in rows}, ensure_ascii=False))",
    ].join("; ");
    const completed = spawnSync(guardPython, ["-c", script, workspaceDbPath], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15_000,
    });
    if (completed.status === 0) {
      try {
        const parsed = JSON.parse(completed.stdout ?? "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [workspaceId, worktree] of Object.entries(parsed)) {
            if (typeof workspaceId !== "string" || !workspaceId || typeof worktree !== "string" || !worktree) continue;
            result.set(workspaceId, path.resolve(worktree));
          }
        }
      } catch {
        // Retain any durable JSON mappings even when DB bootstrap output is malformed.
      }
    }
  }
  return result;
}

function persistWorkspaceMap() {
  mkdirSync(path.dirname(workspaceMapPath), { recursive: true });
  const temp = `${workspaceMapPath}.tmp.${process.pid}`;
  const workspaces = Object.fromEntries([...workspaceRoots.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    temp,
    JSON.stringify({ schema_version: 1, workspaces }, null, 2) + "\n",
    { encoding: "utf8", flag: "w" }
  );
  renameSync(temp, workspaceMapPath);
}

function collectToolCalls(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectToolCalls(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (value.method === "tools/call" && value.params && typeof value.params === "object") {
    const name = value.params.name;
    const args = value.params.arguments;
    if (typeof name === "string" && args && typeof args === "object" && !Array.isArray(args)) {
      output.push({ name, args, requestId: value.id });
    }
  }
  return output;
}

function workspaceFromCall(call) {
  if (call.name === "open_workspace" && typeof call.args.path === "string" && call.args.path.trim()) {
    return path.resolve(call.args.path);
  }
  const workspaceId =
    typeof call.args.workspaceId === "string"
      ? call.args.workspaceId
      : typeof call.args.workspace_id === "string"
        ? call.args.workspace_id
        : undefined;
  if (workspaceId && workspaceRoots.has(workspaceId)) {
    return workspaceRoots.get(workspaceId);
  }
  if (workspaceId) {
    if (!/^ws_[A-Za-z0-9_-]{1,120}$/.test(workspaceId)) {
      throw new Error("DEVSPACE_GUARD_INVALID_WORKSPACE_ID");
    }
    const unresolved = path.join(
      process.env.DEVSPACE_GUARD_UNRESOLVED_ROOT ?? "D:\\ShoestringGoalData\\development-execution-guard\\unresolved-workspaces",
      workspaceId
    );
    mkdirSync(unresolved, { recursive: true });
    return unresolved;
  }
  return process.env.DEVSPACE_GUARD_FALLBACK_WORKTREE ?? "D:\\Engineering_Bridge_System\\DevSpace";
}

function projectFromWorkspace(worktree) {
  const parsed = path.parse(worktree);
  return parsed.base || "DevSpace";
}

function heartbeat(call) {
  try {
    const worktree = workspaceFromCall(call);
    const args = [
      guardScript,
      ...(guardRuntimeRoot ? ["--runtime-root", guardRuntimeRoot] : []),
      "heartbeat",
      "--worktree",
      worktree,
      "--project",
      projectFromWorkspace(worktree),
      "--source",
      "ds",
      "--activity",
      call.name,
      "--lease-seconds",
      String(guardLeaseSeconds),
    ];
    const workspaceId =
      typeof call.args.workspaceId === "string"
        ? call.args.workspaceId
        : typeof call.args.workspace_id === "string"
          ? call.args.workspace_id
          : undefined;
    if (workspaceId) args.push("--task-id", workspaceId);
    const completed = spawnSync(guardPython, args, {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15_000,
    });
    if (completed.error) {
      return {
        ok: false,
        status: completed.status,
        stdout: completed.stdout ?? "",
        stderr: completed.error.message,
      };
    }
    return {
      ok: completed.status === 0,
      status: completed.status,
      stdout: completed.stdout ?? "",
      stderr: completed.stderr ?? "",
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

function learnWorkspaceMapping(call, responseBytes) {
  if (call.name !== "open_workspace" || typeof call.args.path !== "string") return;
  const workspaceId = extractWorkspaceId(responseBytes.toString("utf8"));
  if (!workspaceId) return;
  const worktree = path.resolve(call.args.path);
  if (workspaceRoots.get(workspaceId) === worktree) return;
  workspaceRoots.set(workspaceId, worktree);
  persistWorkspaceMap();
}

function extractWorkspaceId(text) {
  const visit = (value) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return undefined;
      try {
        return visit(JSON.parse(trimmed));
      } catch {
        return undefined;
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    if (typeof value.workspaceId === "string" && value.workspaceId) {
      return value.workspaceId;
    }
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  };
  const candidates = [text.trim()];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data:")) {
      const payload = trimmed.slice(5).trim();
      if (payload && payload !== "[DONE]") candidates.push(payload);
    } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      candidates.push(trimmed);
    }
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const found = visit(JSON.parse(candidate));
      if (found) return found;
    } catch {
      // Continue with the remaining Streamable HTTP/SSE candidates.
    }
  }
  const direct = text.match(/"workspaceId"\s*:\s*"([^"]+)"/);
  if (direct?.[1]) return direct[1];
  const escaped = text.match(/\\?"workspaceId\\?"\s*:\s*\\?"([^"\\]+)\\?"/);
  return escaped?.[1];
}

function writeGuardFailure(res, detail) {
  const body = JSON.stringify({
    error: "DEVELOPMENT_EXECUTION_GUARD_HEARTBEAT_FAILED",
    detail,
  });
  res.writeHead(503, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    connection: "close",
  });
  res.end(body);
}

function proxyRequest(req, res, requestBody, calls) {
  const headers = { ...req.headers, host: `${upstreamHost}:${upstreamPort}` };
  headers["content-length"] = String(requestBody.length);
  const upstream = http.request(
    {
      hostname: upstreamHost,
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      const capture = calls.some((call) => call.name === "open_workspace") ? [] : null;
      upstreamRes.on("data", (chunk) => {
        if (capture) capture.push(Buffer.from(chunk));
        res.write(chunk);
      });
      upstreamRes.on("end", () => {
        if (capture) {
          const response = Buffer.concat(capture);
          for (const call of calls) learnWorkspaceMapping(call, response);
        }
        res.end();
      });
    }
  );
  upstream.on("error", (error) => {
    if (!res.headersSent) {
      const body = JSON.stringify({ error: "DEVSPACE_GUARD_UPSTREAM_UNAVAILABLE" });
      res.writeHead(502, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
    } else {
      res.destroy(error);
    }
  });
  upstream.end(requestBody);
}

// BEGIN DEVSPACE STREAM RESILIENCE PATCH v2
const DEVSPACE_STREAM_YIELD_CAP_MS = Number(
  process.env.DEVSPACE_STREAM_YIELD_CAP_MS ?? "8000"
);
if (
  !Number.isInteger(DEVSPACE_STREAM_YIELD_CAP_MS) ||
  DEVSPACE_STREAM_YIELD_CAP_MS < 1000 ||
  DEVSPACE_STREAM_YIELD_CAP_MS > 10000
) {
  throw new Error("DEVSPACE_STREAM_YIELD_CAP_MS must be between 1000 and 10000.");
}

function rewriteDevspaceStreamResilienceBody(requestBody) {
  if (requestBody.length === 0) return requestBody;
  let parsed;
  try {
    parsed = JSON.parse(requestBody.toString("utf8"));
  } catch {
    return requestBody;
  }
  let changed = false;
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    if (
      value.method === "tools/call" &&
      value.params &&
      typeof value.params === "object" &&
      (value.params.name === "exec_command" ||
        value.params.name === "write_stdin")
    ) {
      const toolName = value.params.name;
      const existingArguments = value.params.arguments;
      if (
        existingArguments !== undefined &&
        (!existingArguments ||
          typeof existingArguments !== "object" ||
          Array.isArray(existingArguments))
      ) {
        return value;
      }
      const currentArguments = existingArguments ?? {};
      const current = currentArguments.yieldTimeMs;
      const shouldCap =
        (toolName === "exec_command" && current === undefined) ||
        (typeof current === "number" &&
          Number.isFinite(current) &&
          current > DEVSPACE_STREAM_YIELD_CAP_MS);
      if (shouldCap) {
        changed = true;
        return {
          ...value,
          params: {
            ...value.params,
            arguments: {
              ...currentArguments,
              yieldTimeMs: DEVSPACE_STREAM_YIELD_CAP_MS,
            },
          },
        };
      }
    }
    return value;
  };
  const rewritten = visit(parsed);
  return changed ? Buffer.from(JSON.stringify(rewritten), "utf8") : requestBody;
}
// END DEVSPACE STREAM RESILIENCE PATCH v2

const server = http.createServer((req, res) => {
  const chunks = [];
  let total = 0;
  req.on("data", (chunk) => {
    total += chunk.length;
    if (total > maxRequestBytes) {
      req.destroy(new Error("DEVSPACE_GUARD_REQUEST_TOO_LARGE"));
      return;
    }
    chunks.push(Buffer.from(chunk));
  });
  req.on("error", (error) => {
    if (!res.headersSent) {
      writeGuardFailure(res, error.message);
    }
  });
  req.on("end", () => {
    const requestBody = rewriteDevspaceStreamResilienceBody(Buffer.concat(chunks));
    let calls = [];
    if (requestBody.length > 0) {
      try {
        calls = collectToolCalls(JSON.parse(requestBody.toString("utf8")));
      } catch {
        calls = [];
      }
    }
    for (const call of calls) {
      const result = heartbeat(call);
      if (!result.ok) {
        writeGuardFailure(
          res,
          `tool=${call.name}; exit=${String(result.status)}; stderr=${result.stderr.trim().slice(0, 500)}`
        );
        return;
      }
    }
    proxyRequest(req, res, requestBody, calls);
  });
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(
    JSON.stringify({
      status: "ready",
      listen_host: listenHost,
      listen_port: listenPort,
      upstream_host: upstreamHost,
      upstream_port: upstreamPort,
      lease_seconds: guardLeaseSeconds,
    }) + "\n"
  );
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
