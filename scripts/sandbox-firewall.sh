#!/usr/bin/env bash
# Sandbox ağı için güvenlik duvarı kuralları (ana makinede, root ile çalıştır).
#   sudo scripts/sandbox-firewall.sh            → kuralları uygular (tekrar çalıştırmak güvenlidir)
#   sudo scripts/sandbox-firewall.sh --remove   → kuralları kaldırır
#
# Sandbox konteynerleri yalnızca ŞUNLARI yapabilir:
#   • genel DNS sunucularına (1.1.1.1, 9.9.9.9) 53 numaralı porttan sorgu
#   • internete TCP 80 ve 443 (hız sınırlı)
# Yapamazlar: yerel ağ (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10), ana makinenin kendisi, SMTP/SSH/diğer portlar, ICMP.
set -euo pipefail

SUBNET="${SANDBOX_SUBNET:-172.30.0.0/24}"
DNS_SERVERS="${SANDBOX_DNS:-1.1.1.1 9.9.9.9}"
OUT=SF-SANDBOX-OUT   # konteynerden dışarı (FORWARD → DOCKER-USER)
IN=SF-SANDBOX-IN     # konteynerden ana makinenin kendisine (INPUT)

if [[ $EUID -ne 0 ]]; then echo "root olarak çalıştır: sudo $0" >&2; exit 1; fi
command -v iptables >/dev/null || { echo "iptables bulunamadı (apt install iptables)" >&2; exit 1; }

remove() {
  iptables -D DOCKER-USER -s "$SUBNET" -j "$OUT" 2>/dev/null || true
  iptables -D DOCKER-USER -d "$SUBNET" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
  iptables -D INPUT -s "$SUBNET" -j "$IN" 2>/dev/null || true
  for c in "$OUT" "$IN"; do iptables -F "$c" 2>/dev/null || true; iptables -X "$c" 2>/dev/null || true; done
}

remove
if [[ "${1:-}" == "--remove" ]]; then echo "Sandbox güvenlik duvarı kuralları kaldırıldı."; exit 0; fi

# DOCKER-USER zinciri Docker tarafından oluşturulur; yoksa Docker çalışmıyordur.
iptables -nL DOCKER-USER >/dev/null 2>&1 || { echo "DOCKER-USER zinciri yok: Docker çalışıyor mu?" >&2; exit 1; }

# --- Konteynerden dışarı ---
iptables -N "$OUT"
for dns in $DNS_SERVERS; do
  iptables -A "$OUT" -d "$dns" -p udp --dport 53 -j ACCEPT
  iptables -A "$OUT" -d "$dns" -p tcp --dport 53 -j ACCEPT
done
# Özel/yerel/çok noktaya yayın aralıkları: her durumda kapalı
for net in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.168.0.0/16 198.18.0.0/15 224.0.0.0/4 240.0.0.0/4; do
  iptables -A "$OUT" -d "$net" -j DROP
done
# İnternet: yalnızca 80/443, konteyner başına yeni bağlantı hızı ve toplam bağlantı sınırlı (tarama/DoS'u zorlaştırır)
iptables -A "$OUT" -p tcp -m multiport --dports 80,443 -m connlimit --connlimit-above 64 --connlimit-mask 32 -j DROP
iptables -A "$OUT" -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW \
  -m hashlimit --hashlimit-name sfsandbox --hashlimit-above 20/second --hashlimit-burst 40 --hashlimit-mode srcip -j DROP
iptables -A "$OUT" -p tcp -m multiport --dports 80,443 -j ACCEPT
iptables -A "$OUT" -j DROP   # geri kalan her şey (SMTP, SSH, ICMP, UDP, …)

# Dönüş trafiği serbest; çıkış kuralları en üste
iptables -I DOCKER-USER 1 -d "$SUBNET" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -I DOCKER-USER 2 -s "$SUBNET" -j "$OUT"

# --- Konteynerden ana makinenin kendisine (ağ geçidi 172.30.0.1 dahil) ---
iptables -N "$IN"
iptables -A "$IN" -j DROP
iptables -I INPUT 1 -s "$SUBNET" -j "$IN"

echo "Sandbox güvenlik duvarı uygulandı (alt ağ: $SUBNET)."
echo "Kalıcı yapmak için docs/sandbox.md → \"Açılışta otomatik uygula\"."
