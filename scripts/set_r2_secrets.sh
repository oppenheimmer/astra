#!/usr/bin/env bash
# Copy the local R2 credentials into the GitHub repository secrets that
# .github/workflows/refresh-satellites.yml reads.
#
# There is no credentials file in the repository and there must not be: the
# scheduled job runs on GitHub's runners, so it reads repository secrets, not
# anything committed here. This script is the bridge between the two, and the
# thing to re-run whenever the R2 token is rotated.
#
# The local file is git-ignored by the .env* rule. Format is dotenv, one
# KEY=value per line, matching what the sync script expects:
#
#   R2_ACCOUNT_ID=7d1c1a97b6a4dd9337e17e4072bdba64
#   AWS_ACCESS_KEY_ID=<access key id from the R2 API token>
#   AWS_SECRET_ACCESS_KEY=<secret access key from the same token>
#
# The token must be scoped to the sky-data bucket with object read and write.
#
#   ./scripts/set_r2_secrets.sh [path-to-env-file]
set -euo pipefail

FILE="${1:-.env/r2}"
REPO="${GH_REPO:-oppenheimmer/astra}"

cd "$(dirname "$0")/.."
if [ ! -f "$FILE" ]; then
    echo "No credentials file at $FILE." >&2
    echo "Create it with R2_ACCOUNT_ID, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY." >&2
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$FILE"
set +a

: "${R2_ACCOUNT_ID:?$FILE is missing R2_ACCOUNT_ID}"
: "${AWS_ACCESS_KEY_ID:?$FILE is missing AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?$FILE is missing AWS_SECRET_ACCESS_KEY}"

# Catches a pasted placeholder or a wrong field before it becomes a workflow
# failure whose log masks the value and so cannot show what went wrong.
if ! printf '%s' "$R2_ACCOUNT_ID" | grep -Eq '^[0-9a-f]{32}$'; then
    echo "R2_ACCOUNT_ID is not a 32-character hex account id." >&2
    exit 1
fi

for name in R2_ACCOUNT_ID AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
    # gh secret set reads the value from stdin when --body is omitted. Passing
    # "--body -" would store the literal string "-", which fails later as an
    # unhelpful "Invalid endpoint" with the value masked.
    value="${!name}"
    printf '%s' "$value" | gh secret set "$name" --repo "$REPO"
    # Length only: enough to spot a truncated paste, never the value itself.
    printf '  set %-24s (%d characters)\n' "$name" "${#value}"
done

echo "Done. Verify with: gh workflow run refresh-satellites.yml --repo $REPO"
