"""Install the separately identifiable Bulk extension, preserving stock HTML backups."""
from pathlib import Path
import subprocess

root = Path('/opt/waha/dashboard-extension')
root.mkdir(mode=0o755, exist_ok=True)
script = Path('/opt/waha/bulk/dashboard-extension.js').read_text()
entries = ['index.html', '200.html', '404.html', 'Workers/index.html',
           'Sessions/index.html', 'event-monitor/index.html', 'Login/index.html']
for entry in entries:
    original = root / 'original' / entry
    original.parent.mkdir(parents=True, exist_ok=True)
    if not original.exists():
        subprocess.run(['docker', 'cp', 'waha-api:/app/dist/dashboard/' + entry,
                        str(original)], check=True)
    text = original.read_text()
    assert '</body>' in text and 'nutreeze-bulk-panel' not in text
    patched = root / 'patched' / entry
    patched.parent.mkdir(parents=True, exist_ok=True)
    patched.write_text(text.replace('</body>', '<script data-nutreeze-bulk-extension>' + script + '</script></body>'))
    patched.chmod(0o644)
    subprocess.run(['docker', 'cp', str(patched),
                    'waha-api:/app/dist/dashboard/' + entry], check=True)
print('Patched 7 dashboard HTML entry points; stock backups preserved; no restart.')
