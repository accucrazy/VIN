#!/usr/bin/env bash
# Fails (exit 1) if any forbidden secret/identifier appears in the repo.
set -u
ROOT="${1:-.}"
PATTERN='AIzaSy|sk-[A-Za-z0-9]{20,}|pplx-|BEGIN PRIVATE KEY|mcp-agent-a901f|focused-veld-378509|34\.81\.251\.90|firebase-adminsdk|cloudfunctions\.net|\.run\.app'
HITS=$(grep -rEnI "$PATTERN" "$ROOT" --exclude-dir=node_modules --exclude-dir=.git --exclude=secret-scan.sh 2>/dev/null)
if [ -n "$HITS" ]; then echo "SECRET-SCAN FAIL:"; echo "$HITS"; exit 1; fi
echo "SECRET-SCAN PASS"; exit 0
