#!/usr/bin/env bash
# Sandbox duman testi — Raspberry Pi'de (gerçek Docker ile) çalıştır.
#   SANDBOXD_TOKEN=... ./scripts/sandbox-smoke.sh [http://localhost:8791]
# Her kontrol PASS/FAIL yazar. Herhangi biri FAIL ise sandbox'ı kullanıcılara AÇMA.
set -uo pipefail
URL="${1:-http://localhost:8791}"
TOKEN="${SANDBOXD_TOKEN:?SANDBOXD_TOKEN gerekli}"
USER_ID="smoke-$$"
SESSION="smoke-session-$$"
fail=0

call() { curl -sS -m 150 -X POST "$URL/v1/$1" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$2"; }
run() { call exec "$(USER_ID=$USER_ID SESSION=$SESSION python3 - "$1" "${2:-30}" <<'PY'
import json,os,sys
print(json.dumps({"user":os.environ["USER_ID"],"session":os.environ["SESSION"],"command":sys.argv[1],"timeout_seconds":int(sys.argv[2])}))
PY
)"; }
field() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }
check() { # check "ad" "komut" "python ifadesi (d = sonuç)" [timeout]
  local out; out="$(run "$2" "${4:-30}")" || { echo "FAIL  $1 (istek başarısız)"; fail=1; return; }
  if OUT="$out" python3 -c 'import json,os,sys; d=json.loads(os.environ["OUT"]); sys.exit(0 if eval(sys.argv[1]) else 1)' "$3" 2>/dev/null; then
    echo "PASS  $1"
  else
    echo "FAIL  $1"; echo "      → $(echo "$out" | head -c 300)"; fail=1
  fi
}

echo "== sandboxd: $URL"
curl -fsS "$URL/healthz" >/dev/null || { echo "sandboxd'a ulaşılamıyor"; exit 2; }

check "komut çalışır, ayrıcalıksız kullanıcı (uid 1000)" 'id -u' 'd["stdout"].strip()=="1000"'
check "kök dosya sistemi salt okunur"                   'touch /etc/hack 2>&1; echo rc=$?' '"rc=0" not in d["stdout"]'
check "tüm yetenekler (capabilities) düşürülmüş"        'grep CapEff /proc/self/status' '"0000000000000000" in d["stdout"]'
check "çalışma alanı yazılabilir"                       'echo selam > /work/t.txt && cat /work/t.txt' 'd["stdout"].strip()=="selam"'
check "disk doldurma sert sınırda durur (tmpfs)"        'dd if=/dev/zero of=/work/big bs=1M count=300 2>&1; ls -l /work/big | awk "{print \$5}"' 'int(d["stdout"].strip().splitlines()[-1] or 0) <= 70*1024*1024'
check "bellek sınırı: 600 MB istek öldürülür"           'python3 -c "x=bytearray(600*1024*1024); print(\"ALLOCATED\")" 2>&1; echo rc=$?' '"ALLOCATED" not in d["stdout"]'
check "fork bombası kontrol altında (komut döner)"      ':(){ :|:& };: ; sleep 1; echo hayatta' 'd["timedOut"] or "hayatta" in d["stdout"] or d["exitCode"] is not None' 20
check "zaman aşımı: 100 sn'lik komut 2 sn'de kesilir"   'sleep 100' 'd["timedOut"] is True' 2
check "sonsuz çıktı kesilir"                            'yes' 'd["truncated"] is True' 10
check "docker soketi sandbox içinde YOK"                'ls /var/run/docker.sock 2>&1; echo rc=$?' '"rc=0" not in d["stdout"]'
check "ana uygulamanın sırları ortamda yok"             'env | grep -ci -E "jwt|secret|password|token" || true' 'int(d["stdout"].strip() or 0)==0'

if [[ "${SANDBOX_NETWORK:-none}" == "restricted" ]]; then
  GW="$(docker network inspect -f '{{(index .IPAM.Config 0).Gateway}}' sixfinger-sandbox 2>/dev/null || echo 172.30.0.1)"
  check "internet: HTTPS çalışır"                       'curl -sS -m 15 -o /dev/null -w "%{http_code}" https://example.com' 'd["stdout"].strip() in ("200","301","302")' 30
  check "internet: HTTP (80) çalışır"                   'curl -sS -m 15 -o /dev/null -w "%{http_code}" http://example.com' 'd["stdout"].strip() in ("200","301","302")' 30
  check "ana makineye erişim engelli (ağ geçidi:8787)"  "curl -sS -m 5 -o /dev/null -w '%{http_code}' http://$GW:8787/api/health; echo rc=\$?" '"rc=0" not in d["stdout"]' 20
  check "ana makineye erişim engelli (ağ geçidi:22)"    "nc -z -w 3 $GW 22; echo rc=\$?" '"rc=0" not in d["stdout"]' 20
  check "ev ağı engelli (192.168.1.1)"                  'curl -sS -m 5 -o /dev/null http://192.168.1.1/; echo rc=$?' '"rc=0" not in d["stdout"]' 20
  check "ev ağı engelli (10.0.0.1)"                     'curl -sS -m 5 -o /dev/null http://10.0.0.1/; echo rc=$?' '"rc=0" not in d["stdout"]' 20
  check "SMTP (587) engelli"                            'nc -z -w 4 smtp.gmail.com 587; echo rc=$?' '"rc=0" not in d["stdout"]' 20
  check "SSH (22) çıkışı engelli"                       'nc -z -w 4 github.com 22; echo rc=$?' '"rc=0" not in d["stdout"]' 20
else
  check "ağ kapalı: internet yok"                       'curl -sS -m 5 -o /dev/null https://example.com; echo rc=$?' '"rc=0" not in d["stdout"]' 20
fi

echo "== dosya araçları"
call write "{\"user\":\"$USER_ID\",\"session\":\"$SESSION\",\"path\":\"a/b.txt\",\"content\":\"merhaba\"}" | grep -q '"bytes":7' && echo "PASS  write" || { echo "FAIL  write"; fail=1; }
call read "{\"user\":\"$USER_ID\",\"session\":\"$SESSION\",\"path\":\"a/b.txt\"}" | grep -q 'merhaba' && echo "PASS  read" || { echo "FAIL  read"; fail=1; }
call edit "{\"user\":\"$USER_ID\",\"session\":\"$SESSION\",\"path\":\"a/b.txt\",\"old_string\":\"merhaba\",\"new_string\":\"selam\"}" | grep -q '"replacements":1' && echo "PASS  edit" || { echo "FAIL  edit"; fail=1; }
call destroy "{\"user\":\"$USER_ID\",\"session\":\"$SESSION\"}" >/dev/null

echo; curl -fsS "$URL/v1/stats" -H "authorization: Bearer $TOKEN" | python3 -m json.tool | head -20
if [[ $fail -eq 0 ]]; then echo; echo "✅ Tüm kontroller geçti."; else echo; echo "❌ Bazı kontroller BAŞARISIZ. Sandbox'ı açma; docs/sandbox.md → Sorun giderme."; exit 1; fi
