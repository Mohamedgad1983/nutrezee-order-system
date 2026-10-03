"""Read existing Bulk history in its owner context; no Store, auth or send calls."""
import json
import subprocess


# Fixed local container/path/SQL. Customer data goes only through stdin, never argv.
QUERY = '''import json,sqlite3,sys
try:
    value=json.load(sys.stdin)
    if set(value)!={'phone','message'} or not all(isinstance(x,str) for x in value.values()):
        raise ValueError()
    db=sqlite3.connect('file:/data/campaigns.sqlite3?mode=ro',uri=True,timeout=3)
    db.execute('PRAGMA query_only=ON')
    exists=db.execute("SELECT 1 FROM recipient r JOIN campaign c ON c.id=r.campaign_id WHERE r.phone=? AND c.message=? AND r.state IN ('sending','sent','uncertain') LIMIT 1",(value['phone'],value['message'])).fetchone() is not None
    db.close()
    print(json.dumps({'exists':exists}))
except Exception:
    raise SystemExit(1)
'''


class HistoryUnavailable(ValueError):
    pass


class ContainerHistory:
    """Existing local Docker socket, existing unprivileged container owner only."""
    def __init__(self, run=subprocess.run):
        self.run = run

    def contains(self, phone, message):
        try:
            result = self.run([
                '/usr/bin/docker', '--host', 'unix:///var/run/docker.sock',
                'exec', '-i', '--user', '10001:10001', 'waha-bulk',
                'python', '-c', QUERY,
            ], input=json.dumps({'phone': phone, 'message': message}),
                capture_output=True, text=True, timeout=10, check=False)
            if result.returncode or len(result.stdout) > 100:
                raise HistoryUnavailable()
            data = json.loads(result.stdout)
            if not isinstance(data, dict) or set(data) != {'exists'} or type(data['exists']) is not bool:
                raise HistoryUnavailable()
            return data['exists']
        except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, AttributeError):
            raise HistoryUnavailable('bulk_ledger_unavailable') from None
