#!/usr/bin/env bash
# CI wrapper for `pnpm test:auth:integration`: the same run and the same exit code, but a failure also leaves the failing test names and the
# first lines of their assertions in ONE annotation of the job (readable at api.github.com/.../check-runs/<job>/annotations without a
# login; the raw logs need one). Used only by .github/workflows/ci.yml.
set +e
pnpm test:auth:integration 2>&1 | tee auth-it.log
code=${PIPESTATUS[0]}
if [ "$code" != 0 ]; then
  summary=$({
    echo "UTC $(date -u +%H:%M)"
    grep -E '^ℹ (tests|pass|fail)' auth-it.log
    awk '/failing tests:/{f=1} f' auth-it.log | grep -vE '^[[:space:]]+at ' | head -80
  } | cut -c1-300)
  # Workflow commands need %, CR and LF escaped.
  summary=${summary//'%'/'%25'}
  summary=${summary//$'\r'/'%0D'}
  summary=${summary//$'\n'/'%0A'}
  echo "::error title=auth integration failures::${summary:0:30000}"
fi
exit "$code"
