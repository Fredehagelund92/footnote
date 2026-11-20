#!/usr/bin/env bash
# The README's "Try it" commands, typed as written, on a computer with Docker and nothing else
# running Footnote (the CI job "The README's Quick start on Linux, as written"). Run it from a checkout,
# after npm ci and npx playwright install chromium:
#
#   bash tests/image/quick-start.sh
#
# It reads the commands from the README's first sh block under "## Try it" (indented, inside a
# numbered list) and checks, in this order:
#   1. The clone address answers, and the clone makes the folder the README changes into. The
#      clone is of this checkout, so it runs the code under test.
#   2. `docker compose up`, in the foreground, builds the images and loads the demo; it then
#      answers on http://localhost:8080. The time it took is printed: the README says it can take
#      ten minutes.
#   3. In a browser: it opens as Ravi Kapoor (the README says "You are Ravi Kapoor"), Ask answers
#      Checked with the customs rule first, View as switches to Jon Abara and Maria Lindqvist,
#      and Sign out shows every demo person (tests/e2e-seed/demo.spec.ts). Then the first page,
#      the Context list and a scripted answer are timed (scripts/time-demo.ts).
#   4. The MCP address the README connects Claude Code to asks for sign-in.
#   5. Ctrl+C stops it (the README says so), and `docker compose down --volumes` removes the data.
#   6. FOOTNOTE_WEB_PORT=8081 FOOTNOTE_PORT=3001 in front of docker compose moves both ports.
#
# View as, Sign out, `docker compose down --volumes`, the moved ports and the MCP address are not
# in the "Try it" steps: docs/try-the-demo.md and the old Quick start promised them, and this
# script keeps checking them.
#
# It uses the ports 8080, 3000, 8081 and 3001, and the compose project footnote: stop anything else
# there first. Everything it makes is removed at the end, the images included.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
fail() {
  echo "not ok - $1" >&2
  exit 1
}

