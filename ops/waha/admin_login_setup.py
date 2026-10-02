"""Owner-run hidden terminal input; no network and no account creation."""
import getpass
import os
from pathlib import Path
import re
import shlex
import stat

CONFIG = Path('/opt/nutrezee/legacy-migration.env')
KEYS = ('LEGACY_ADMIN_EMAIL', 'LEGACY_ADMIN_PASSWORD')


def replace_credentials(text, email, password):
    values = dict(zip(KEYS, (email, password)))
    if any(not v or any(c in v for c in '\r\n\x00') for v in values.values()):
        raise ValueError('empty or multiline input rejected')
    lines = text.splitlines(keepends=True)
    for key, value in values.items():
        matches = [i for i, line in enumerate(lines)
                   if re.match(r'^' + key + r'=', line)]
        if len(matches) != 1:
            raise ValueError('existing credential key missing or ambiguous')
        i = matches[0]
        ending = '\r\n' if lines[i].endswith('\r\n') else '\n' if lines[i].endswith('\n') else ''
        lines[i] = key + '=' + shlex.quote(value) + ending
    return ''.join(lines)


def main():
    if os.geteuid() != 0 or not os.isatty(0):
        raise SystemExit('Run as root in an interactive owner terminal.')
    fd = os.open(CONFIG, os.O_RDWR | os.O_NOFOLLOW)
    with os.fdopen(fd, 'r+', encoding='utf-8', newline='') as f:
        info = os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise SystemExit('Existing configuration must be root-owned mode 0600.')
        old = f.read()
        email = getpass.getpass('Existing Admin email (hidden): ')
        password = getpass.getpass('Existing Admin password (hidden): ')
        if password != getpass.getpass('Repeat password (hidden): '):
            raise SystemExit('Entries differ; nothing changed.')
        try:
            updated = replace_credentials(old, email, password)
        except ValueError as exc:
            raise SystemExit(str(exc))
        f.seek(0)
        f.write(updated)
        f.truncate()
        f.flush()
        os.fsync(f.fileno())
    print('Existing Admin configuration updated. No login or sending was attempted.')


if __name__ == '__main__':
    main()
