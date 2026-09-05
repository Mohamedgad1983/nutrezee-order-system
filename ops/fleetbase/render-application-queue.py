#!/usr/bin/env python3
"""Render an opt-in worker from the host's effective application configuration.

Run in /opt/fleetbase. The output can contain protected environment values: keep
it on the server and never print or commit it. No containers are started here.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", action="append", required=True,
                        help="Existing compose file, in the host's normal merge order")
    parser.add_argument("--output", required=True, help="Protected generated overlay path")
    args = parser.parse_args()
    output = Path(args.output).resolve()
    inputs = [Path(p).resolve() for p in args.file]
    if output in inputs:
        parser.error("output must not overwrite an input compose file")
    command = ["docker", "compose"]
    for path in inputs:
        command.extend(["-f", str(path)])
    # Capture stderr too: configuration errors can include sensitive values.
    result = subprocess.run(command + ["config", "--format", "json"],
                            capture_output=True, check=False)
    if result.returncode:
        raise SystemExit("Compose validation failed; generated overlay not changed")
    config = json.loads(result.stdout)
    worker = copy.deepcopy(config["services"]["application"])
    worker.pop("container_name", None)
    worker.pop("ports", None)
    worker.update({
        "profiles": ["application-queue"],
        "command": ["php", "artisan", "queue:work", "--sleep=3", "--tries=1", "--timeout=60"],
        "restart": "unless-stopped",
        "healthcheck": {
            "test": ["CMD-SHELL", "tr '\\0' ' ' < /proc/1/cmdline | grep -q 'artisan queue:work'"],
            "interval": "30s", "timeout": "5s", "retries": 3, "start_period": "10s",
        },
    })
    descriptor, temporary = tempfile.mkstemp(prefix=".application-queue-", dir=output.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            # Compose config already preserves literal dollars for round-tripping.
            json.dump({"services": {"application-queue": worker}}, stream, indent=2)
            stream.write("\n")
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("Protected application-queue overlay rendered; no containers started")


if __name__ == "__main__":
    main()