# The README's first sh block under "## Try it", without the indent of the list it sits in.
block=$(awk '
  /^## / { inside = ($0 == "## Try it") }
  inside && /^ *```sh$/ { reading = 1; next }
  reading && /^ *```$/ { exit }
  reading { sub(/^ +/, ""); print }
' "$root/README.md")
[ "$(wc -l <<< "$block")" -eq 2 ] || fail "the Try it block is two commands"$'\n'"$block"
clone=$(sed -n 1p <<< "$block")
up=$(sed -n 2p <<< "$block")
[[ $clone =~ ^git\ clone\ ([^ ]+)\ \&\&\ cd\ ([^ ]+)$ ]] ||
  fail "the first command clones and changes into the clone: $clone"
url=${BASH_REMATCH[1]}
folder=${BASH_REMATCH[2]}
[ "$up" = 'docker compose up' ] || fail "the second command is docker compose up: $up"

project=$work/$folder
up_pid=
stop() { # Ctrl+C, as a person presses it in the terminal running docker compose up
  [ -n "$up_pid" ] || return 0
  kill -INT -- "-$up_pid" 2> /dev/null || true
  for _ in $(seq 120); do
    kill -0 "$up_pid" 2> /dev/null || break
    sleep 1
  done
  if kill -0 "$up_pid" 2> /dev/null; then return 1; fi
  wait "$up_pid" || true
  up_pid=
}
cleanup() {
  stop || true
  if [ -d "$project" ]; then
    (cd "$project" && docker compose down --volumes --rmi local > /dev/null 2>&1) || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

# Started as a job of its own, in a process group of its own, so a SIGINT to the group reaches it
# as Ctrl+C would: a shell without job control starts background commands deaf to SIGINT.
start() { # log file, then the environment to start with
  local log=$1
  shift
  set -m
  (cd "$project" && exec env "$@" docker compose up < /dev/null > "$log" 2>&1) &
  up_pid=$!
  set +m
}
ready() { # web port, log file: seconds until the demo answers there
  local port=$1 log=$2 started=$SECONDS
  for _ in $(seq 1500); do
    kill -0 "$up_pid" 2> /dev/null || fail "docker compose up kept running"$'\n'"$(tail -n 100 "$log")"
    if curl --fail --silent "http://127.0.0.1:$port/api/v1/auth/people" 2> /dev/null |
      jq -e 'length > 0' > /dev/null 2>&1 && grep -q 'Loaded the demo' "$log"; then
      echo $((SECONDS - started))
      return 0
    fi
    sleep 1
  done
  fail "the demo answers on port $port within 25 minutes"$'\n'"$(tail -n 100 "$log")"
}

# 1. The clone.
git ls-remote --exit-code "$url" HEAD > /dev/null || fail "the clone address answers: $url"
(cd "$work" && eval "${clone/"$url"/"file://$root"}" && [ "$(pwd)" = "$project" ]) ||
  fail "the clone makes the folder $folder and changes into it"
[ -f "$project/compose.yaml" ] || fail "the clone has compose.yaml"
echo "ok - $url answers, and the clone makes $folder"

# 2. The first start.
start "$work/up.log"
first=$(ready 8080 "$work/up.log")
curl --fail --silent --show-error http://localhost:8080/ > /dev/null || fail 'http://localhost:8080 opens'
echo "ok - docker compose up built the images and loaded the demo in $first seconds"
printf '### The Quick start on this runner\n\n- First start, building the images and loading the demo: %s s\n' \
  "$first" >> "$summary"

# 3. In a browser, then timed.
(cd "$root" && PW_SEED_BASE_URL=http://localhost:8080 npx playwright test -c playwright.seed.config.ts \
  tests/e2e-seed/demo.spec.ts) || fail 'the demo opens as Ravi Kapoor, View as and Sign out work'
echo 'ok - it opens as Ravi Kapoor, View as switches, and Sign out shows everyone'
(cd "$root" && node scripts/time-demo.ts http://localhost:8080 5) || fail 'the demo is timed in a browser'

# 4. The address `claude mcp add` is given asks an agent to sign in, and names where.
headers=$(curl --silent --output /dev/null --dump-header - --request POST http://localhost:3000/mcp)
grep -q '^HTTP/[0-9.]* 401' <<< "$headers" || fail "http://localhost:3000/mcp asks for sign-in"$'\n'"$headers"
grep -qi '^www-authenticate:.*resource_metadata="http://localhost:3000/' <<< "$headers" ||
  fail "http://localhost:3000/mcp says where to sign in"$'\n'"$headers"
echo 'ok - http://localhost:3000/mcp asks an agent to sign in'

# 5. Ctrl+C, then docker compose down --volumes.
stop || fail "Ctrl+C stops docker compose up"$'\n'"$(tail -n 50 "$work/up.log")"
running=$(cd "$project" && docker compose ps --quiet --status running)
[ -z "$running" ] || fail 'Ctrl+C stops every container'
(cd "$project" && docker compose down --volumes)
volumes=$(docker volume ls --quiet --filter label=com.docker.compose.project=footnote)
[ -z "$volumes" ] || fail "docker compose down --volumes removes the data: $volumes"
echo 'ok - Ctrl+C stops it, and docker compose down --volumes removes the data'

# 6. Both ports moved, on the images the first start built.
start "$work/moved.log" FOOTNOTE_WEB_PORT=8081 FOOTNOTE_PORT=3001
again=$(ready 8081 "$work/moved.log")
if curl --silent --max-time 2 http://127.0.0.1:8080/ > /dev/null; then fail 'nothing answers on 8080 then'; fi
headers=$(curl --silent --output /dev/null --dump-header - --request POST http://localhost:3001/mcp)
grep -qi '^www-authenticate:.*resource_metadata="http://localhost:3001/' <<< "$headers" ||
  fail "agents connect to port 3001"$'\n'"$headers"
echo "ok - the ports move to 8081 and 3001, and a start on built images loaded the demo in $again seconds"
printf -- '- A start on built images, loading the demo into a new database: %s s\n\n' "$again" >> "$summary"
stop || fail 'Ctrl+C stops it again'
(cd "$project" && docker compose down --volumes)

echo 'The Quick start works as the README says.'
