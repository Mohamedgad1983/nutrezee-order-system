#!/usr/bin/env bash
# Console release gate — run on the server against a candidate image BEFORE swapping the Console container.
#   release-gate.sh <image> <extension-version>
# Static checks only. They are necessary, not sufficient: a74.1 passed every static check that existed
# and still stopped at "Starting up…". After this gate, ALSO open the candidate in a real browser
# (docker run -p 127.0.0.1:4299:4200 <image>, ssh -L 4299:127.0.0.1:4299, load http://localhost:4299/):
# the tab title must become "Nutreeze | Fleet-Ops" and the console must log no "Could not find module".
set -u
IMG=${1:?candidate image}
EXT=${2:?extension version}
docker rm -f nz-console-gate >/dev/null 2>&1
docker run -d --name nz-console-gate $IMG >/dev/null
sleep 3
X() { docker exec nz-console-gate sh -c "$1"; }
pass=0; total=0
chk() { total=$((total+1)); if [ "$2" = ok ]; then pass=$((pass+1)); echo "PASS $1"; else echo "FAIL $1 ($2)"; fi; }
X "nginx -t" >/dev/null 2>&1 && chk "nginx syntax" ok || chk "nginx syntax" bad
H=$(X "wget -qO- http://127.0.0.1:4200/")
echo "$H" | grep -q '%22environment%22%3A%22production%22' && ! echo "$H" | grep -q '%22environment%22%3A%22development%22' && chk "production metadata" ok || chk "production metadata" bad
E=$(X "wget -qO- http://127.0.0.1:4200/extensions.json")
N=$(echo "$E" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d), [e['version'] for e in d if 'nutrezee' in e['name']])")
[ "$N" = "10 ['$EXT']" ] && chk "extensions.json: 10 extensions, Nutrezee $EXT" ok || chk "extensions.json" "$N"
X "wget -qO /dev/null http://127.0.0.1:4200/engines-dist/@nutrezee/fleetops-labels-engine/assets/engine.css" 2>/dev/null && chk "theme alias 200" ok || chk "theme alias" bad
B=$(X "grep -rl 'nutrezee-order-status' /usr/share/nginx/html/engines-dist/@nutrezee /usr/share/nginx/html/assets 2>/dev/null | wc -l")
T=$(X "grep -rl 'data-test-nutrezee-order-status' /usr/share/nginx/html/engines-dist/@nutrezee 2>/dev/null | wc -l")
[ "$B" -ge 1 ] && [ "$T" -ge 1 ] && chk "bundle carries the Order Status page" ok || chk "bundle" "$B/$T"
X "grep -rl 'data-test-batch-date' /usr/share/nginx/html/engines-dist/@nutrezee | wc -l" | grep -qv '^0$' && chk "bundle still carries Batch Labels" ok || chk "batch labels" bad
X "grep -q 'nz-status-card' /usr/share/nginx/html/engines-dist/@nutrezee/fleetops-labels-engine/assets/engine.css" && chk "page styles present" ok || chk "styles" bad
X "grep -rl tile.openstreetmap.org /usr/share/nginx/html/assets /usr/share/nginx/html/engines-dist 2>/dev/null | wc -l" | grep -qv "^0$" && chk "map tile fix in the bundle" ok || chk "map tile fix" bad
X "grep -q leaflet-attribution-flag /usr/share/nginx/html/engines-dist/@nutrezee/fleetops-labels-engine/assets/engine.css" && chk "flag rule present" ok || chk "flag rule" bad
JS=$(X "ls /usr/share/nginx/html/assets | grep -E '^vendor.*\.js$' | head -1")
HD=$(X "wget -S -qO /dev/null --header='Accept-Encoding: gzip' http://127.0.0.1:4200/assets/$JS 2>&1")
echo "$HD" | grep -qi 'content-encoding: gzip' && chk "gzip on large JS" ok || chk "gzip" bad
FP=$(X "ls /usr/share/nginx/html/assets | grep -E '\-[0-9a-f]{20,}\.(js|css)$' | head -1")
HF=$(X "wget -S -qO /dev/null http://127.0.0.1:4200/assets/$FP 2>&1")
echo "$HF" | grep -qi 'immutable' && chk "fingerprinted assets immutable" ok || chk "immutable" "$FP"
HH=$(X "wget -S -qO /dev/null http://127.0.0.1:4200/ 2>&1")
echo "$HH" | grep -qi 'clear-site-data' && chk "no Clear-Site-Data" bad || chk "no Clear-Site-Data" ok
X "grep -o '0\.7\.48-a74\.1' -r /usr/share/nginx/html/index.html /usr/share/nginx/html/assets 2>/dev/null | head -1"
X "grep -rl console/extensions/utils /usr/share/nginx/html/assets 2>/dev/null | wc -l" | grep -q "^0$" && chk "entry file imports no sibling module" ok || chk "entry file imports a sibling module" bad
docker rm -f nz-console-gate >/dev/null
echo "GATE $pass/$total"
