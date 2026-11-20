#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
    echo "Usage: $0 <first name> <last name> <email address>"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

PROFILE_DATA=$(node -e 'process.stdout.write(JSON.stringify({ firstName: process.argv[1], lastName: process.argv[2] }))' -- "$1" "$2")

exec npx auth create-admin --config "$SCRIPT_DIR/../auth.js" --email "$3" --name "$1 $2" --data "$PROFILE_DATA"
