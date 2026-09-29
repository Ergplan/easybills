#!/usr/bin/env bash
# Start or update EkBill on this VM. Safe to run again at any time.
#
# Secrets are read from Secret Manager into this shell's environment and handed to compose; they
# are never written to a file. The gate password is hashed inside a throwaway Caddy container.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

say "Secrets"
EKBILL_DB_PASSWORD="$(secret ekbill-db-password)"
[ -n "$EKBILL_DB_PASSWORD" ] || { echo "ekbill-db-password has no value. Run deploy/vm/setup.sh first."; exit 1; }
gate="$(secret ekbill-gate-password)"
[ -n "$gate" ] || { echo "ekbill-gate-password has no value. Run deploy/vm/setup.sh first."; exit 1; }
OPENAI_API_KEY="$(secret ekbill-openai-api-key)"
echo "database password: present; gate password: present; OpenAI key: $([ -n "$OPENAI_API_KEY" ] && echo present || echo 'not set (voice, Poocho answers and the contract model stay off)')"

EKBILL_GATE_HASH="$(printf '%s' "$gate" | docker run --rm -i caddy:2 sh -c 'caddy hash-password --plaintext "$(cat)"')"
unset gate
EKBILL_DOMAIN="$(domain)"
[ -n "$EKBILL_DOMAIN" ] || { echo "Could not work out a domain. Set EKBILL_DOMAIN or write it to deploy/vm/domain."; exit 1; }
export EKBILL_DB_PASSWORD OPENAI_API_KEY EKBILL_GATE_HASH EKBILL_DOMAIN
echo "domain: $EKBILL_DOMAIN"

say "Build and start (compose project ekbill)"
"${COMPOSE[@]}" up -d --build --remove-orphans
"${COMPOSE[@]}" ps

say "Waiting for the app"
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then break; fi
  sleep 3
done
curl -sS http://127.0.0.1:8080/api/health; echo

say "Public address"
echo "https://$EKBILL_DOMAIN  (user: ${EKBILL_GATE_USER:-ekbill}; password: gcloud secrets versions access latest --secret=ekbill-gate-password)"
echo "The first HTTPS request can take ~30s while Caddy gets the certificate."
