#!/usr/bin/env bash
# Code çalışma alanı duman testi — Raspberry Pi'de (gerçek Docker ile) çalıştır.
#   SANDBOXD_TOKEN=... ./scripts/code-sandbox-smoke.sh [http://localhost:8791]
# sandboxd portu compose dışına açık değilse: docker compose exec sandboxd ... yerine geçici olarak
#   docker compose port sandboxd 8791   ya da   SANDBOXD_URL=http://<sandboxd-konteyner-ip>:8791
# Genel (herkese açık) küçük bir repoyu klonlar; GitHub token'ı gerekmez. Herhangi bir FAIL varsa Code'u kullanıcılara AÇMA.
set -uo pipefail
URL="${1:-${SANDBOXD_URL:-http://localhost:8791}}"
TOKEN="${SANDBOXD_TOKEN:?SANDBOXD_TOKEN gerekli}"
REPO="${SMOKE_REPO:-octocat/Hello-World}"
BRANCH="${SMOKE_BRANCH:-master}"
U="smoke-code-$$"
S="$U:smoke-session"
fail=0

post() { # post <uç> <json> → gövde; HTTP durumu $STATUS'ta
  local tmp; tmp="$(mktemp)"
  STATUS="$(curl -sS -m 600 -o "$tmp" -w '%{http_code}' -X POST "$URL/v1/code/$1" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$2")"
  cat "$tmp"; rm -f "$tmp"
}
j() { python3 -c 'import json,sys; print(json.dumps(dict(zip(sys.argv[1::2], [json.loads(v) for v in sys.argv[2::2]]))))' "$@"; }
who() { j user "\"$U\"" session "\"$S\""; }
exec_() { post exec "$(python3 -c 'import json,sys; print(json.dumps({"user":sys.argv[1],"session":sys.argv[2],"command":sys.argv[3],"timeout_seconds":int(sys.argv[4])}))' "$U" "$S" "$1" "${2:-60}")"; }
ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; [[ -n "${2:-}" ]] && echo "      → $(echo "$2" | head -c 300)"; fail=1; }
check() { # check "ad" "komut" "python ifadesi (d = sonuç)" [timeout]
  local out; out="$(exec_ "$2" "${4:-60}")"
  if OUT="$out" python3 -c 'import json,os,sys; d=json.loads(os.environ["OUT"]); sys.exit(0 if eval(sys.argv[1]) else 1)' "$3" 2>/dev/null; then ok "$1"; else bad "$1" "$out"; fi
}

echo "== sandboxd: $URL  repo: $REPO@$BRANCH"
curl -fsS "$URL/healthz" >/dev/null || { echo "sandboxd'a ulaşılamıyor"; exit 2; }

PREP="$(post prepare "$(python3 -c 'import json,sys; print(json.dumps({"user":sys.argv[1],"session":sys.argv[2],"repo":sys.argv[3],"base_branch":sys.argv[4],"work_branch":"sixfinger/smoke","network":{"mode":"trusted","domains":[]},"disk_mb":256,"setup_script":"","env":{}}))' "$U" "$S" "$REPO" "$BRANCH")")"
if [[ "$STATUS" == "200" ]] && echo "$PREP" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["cloned"] and d["branch"]=="sixfinger/smoke" else 1)'; then ok "klonlama + çalışma branch'i"; else bad "klonlama + çalışma branch'i ($STATUS)" "$PREP"; trap - EXIT; exit 1; fi
cleanup() { post destroy "$(who)" >/dev/null; }
trap cleanup EXIT

check "çalışma dizini /work, ayrıcalıksız kullanıcı"      'pwd; id -u' 'd["stdout"].split()==["/work","1000"]'
check "git deposu klonlanmış (commit var)"                'git log --oneline | wc -l' 'int(d["stdout"].strip())>=1'
check "token/kimlik bilgisi .git içinde YOK"              'grep -ci -E "token|extraheader|gho_|ghp_" .git/config || true' 'int(d["stdout"].strip() or 0)==0'

