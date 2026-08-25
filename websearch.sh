#!/usr/bin/env bash
# websearch.sh — live web search using ONLY an OpenRouter API key.
#
# How it works: OpenRouter's ":online" suffix enables their server-side web
# plugin (Exa-powered) on any chat model, so the model retrieves current web
# results and cites sources — no DeepSeek key needed.
#
# The key is read from DSH's credential store (~/.dsh/.credentials.yaml) and is
# never printed or logged by this script.
#
# Usage:
#   ./websearch.sh "your search question here"
#   echo "question" | ./websearch.sh            # reads query from stdin
#   QUERY_MODEL=openai/gpt-4o-mini ./websearch.sh "..."   # override base model

set -euo pipefail

QUERY="${*:-}"
if [[ -z "$QUERY" && ! -t 0 ]]; then
  QUERY="$(cat)"
fi
if [[ -z "$QUERY" ]]; then
  echo "usage: ./websearch.sh \"your question\"" >&2
  exit 1
fi

CRED="${CRED_FILE:-$HOME/.dsh/.credentials.yaml}"
KEY="$(awk '/OPENROUTER_API_KEY:/{print $2; exit}' "$CRED")"
if [[ -z "$KEY" ]]; then
  echo "error: OPENROUTER_API_KEY not found in $CRED" >&2
  exit 1
fi

MODEL="${QUERY_MODEL:-stealth/ox-alpha}:online"

PAYLOAD="$(jq -n \
  --arg model "$MODEL" \
  --arg q "$QUERY" \
  '{
    model: $model,
    messages: [
      { role: "system",
        content: "You are a web research assistant with live web access. Search thoroughly, then answer concisely (max ~300 words). Cite sources as inline markdown links [title](url)." },
      { role: "user", content: $q }
    ]
  }')"

RESPONSE="$(curl -sS --max-time 90 https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")"

# Print the assistant's answer, or the API error if one occurred.
jq -r '.choices[0].message.content // ("API error: " + (.error.message | tostring))' <<<"$RESPONSE"
