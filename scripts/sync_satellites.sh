#!/usr/bin/env bash
# Refresh the orbital-element snapshot and publish it to Cloudflare R2.
#
# One full cycle: pull the previous per-group files down, ask CelesTrak for
# anything newer, merge, push the result back up. Run on a schedule by
# .github/workflows/refresh-satellites.yml, and runnable by hand for a manual
# refresh or to bootstrap an empty prefix.
#
# The previous files matter. CelesTrak answers 403 when the caller already holds
# the newest elements for a group, so a run that fetches nothing new still has to
# republish the group it could not refresh. Pulling them down first is what makes
# a partial refresh safe.
#
# The bucket is shared with the earth project, which owns the keys at the root;
# everything here lives under the astra/ prefix and touches nothing else.
#
# Cache-Control is set explicitly on every object, and must stay that way. The
# Worker in front of this bucket falls back to a one-year immutable policy for
# any key it is not told about, which would pin a refreshing dataset in caches
# until the URL changed.
#
# R2 is S3-compatible, so this uses the AWS CLI (preinstalled on GitHub runners;
# locally: pip install awscli). Required environment:
#
#   R2_ACCOUNT_ID             Cloudflare account id
#   AWS_ACCESS_KEY_ID         R2 API token key
#   AWS_SECRET_ACCESS_KEY     R2 API token secret
#   R2_BUCKET                 bucket name, default "earth-data"
#   R2_PREFIX                 key prefix, default "astra"
#
# Locally the ids can come from the earth project's git-ignored file, which is
# the same R2 token this uses:
#   set -a && source ~/Desktop/work/earth/.env/r2 && set +a && ./scripts/sync_satellites.sh
set -euo pipefail

: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}"
: "${AWS_ACCESS_KEY_ID:?set AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?set AWS_SECRET_ACCESS_KEY}"
BUCKET="${R2_BUCKET:-earth-data}"
PREFIX="${R2_PREFIX:-astra}"

# A wrong account id otherwise surfaces much later as "Invalid endpoint" with the
# value masked in CI logs, which says nothing about which secret is at fault.
if ! printf '%s' "$R2_ACCOUNT_ID" | grep -Eq '^[0-9a-f]{32}$'; then
    echo "R2_ACCOUNT_ID is not a 32-character hex account id (got ${#R2_ACCOUNT_ID} characters)." >&2
    exit 1
fi
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
PYTHON="${PYTHON:-python3}"

cd "$(dirname "$0")/.."
WORK="build/satellites"
mkdir -p "$WORK/source"

# 30 minutes: long enough that the CDN absorbs the browser's ten-minute poll,
# short enough that a scheduled refresh reaches clients the same hour.
CACHE_CONTROL="public, max-age=1800, must-revalidate"
s3() { aws s3 "$@" --endpoint-url "$ENDPOINT" --only-show-errors; }

echo "Pulling previous state from s3://${BUCKET}/${PREFIX}/source/"
if s3 sync "s3://${BUCKET}/${PREFIX}/source/" "$WORK/source/"; then
    echo "  pulled $(find "$WORK/source" -name '*.json' | wc -l) previous file(s)"
else
    # Reachable but empty is a first run; unreachable is not, and the refresh
    # below would then quietly fall back to the bundled copies for everything.
    echo "  could not read the prefix" >&2
    exit 1
fi

echo "Refreshing from CelesTrak"
"$PYTHON" scripts/refresh_satellites.py --dir "$WORK"

echo "Publishing to s3://${BUCKET}/${PREFIX}/"
for f in "$WORK/satellites.json" "$WORK"/source/*.json; do
    [ -e "$f" ] || continue
    key="${PREFIX}/${f#"$WORK/"}"
    s3 cp "$f" "s3://${BUCKET}/${key}" \
        --content-type "application/json" \
        --cache-control "$CACHE_CONTROL"
    awk -v k="$key" -v b="$(wc -c < "$f")" \
        'BEGIN {printf "  %-34s %6.2f MB\n", k, b/1048576}'
done
echo "Done."
