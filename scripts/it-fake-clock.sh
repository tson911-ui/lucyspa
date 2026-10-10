#!/usr/bin/env bash
# Proof that the integration suite does not depend on WHEN it runs (Owner, 2026-10-10): the whole auth integration suite on a freshly
# migrated throw-away database whose clock AND the test process clock start at a chosen Asia/Ho_Chi_Minh time.
#
#   bash scripts/it-fake-clock.sh <HH:MM> [days]     e.g.  06:00   13:00   19:30   23:50     or  13:00 30  (30 days later)
#
# How: a throw-away Postgres container with libfaketime (the monotonic clock is NOT faked) on port 5433, and a Date shift in the test process
# (the clock is only ever moved BACK for a time of day, or forward by whole days). Scratch only: the database name is `lucy_spa_clock_*_scratch`.
# The race suites (`*.race.*`) are NOT run here: libfaketime inside Postgres makes `statement_timeout` fire early under concurrent load even with a
# fake offset of one minute (measured: the same race suites pass 27/27 on a plain container and fail 5 of 27 with libfaketime). They are
# concurrency tests with no time-of-day logic and run at the real clock in CI.
set -u
export MSYS_NO_PATHCONV=1
TARGET=${1:?usage: it-fake-clock.sh HH:MM [days]}
DAYS=${2:-0}
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd -W 2>/dev/null || pwd) # a Windows path (D:/...) under Git Bash, so Node can read the file URLs below
LABEL=$(echo "$TARGET" | tr -d ':')_d$DAYS
DB=lucy_spa_clock_${LABEL}_scratch
NAME=lucy-faketime-$LABEL
PORT=${FAKETIME_PG_PORT:-5433}

docker image inspect lucy-pg-ft-alpine > /dev/null 2>&1 || printf 'FROM postgres:17-alpine\nRUN apk add --no-cache libfaketime\n' | docker build -q -t lucy-pg-ft-alpine - > /dev/null || exit 2

OFFSET_MIN=$(node -e '
  const [h, m] = process.argv[1].split(":").map(Number);
  const now = new Date();
  const local = (now.getUTCHours() * 60 + now.getUTCMinutes() + 420) % 1440; // Vietnam is UTC+7
  console.log(((local - (h * 60 + m) + 1440) % 1440) - 1440 * Number(process.argv[2]));' "$TARGET" "$DAYS")
SIGN=-; [ "$OFFSET_MIN" -lt 0 ] && SIGN=+
ABS=${OFFSET_MIN#-}

U=$(docker exec lucy-spa-postgres-1 printenv POSTGRES_USER)
P=$(docker exec lucy-spa-postgres-1 printenv POSTGRES_PASSWORD)
docker rm -f "$NAME" > /dev/null 2>&1
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:5432" -e POSTGRES_USER="$U" -e POSTGRES_PASSWORD="$P" \
  -e FAKETIME="${SIGN}${ABS}m" -e FAKETIME_DONT_FAKE_MONOTONIC=1 --entrypoint sh lucy-pg-ft-alpine \
  -c "LD_PRELOAD=/usr/lib/faketime/libfaketime.so.1 exec docker-entrypoint.sh postgres" > /dev/null || exit 3
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U "$U" > /dev/null 2>&1 && break; sleep 2; done
sleep 3
docker exec "$NAME" sh -c "createdb -U \"\$POSTGRES_USER\" $DB" || exit 4
eval "$(node scripts/scratch-db-env.mjs "$DB")" || exit 5
export DATABASE_URL="${DATABASE_URL/:5432\//:${PORT}/}"
case "${DATABASE_URL##*/}" in lucy_spa_clock_*_scratch) ;; *) echo "wrong database"; exit 6;; esac
echo "target=$TARGET days=$DAYS offset_min=$OFFSET_MIN database=${DATABASE_URL##*/}"
pnpm db:deploy 2>&1 | tail -1

# The same entry point without the race suites, with absolute imports so it can live outside scripts/.
mkdir -p .local
ENTRY=$(mktemp .local/it-no-race-XXXXXX.mjs)
grep -v '\.race\.' scripts/test-auth-integration.mjs | sed "s#'\\.\\./#'file://${ROOT}/#" > "$ENTRY"
SHIFT_FILE=$(mktemp .local/shift-date-XXXXXX.mjs)
printf '%s\n' \
  'const shift = Number(process.env.SHIFT_MIN ?? "0") * 60_000;' \
  'const RealDate = Date;' \
  'class ShiftedDate extends RealDate {' \
  '  constructor(...args) { if (args.length === 0) super(RealDate.now() - shift); else super(...args); }' \
  '  static now() { return RealDate.now() - shift; }' \
  '}' \
  'globalThis.Date = ShiftedDate;' > "$SHIFT_FILE"
export SHIFT_MIN=$OFFSET_MIN
export NODE_OPTIONS="--import file://${ROOT}/${SHIFT_FILE}"
node "$ENTRY"
CODE=$?
rm -f "$ENTRY" "$SHIFT_FILE"
docker rm -f "$NAME" > /dev/null 2>&1
exit $CODE
