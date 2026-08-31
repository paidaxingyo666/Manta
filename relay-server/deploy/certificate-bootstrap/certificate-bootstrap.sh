#!/bin/bash
# Obtains the relay's certificate out of band and, once it lands, moves Caddy to
# managing it. Runs on a timer because Let's Encrypt's resolver intermittently
# cannot validate DNSSEC for the .cn zone; a failed attempt here costs nothing,
# which is the whole point of doing it outside Caddy.
#
# Deliberately does NOT touch MANTA_RELAY_PUBLIC_URL or the 9444 listener. Those
# sign the desktop out, so they stay manual.
set -uo pipefail

DIR=/home/ubuntu/manta-relay-dev
DOMAIN=relay.manta.sh.cn
ACCOUNT=https://acme-v02.api.letsencrypt.org/acme/acct/3689809645
LIVE=$DIR/acme-state/live/$DOMAIN
FLAG=$DIR/.acme-bootstrapped
LOG=$DIR/acme-bootstrap.log

say() { echo "$(date -Is) $*" >>"$LOG"; }

[ -f "$FLAG" ] && exit 0

if [ ! -f "$LIVE/fullchain.pem" ]; then
  say "attempting issuance"
  docker run --rm \
    -v "$DIR/acme-webroot:/webroot" \
    -v "$DIR/acme-state:/etc/letsencrypt" \
    -v "$DIR/acme-log:/var/log/letsencrypt" \
    certbot/certbot certonly --webroot -w /webroot \
    -d "$DOMAIN" --register-unsafely-without-email --agree-tos \
    --non-interactive --key-type ecdsa >>"$LOG" 2>&1
  if [ ! -f "$LIVE/fullchain.pem" ]; then
    say "not yet; will retry"
    exit 0
  fi
fi

say "certificate in hand; seeding Caddy's store"

# Seed the managed store before switching so the swap has no gap at all: Caddy
# finds a valid certificate already there and never has to reach ACME to serve.
VOL=$(docker volume inspect manta-relay-dev_caddy-data -f '{{.Mountpoint}}') || exit 1
STORE="$VOL/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$DOMAIN"
mkdir -p "$STORE"
cp "$LIVE/fullchain.pem" "$STORE/$DOMAIN.crt"
cp "$LIVE/privkey.pem" "$STORE/$DOMAIN.key"
cat >"$STORE/$DOMAIN.json" <<JSON
{"sans":["$DOMAIN"],"issuer_data":{"ca":"https://acme-v02.api.letsencrypt.org/directory","account":"$ACCOUNT"}}
JSON
chown -R root:root "$STORE"; chmod 600 "$STORE"/*

# Drop the pinned certificate from the config. Nothing else changes.
cd "$DIR" || exit 1
cp -a Caddyfile Caddyfile.bak-preswitch
python3 - <<'PY'
import re, pathlib
p = pathlib.Path('/home/ubuntu/manta-relay-dev/Caddyfile')
t = p.read_text()
t = re.sub(r'\n\t# The pinned certificate[^\n]*\n(?:\t#[^\n]*\n)*\ttls /certs/[^\n]*\n', '\n', t)
t = re.sub(r'\n\ttls /certs/[^\n]*\n', '\n', t)
t = re.sub(r'\n\n\n+', '\n\n', t)
p.write_text(t)
PY

if ! docker exec manta-relay-dev-caddy-1 caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  say "new config invalid; restoring"
  cp -a Caddyfile.bak-preswitch Caddyfile
  exit 1
fi

docker exec manta-relay-dev-caddy-1 caddy reload --config /etc/caddy/Caddyfile >>"$LOG" 2>&1

ok=0
for i in $(seq 1 10); do
  a=$(curl -sk --max-time 8 -o /dev/null -w '%{http_code}' https://127.0.0.1/health --resolve "$DOMAIN:443:127.0.0.1" 2>/dev/null)
  b=$(curl -sk --max-time 8 -o /dev/null -w '%{http_code}' "https://$DOMAIN:9444/health" --resolve "$DOMAIN:9444:127.0.0.1" 2>/dev/null)
  [ "$a" = "200" ] && [ "$b" = "200" ] && { ok=1; break; }
  sleep 3
done

if [ "$ok" != "1" ]; then
  say "verification failed (443=$a 9444=$b); rolling back"
  cp -a Caddyfile.bak-preswitch Caddyfile
  docker exec manta-relay-dev-caddy-1 caddy reload --config /etc/caddy/Caddyfile >>"$LOG" 2>&1
  exit 1
fi

touch "$FLAG"
systemctl disable --now manta-acme-bootstrap.timer >>"$LOG" 2>&1
say "switched to a managed certificate; timer disabled"
