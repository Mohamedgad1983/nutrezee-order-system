# nutrezee-vps MCP server

Local stdio MCP server that gives Claude Code full control of the staging VPS over SSH.
Nothing runs on the VPS itself beyond `sshd`; revoke access by removing the key line
from the VPS's `~/.ssh/authorized_keys`.

## Tools

| Tool | Purpose |
|---|---|
| `vps_exec` | Run any shell command (optional `cwd`, `timeout_sec`) |
| `vps_read_file` / `vps_write_file` | Read/write files on the VPS |
| `vps_upload` / `vps_download` | scp files between this machine and the VPS |
| `vps_docker` | `docker …` convenience wrapper |
| `vps_health` | uptime / disk / memory / `docker ps` snapshot |

## Configuration

Read at tool-call time from env vars (`VPS_HOST`, `VPS_USER`, `VPS_PORT`, `VPS_KEY`)
or from `~/.config/nutrezee-vps/config.json`:

```json
{ "host": "203.0.113.10", "user": "root", "port": 22 }
```

Default key: `~/.ssh/nutrezee_staging_ed25519`.

## Registration

```sh
claude mcp add nutrezee-vps -- node /Users/it/Documents/NutrezeeOrderSystem/tools/vps-mcp/server.mjs
```

Remove when staging work is finished: `claude mcp remove nutrezee-vps`.
