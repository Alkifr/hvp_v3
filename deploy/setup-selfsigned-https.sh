#!/usr/bin/env bash
# Самоподписанный TLS для https://hvp.atechnics.ru (браузер покажет предупреждение).
# Запуск на srv-fin-02v от УЗ с sudo:
#   sudo bash /opt/hvp_v3/deploy/setup-selfsigned-https.sh
set -euo pipefail

DOMAIN="${HVP_DOMAIN:-hvp.atechnics.ru}"
CRT="/etc/ssl/certs/${DOMAIN}.crt"
KEY="/etc/ssl/private/${DOMAIN}.key"
NGINX_CONF="/etc/nginx/conf.d/${DOMAIN}.conf"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_CONF="$ROOT/deploy/nginx-hvp.atechnics.ru.conf"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запустите через sudo" >&2
  exit 1
fi

apt-get install -y nginx openssl
mkdir -p /etc/ssl/certs /etc/ssl/private

if [[ ! -f "$CRT" || ! -f "$KEY" ]]; then
  TMP="$(mktemp)"
  cat > "$TMP" << EOF
[req]
default_bits = 2048
prompt = no
distinguished_name = dn
x509_extensions = ext
[dn]
CN = ${DOMAIN}
O = atechnics internal
[ext]
subjectAltName = DNS:${DOMAIN}
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
basicConstraints = CA:FALSE
EOF
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$KEY" \
    -out "$CRT" \
    -config "$TMP"
  rm -f "$TMP"
  chmod 644 "$CRT"
  chmod 600 "$KEY"
  echo "Выпущен самоподписанный сертификат: $CRT"
else
  echo "Сертификат уже есть, не перевыпускаю: $CRT"
fi

if [[ ! -f "$SRC_CONF" ]]; then
  echo "Нет $SRC_CONF — сначала git pull в /opt/hvp_v3" >&2
  exit 1
fi

cp "$SRC_CONF" "$NGINX_CONF"
if [[ -d /etc/nginx/sites-enabled ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx
echo "nginx слушает 80/443. Откройте https://${DOMAIN} (предупреждение о сертификате — ожидаемо)."
