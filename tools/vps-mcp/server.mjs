#!/usr/bin/env node
// Nutrezee staging VPS MCP server.
// Local stdio server that drives the staging VPS over SSH — nothing runs on the
// VPS itself beyond sshd. Config (host/user/port/key) comes from env vars or
// ~/.config/nutrezee-vps/config.json so the server can be registered before the
// VPS details are known; tools error with a clear message until configured.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH =
  process.env.VPS_CONFIG ?? join(homedir(), ".config", "nutrezee-vps", "config.json");
const MAX_OUTPUT_BYTES = 60_000;

function loadConfig() {
  let file = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    } catch {
      throw new Error(`Config file ${CONFIG_PATH} exists but is not valid JSON`);
    }
  }
  const cfg = {
    host: process.env.VPS_HOST ?? file.host,
    user: process.env.VPS_USER ?? file.user ?? "root",
    port: String(process.env.VPS_PORT ?? file.port ?? 22),
    key: process.env.VPS_KEY ?? file.key ?? join(homedir(), ".ssh", "nutrezee_staging_ed25519"),
  };
  if (!cfg.host) {
    throw new Error(
      `VPS not configured yet — write {"host": "<ip>", "user": "<user>"} to ${CONFIG_PATH} (or set VPS_HOST/VPS_USER env vars on the MCP registration)`
    );
  }
  return cfg;
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function sshBaseArgs(cfg) {
  return [
    "-i", cfg.key,
    "-p", cfg.port,
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
  ];
}

function run(cmd, args, { stdin, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: killed ? -1 : code, stdout, stderr, timedOut: killed });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err), timedOut: false });
    });
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });
}

function sshExec(remoteCommand, { stdin, timeoutMs } = {}) {
  const cfg = loadConfig();
  const args = [...sshBaseArgs(cfg), `${cfg.user}@${cfg.host}`, remoteCommand];
  return run("ssh", args, { stdin, timeoutMs });
}

function truncate(s) {
  if (s.length <= MAX_OUTPUT_BYTES) return s;
  return s.slice(0, MAX_OUTPUT_BYTES) + `\n…[truncated, ${s.length} bytes total]`;
}

function asResult(r) {
  const parts = [];
  if (r.timedOut) parts.push("[TIMED OUT]");
  parts.push(`exit code: ${r.code}`);
  if (r.stdout.trim()) parts.push(`stdout:\n${truncate(r.stdout)}`);
  if (r.stderr.trim()) parts.push(`stderr:\n${truncate(r.stderr)}`);
  if (!r.stdout.trim() && !r.stderr.trim()) parts.push("(no output)");
  return {
    content: [{ type: "text", text: parts.join("\n") }],
    isError: r.code !== 0,
  };
}

function errResult(err) {
  return { content: [{ type: "text", text: String(err.message ?? err) }], isError: true };
}

const server = new McpServer({ name: "nutrezee-vps", version: "1.0.0" });

