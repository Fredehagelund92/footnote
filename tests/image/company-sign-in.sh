#!/usr/bin/env bash
# Company sign-in on a real OpenID Connect provider: the service image in production mode, set up
# as docs/run-in-production.md ("Run the image in production mode") and docs/company-sign-in.md say,
# signs people in through Keycloak, in a browser (the CI job "Docker images: build, and boot the
# service in production mode"). Build the images and install Chromium first:
#
#   docker compose build && npx playwright install chromium && bash tests/image/company-sign-in.sh
#
# Keycloak serves an invented realm, footnote-demo (tests/image/keycloak/footnote-demo-realm.json),
# with a confidential client and five demo people. Both Keycloak and Footnote are on https, with
# certificates from a certificate authority made for this run: the service trusts it through
# NODE_EXTRA_CA_CERTS, as a company's own authority would be trusted. Caddy is the TLS proxy in
# front (tests/image/keycloak/Caddyfile). The browser reaches both names on this computer:
# https://footnote.example.test:8443 and https://login.example.test:9443.
#
# The browser's steps are in tests/image/company-sign-in-check.ts. Everything it makes is named
# footnote-oidc-<pid> and removed at the end. FOOTNOTE_SERVICE_IMAGE and FOOTNOTE_WEB_IMAGE name
# other images; FOOTNOTE_OIDC_SUBNET (three octets) moves its private network.
set -euo pipefail

service_image=${FOOTNOTE_SERVICE_IMAGE:-footnote-footnote}
web_image=${FOOTNOTE_WEB_IMAGE:-footnote-web}
subnet=${FOOTNOTE_OIDC_SUBNET:-172.31.214}
keycloak_image=quay.io/keycloak/keycloak:26.8.1@sha256:3f3c5f8e03c614774b4bd9173b88391fefa4153bfc010d8012d59ad825377332
caddy_image=caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
postgres_image=postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336
run=footnote-oidc-$$
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
public_origin=https://footnote.example.test:8443
issuer=https://login.example.test:9443/realms/footnote-demo
proxy_ip=$subnet.30

