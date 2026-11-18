#!/usr/bin/env bash
# Run from the repository, with `docker compose up` already running the demo: the service image has
# git, and Markdown in Git against a public repository (Heed's own, at a commit of main) passes Test
# connection, and its first read makes one suggestion. The folder holds one Markdown file, about
# Gross margin, a metric of the demo.
set -euo pipefail

port=${FOOTNOTE_WEB_PORT:-8080}
web=http://127.0.0.1:$port
# The address compose.yaml lets a browser write from.
origin=http://localhost:$port
repository=https://github.com/Fredehagelund92/footnote.git
# A commit of main, so what is read never changes.
commit=4dde3939639966419666398d40c59fae66e38dbb
folder=tests/fixtures/dbt-metricflow/project/models/marts
fail() {
  echo "not ok - $1" >&2
  exit 1
}

docker compose exec -T footnote git --version > /dev/null || fail 'the service image has git'

cookies=$(mktemp)
trap 'rm -f "$cookies"' EXIT
csrf=$(curl --fail --silent --show-error --cookie-jar "$cookies" --header 'x-footnote-csrf: dev-sign-in' \
  --header "origin: $origin" --header 'content-type: application/json' \
  --data '{"email":"per_ravi@example.test"}' "$web/api/v1/auth/sign-in" |
  node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).csrfToken')
call() {
  curl --fail-with-body --silent --show-error --cookie "$cookies" --header "x-footnote-csrf: $csrf" \
    --header "origin: $origin" --header 'content-type: application/json' \
    --header "idempotency-key: $(node -p 'crypto.randomUUID()')" "$@"
}
config="{\"repository\":\"$repository\",\"ref\":\"$commit\",\"folder\":\"$folder\"}"

tested=$(call --data "{\"type\":\"git-markdown\",\"config\":$config,\"secrets\":{}}" \
  "$web/api/v1/sources/test") || fail "Test connection answers: $tested"
node -e '
  const check = JSON.parse(process.argv[1])
  const steps = check.steps.map((step) => step.id + ":" + step.status).join(" ")
  if (!check.ok || steps !== "reach:ok folders:warning documents:ok") process.exit(1)
' "$tested" || fail "Test connection passes: $tested"

added=$(call --data "{\"type\":\"git-markdown\",\"name\":\"Heed's fixtures\",\"config\":$config,\"secrets\":{},\"scopes\":[{\"id\":\".\",\"title\":\"$folder\",\"domain\":\"area_sales\"}],\"reason\":\"Checking Markdown in Git in the image\"}" \
  "$web/api/v1/sources") || fail "the source is added: $added"
id=$(node -pe 'JSON.parse(process.argv[1]).id' "$added")
call --request POST --data '{}' "$web/api/v1/sources/$id/read" > /dev/null || fail 'Read again starts a read'

for _ in $(seq 1 60); do
  activity=$(call "$web/api/v1/sources/$id/activity")
  node -e 'process.exit(JSON.parse(process.argv[1]).reads.length ? 0 : 1)' "$activity" && break
  sleep 2
done
node -e '
  const [read] = JSON.parse(process.argv[1]).reads
  if (read?.status !== "ok" || read.documents?.suggested !== 1) process.exit(1)
' "$activity" || fail "the read makes one suggestion: $activity"

call --request POST --data '{"reason":"Checked Markdown in Git"}' \
  "$web/api/v1/sources/$id/disconnect" > /dev/null || fail 'the source is removed'
echo 'ok - Markdown in Git reads a public repository in the image'