server.registerTool(
  "vps_exec",
  {
    description:
      "Run a shell command on the staging VPS over SSH. Returns exit code, stdout, stderr.",
    inputSchema: {
      command: z.string().describe("Shell command to run on the VPS"),
      cwd: z.string().optional().describe("Directory to cd into before running"),
      timeout_sec: z.number().int().min(1).max(600).optional()
        .describe("Timeout in seconds (default 120)"),
    },
  },
  async ({ command, cwd, timeout_sec }) => {
    try {
      const full = cwd ? `cd ${shq(cwd)} && ${command}` : command;
      return asResult(await sshExec(full, { timeoutMs: (timeout_sec ?? 120) * 1000 }));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.registerTool(
  "vps_read_file",
  {
    description: "Read a file from the staging VPS.",
    inputSchema: {
      path: z.string().describe("Absolute path of the file on the VPS"),
      max_bytes: z.number().int().min(1).optional()
        .describe("Read at most this many bytes (default 60000)"),
    },
  },
  async ({ path, max_bytes }) => {
    try {
      const limit = Math.min(max_bytes ?? MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
      const r = await sshExec(`head -c ${limit} -- ${shq(path)}`);
      if (r.code !== 0) return asResult(r);
      return { content: [{ type: "text", text: r.stdout }] };
    } catch (e) {
      return errResult(e);
    }
  }
);

server.registerTool(
  "vps_write_file",
  {
    description:
      "Write a file on the staging VPS (creates parent directories; overwrites if it exists).",
    inputSchema: {
      path: z.string().describe("Absolute destination path on the VPS"),
      content: z.string().describe("File content"),
      mode: z.string().optional().describe("Optional chmod mode, e.g. '600' or '755'"),
    },
  },
  async ({ path, content, mode }) => {
    try {
      const chmod = mode ? ` && chmod ${shq(mode)} ${shq(path)}` : "";
      const cmd = `mkdir -p "$(dirname ${shq(path)})" && cat > ${shq(path)}${chmod}`;
      const r = await sshExec(cmd, { stdin: content });
      if (r.code === 0) {
        return { content: [{ type: "text", text: `wrote ${content.length} bytes to ${path}` }] };
      }
      return asResult(r);
    } catch (e) {
      return errResult(e);
    }
  }
);

server.registerTool(
  "vps_upload",
  {
    description: "Upload a local file to the staging VPS via scp.",
    inputSchema: {
      local_path: z.string().describe("Path on this machine"),
      remote_path: z.string().describe("Destination path on the VPS"),
    },
  },
  async ({ local_path, remote_path }) => {
    try {
      const cfg = loadConfig();
      const args = [
        "-i", cfg.key, "-P", cfg.port,
        "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
        local_path, `${cfg.user}@${cfg.host}:${remote_path}`,
      ];
      return asResult(await run("scp", args, { timeoutMs: 300_000 }));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.registerTool(
  "vps_download",
  {
    description: "Download a file from the staging VPS to this machine via scp.",
    inputSchema: {
      remote_path: z.string().describe("Path on the VPS"),
      local_path: z.string().describe("Destination path on this machine"),
    },
  },
  async ({ remote_path, local_path }) => {
    try {
      const cfg = loadConfig();
      const args = [
        "-i", cfg.key, "-P", cfg.port,
        "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
        `${cfg.user}@${cfg.host}:${remote_path}`, local_path,
      ];
      return asResult(await run("scp", args, { timeoutMs: 300_000 }));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.registerTool(
  "vps_docker",
  {
    description:
      "Run a docker CLI command on the staging VPS, e.g. args='compose -f docker/compose.yml ps' or args='logs --tail 100 api'.",
    inputSchema: {
      args: z.string().describe("Arguments passed to `docker` on the VPS"),
      timeout_sec: z.number().int().min(1).max(600).optional()
        .describe("Timeout in seconds (default 300)"),
    },
  },
  async ({ args, timeout_sec }) => {
    try {
      return asResult(
        await sshExec(`docker ${args}`, { timeoutMs: (timeout_sec ?? 300) * 1000 })
      );
    } catch (e) {
      return errResult(e);
    }
  }
);

server.registerTool(
  "vps_health",
  {
    description:
      "Quick VPS health snapshot: uptime, disk, memory, docker containers (tolerates docker being absent).",
    inputSchema: {},
  },
  async () => {
    try {
      const cmd =
        'echo "== host ==" && hostname && uname -a && echo "== uptime ==" && uptime && ' +
        'echo "== disk ==" && df -h / && echo "== memory ==" && free -m && ' +
        'echo "== docker ==" && (docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}" 2>&1 || true)';
      const r = await sshExec(cmd);
      return { content: [{ type: "text", text: truncate(r.stdout + (r.stderr ? `\n${r.stderr}` : "")) }] };
    } catch (e) {
      return errResult(e);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