passed=false
cleanup() {
  if [ "$passed" != true ]; then
    for name in keycloak service web proxy; do
      echo "::group::$name log"
      docker logs "$run-$name" 2>&1 | tail -n 150 || true
      echo "::endgroup::"
    done
  fi
  docker rm -f "$run-keycloak" "$run-service" "$run-web" "$run-proxy" "$run-db" > /dev/null 2>&1 || true
  docker volume rm "$run-keys" > /dev/null 2>&1 || true
  docker network rm "$run" > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
fail() {
  echo "not ok - $1" >&2
  exit 1
}

# A certificate authority for this run, and a certificate from it for each name.
certs=$work/certs
mkdir -p "$certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=Footnote demo company CA' \
  -keyout "$certs/ca-key.pem" -out "$certs/ca.pem" 2> /dev/null
for name in login footnote; do
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$name.example.test" \
    -keyout "$certs/$name-key.pem" -out "$certs/$name.csr" 2> /dev/null
  printf 'subjectAltName=DNS:%s.example.test\nextendedKeyUsage=serverAuth\n' "$name" > "$certs/$name.ext"
  openssl x509 -req -in "$certs/$name.csr" -CA "$certs/ca.pem" -CAkey "$certs/ca-key.pem" \
    -CAcreateserial -days 1 -extfile "$certs/$name.ext" -out "$certs/$name.pem" 2> /dev/null
done
rm "$certs/ca-key.pem"
# Read inside the containers by users other than this one.
chmod 755 "$certs"
chmod 644 "$certs"/*

# The realm, with a client secret and the demo people's password made for this run.
secret=$(openssl rand -hex 24)
password=$(openssl rand -hex 12)
mkdir -p "$work/import"
sed -e "s/CLIENT_SECRET/$secret/" -e "s/DEMO_PASSWORD/$password/" \
  "$root/tests/image/keycloak/footnote-demo-realm.json" > "$work/import/footnote-demo-realm.json"
chmod 755 "$work/import"
chmod 644 "$work/import/footnote-demo-realm.json"

docker network create --subnet "$subnet.0/24" "$run" > /dev/null ||
  fail "the private network $subnet.0/24 is made (FOOTNOTE_OIDC_SUBNET moves it)"

docker run -d --name "$run-keycloak" --network "$run" --network-alias login.example.test \
  -p 127.0.0.1:9443:9443 -v "$certs:/certs:ro" -v "$work/import:/opt/keycloak/data/import:ro" \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e "KC_BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -hex 12)" \
  "$keycloak_image" start-dev --import-realm --http-enabled=false --https-port=9443 \
  --https-certificate-file=/certs/login.pem --https-certificate-key-file=/certs/login-key.pem \
  --hostname=https://login.example.test:9443 > /dev/null
docker run -d --name "$run-db" --network "$run" -e POSTGRES_HOST_AUTH_METHOD=trust "$postgres_image" > /dev/null

for _ in $(seq 180); do
  if curl --fail --silent --cacert "$certs/ca.pem" --resolve login.example.test:9443:127.0.0.1 \
    "$issuer/.well-known/openid-configuration" > /dev/null 2>&1; then break; fi
  sleep 1
done
curl --fail --silent --show-error --cacert "$certs/ca.pem" --resolve login.example.test:9443:127.0.0.1 \
  "$issuer/.well-known/openid-configuration" > /dev/null || fail 'Keycloak serves the realm within three minutes'
echo 'ok - Keycloak serves the footnote-demo realm on https'
docker exec "$run-db" pg_isready -h 127.0.0.1 -U postgres > /dev/null || fail 'PostgreSQL is ready'

database=(
  -e "DATABASE_URL_BOOTSTRAP=postgres://postgres@$run-db:5432/postgres"
  -e "DATABASE_URL_MIGRATE=postgres://context_layer_owner@$run-db:5432/footnote"
  -e "DATABASE_URL=postgres://context_layer_api@$run-db:5432/footnote"
)

# docs/run-in-production.md, step 2: the keys, once, in the volume that keeps them. And
# docs/company-sign-in.md, step 3: the client secret in a file only the service's user may read.
docker volume create "$run-keys" > /dev/null
docker run --rm -v "$run-keys:/var/lib/footnote" "$service_image" npm run --silent keys:create
printf %s "$secret" | docker run --rm -i -v "$run-keys:/var/lib/footnote" "$service_image" \
  sh -c 'umask 077 && cat > /var/lib/footnote/oidc-secret'

docker run -d --name "$run-service" --network "$run" --network-alias service "${database[@]}" \
  -v "$run-keys:/var/lib/footnote" -v "$certs/ca.pem:/certs/ca.pem:ro" \
  -e NODE_EXTRA_CA_CERTS=/certs/ca.pem \
  -e "MCP_RESOURCE_URL=$public_origin/mcp" \
  -e "FOOTNOTE_WEB_ORIGINS=$public_origin" \
  -e FOOTNOTE_SECRETS_DIR=/var/lib/footnote/secrets \
  -e "FOOTNOTE_TRUSTED_PROXIES=$proxy_ip" \
  -e FOOTNOTE_AUTH=oidc \
  -e "FOOTNOTE_OIDC_ISSUER=$issuer" \
  -e FOOTNOTE_OIDC_CLIENT_ID=footnote \
  -e FOOTNOTE_OIDC_CLIENT_SECRET_FILE=/var/lib/footnote/oidc-secret \
  -e FOOTNOTE_OIDC_ADMIN_GROUPS=footnote-admins \
  -e FOOTNOTE_OIDC_MEMBER_GROUPS=footnote-members \
  -e FOOTNOTE_OIDC_NAME=Keycloak \
  "$service_image" > /dev/null
docker run -d --name "$run-web" --network "$run" --network-alias web \
  -e FOOTNOTE_API_URL=http://service:3000 "$web_image" > /dev/null
docker run -d --name "$run-proxy" --network "$run" --ip "$proxy_ip" -p 127.0.0.1:8443:8443 \
  -v "$root/tests/image/keycloak/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$certs:/certs:ro" \
  "$caddy_image" > /dev/null

for _ in $(seq 180); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' "$run-service")" = healthy ]; then break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$run-service")" != true ]; then break; fi
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$run-service")" = healthy ] ||
  fail "the service starts in production mode with Keycloak"$'\n'"$(docker logs "$run-service" 2>&1 | tail -n 50)"
echo 'ok - the service starts in production mode, with Keycloak as its provider'

# docs/company-sign-in.md, step 4: the first admin, invited from the command line once the
# service has applied the schema.
link=$(docker run --rm --network "$run" -e "FOOTNOTE_WEB_ORIGINS=$public_origin" \
  -e "DATABASE_URL_MIGRATE=postgres://context_layer_owner@$run-db:5432/footnote" \
  "$service_image" npm run --silent footnote -- invite noor.haddad@example.test --admin |
  grep -o "$public_origin/[^ ]*invite=[^ ]*" | head -n 1) || true
[ -n "$link" ] || fail 'footnote invite prints the first admin an invite link'
echo 'ok - footnote invite prints the first admin an invite link'

(cd "$root" && PUBLIC_ORIGIN=$public_origin INVITE_LINK=$link DEMO_PASSWORD=$password \
  node tests/image/company-sign-in-check.ts)

log=$(docker logs "$run-service" 2>&1)
grep -q '"nodeEnv":"production"' <<< "$log" || fail 'the service ran in production mode'
if grep -q 'people picker' <<< "$log"; then fail 'production has no people picker'; fi
if grep -qF "$password" <<< "$log$(docker logs "$run-proxy" 2>&1)$(docker logs "$run-web" 2>&1)"; then
  fail 'no log keeps the password'
fi

passed=true
echo 'Company sign-in works through Keycloak.'
