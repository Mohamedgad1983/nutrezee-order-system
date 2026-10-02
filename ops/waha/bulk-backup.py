#!/usr/bin/env python3
"""Consistent SQLite backup as root on the VPS; does not stop/pause/send campaigns."""
import datetime
import os
from pathlib import Path
import sqlite3
os.umask(0o077)
root = Path('/opt/waha/backups')
root.mkdir(mode=0o700, exist_ok=True)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
target = root / ('bulk-' + stamp + '.sqlite3')
source = sqlite3.connect('file:/opt/waha/bulk-data/campaigns.sqlite3?mode=ro', uri=True)
destination = sqlite3.connect(target)
try:
    source.backup(destination)
    assert destination.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
finally:
    source.close()
    destination.close()
target.chmod(0o600)
print('Verified root-only campaign backup:', target.name)