W="$(post write "$(python3 -c 'import json,sys; print(json.dumps({"user":sys.argv[1],"session":sys.argv[2],"path":"smoke/hello.txt","content":"merhaba\n"}))' "$U" "$S")")"
[[ "$STATUS" == "200" ]] && ok "dosya yazma (alt klasör otomatik)" || bad "dosya yazma ($STATUS)" "$W"
R="$(post read "$(python3 -c 'import json,sys; print(json.dumps({"user":sys.argv[1],"session":sys.argv[2],"path":"smoke/hello.txt"}))' "$U" "$S")")"
echo "$R" | grep -q 'merhaba' && ok "dosya okuma" || bad "dosya okuma ($STATUS)" "$R"
G="$(post grep "$(python3 -c 'import json,sys; print(json.dumps({"user":sys.argv[1],"session":sys.argv[2],"pattern":"merhaba"}))' "$U" "$S")")"
echo "$G" | grep -q 'smoke/hello.txt' && ok "grep (ripgrep imajda)" || bad "grep ($STATUS)" "$G"

CH="$(post changes "$(who)")"
echo "$CH" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if any(f["path"]=="smoke/hello.txt" and f["status"]=="added" for f in d["files"]) else 1)' 2>/dev/null && ok "değişiklik listesi (+N −M)" || bad "değişiklik listesi" "$CH"
CM="$(post commit "$(python3 -c 'import json,sys; print(json.dumps({"user":sys.argv[1],"session":sys.argv[2],"message":"smoke: deneme\n\nCo-Authored-By: SixFinger Code <noreply@sixfinger.live>"}))' "$U" "$S")")"
echo "$CM" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("sha") else 1)' 2>/dev/null && ok "commit" || bad "commit" "$CM"
CM2="$(post commit "$(python3 -c 'import json,sys; print(json.dumps({"user":sys.argv[1],"session":sys.argv[2],"message":"bos"}))' "$U" "$S")")"
echo "$CM2" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("sha") is None else 1)' 2>/dev/null && ok "değişiklik yoksa commit yok" || bad "değişiklik yoksa commit yok" "$CM2"
check "commit mesajında ortak yazar satırı var"           'git log -1 --format=%B | grep -c "Co-Authored-By: SixFinger Code"' 'int(d["stdout"].strip())==1'

U2="$(post usage "$(who)")"
echo "$U2" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["diskUsedMb"]>=0 and d["diskMb"]==256 else 1)' 2>/dev/null && ok "disk kullanımı ölçülüyor (256 MB tavan)" || bad "disk kullanımı" "$U2"

# --- ağ: trusted ---
check "ağ: izinli kaynak (npm) proxy üzerinden açılır"    'curl -sS -m 20 -o /dev/null -w "%{http_code}" https://registry.npmjs.org/left-pad' 'd["stdout"].strip()=="200"' 40
check "ağ: izin listesinde olmayan site engelli"          'curl -sS -m 10 -o /dev/null -w "%{http_code}" https://example.com; echo rc=$?' 'not d["stdout"].startswith("200")' 30
check "ağ: proxy'yi atlamak (doğrudan çıkış) mümkün değil" 'curl --noproxy "*" -sS -m 6 -o /dev/null https://1.1.1.1; echo rc=$?' '"rc=0" not in d["stdout"]' 30
check "ağ: ev ağı/yerel adresler engelli"                 'curl --noproxy "*" -sS -m 4 -o /dev/null http://192.168.1.1/; echo rc=$?' '"rc=0" not in d["stdout"]' 20
check "ağ: proxy yerel adrese tünel açmaz"                'curl -sS -m 8 -o /dev/null -w "%{http_code}" https://127.0.0.1/ ; echo rc=$?' '"rc=0" not in d["stdout"] or not d["stdout"].startswith("200")' 30

# --- disk kotası ---
exec_ 'dd if=/dev/zero of=/work/big bs=1M count=300 2>&1 | tail -n 1' 120 >/dev/null
W2="$(post write "$(python3 -c 'import json,sys; print(json.dumps({"user":sys.argv[1],"session":sys.argv[2],"path":"x.txt","content":"x"}))' "$U" "$S")")"
[[ "$STATUS" == "507" ]] && ok "disk dolunca yazma reddedilir (507 disk_full)" || bad "disk kotası ($STATUS)" "$W2"

if [[ $fail -eq 0 ]]; then echo; echo "Tüm kontroller geçti."; else echo; echo "BAŞARISIZ kontroller var — Code'u kullanıcılara açma."; fi
exit $fail
