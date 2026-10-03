#!/bin/bash
# Build a throwaway, fully-fake dataset for the demo GIF. No real ~/.claude data.
set -eu
BASE=/private/tmp/acmdemo
rm -rf "$BASE"
mkdir -p "$BASE/code" "$BASE/.claude/projects" "$BASE/.config"

# ── fake project dirs (shown in New) ──
for d in web-app api-gateway design-system mobile-app marketing-site infra-terraform; do
  mkdir -p "$BASE/code/$d"
done

# ── shared config (New groups + tools) ──
cat > "$BASE/config.toml" <<TOML
default_tool = "claude"

[[group]]
name  = "Projects"
path  = "$BASE/code"
color = "#6C91BF"

[[tool]]
name  = "claude"
runs  = "claude --dangerously-skip-permissions"
label = " ⚡ Projects "
color = "#6C91BF"

[[tool]]
name  = "cdx"
runs  = "codex --dangerously-bypass-approvals-and-sandbox"
label = " ✦ Codex "
color = "#A855F7"

[gui]
terminal = "default"
TOML

# ── fake resumable sessions ──  args: <proj> <uuid> <minutes-ago> <prompt> <a1> <u2> <a2>
mksession() {
  local proj="$1" id="$2" mins="$3" prompt="$4" a1="$5" u2="$6" a2="$7"
  local cwd="$BASE/code/$proj"
  local enc="${cwd//\//-}"               # /a/b -> -a-b  (Claude Code's dash encoding)
  local dir="$BASE/.claude/projects/$enc"
  mkdir -p "$dir"
  local ts; ts=$(( ($(date +%s) - mins*60) * 1000 ))
  {
    printf '{"type":"user","timestamp":%s,"message":{"role":"user","content":%s}}\n' "$ts" "$(printf '%s' "$prompt" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"
    printf '{"type":"assistant","timestamp":%s,"message":{"role":"assistant","content":[{"type":"text","text":%s}]}}\n' "$((ts+9000))" "$(printf '%s' "$a1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"
    printf '{"type":"user","timestamp":%s,"message":{"role":"user","content":%s}}\n' "$((ts+60000))" "$(printf '%s' "$u2" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"
    printf '{"type":"assistant","timestamp":%s,"message":{"role":"assistant","content":[{"type":"text","text":%s}]}}\n' "$((ts+72000))" "$(printf '%s' "$a2" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"
  } > "$dir/$id.jsonl"
  # set mtime so Resume sorts newest-first and ages look real
  touch -t "$(date -v-"${mins}"M +%Y%m%d%H%M.%S)" "$dir/$id.jsonl"
}

mksession web-app        a1b2c3d4-1111-4aaa-8000-000000000001 4    "Add a dark-mode toggle to the settings page" "I'll add a useColorScheme hook and a toggle bound to a persisted setting, starting with SettingsView." "Persist it across launches" "Done — stored in UserDefaults under \"appearance\" and read on launch; falls back to the system theme."
mksession api-gateway    b2c3d4e5-2222-4bbb-8000-000000000002 38   "Refactor the auth middleware to verify JWTs" "Swapped the session-cookie check for JWT verification with a shared secret + 15-min expiry and a refresh path." "Add rate limiting too" "Added a token-bucket limiter keyed by client id, 100 req/min, returning 429 with Retry-After."
mksession api-gateway    c3d4e5f6-3333-4ccc-8000-000000000003 122  "Wire up the Stripe webhook handler" "Verifying the signature with the webhook secret, then routing checkout.session.completed to fulfillment." "What about idempotency?" "Storing processed event ids in Redis with a 24h TTL so retries are no-ops."
mksession design-system  d4e5f6a7-4444-4ddd-8000-000000000004 305  "Tokenize the spacing scale and update Button" "Replaced the magic numbers with a 4pt spacing scale token set; Button now reads space.2 / space.3." "Document the tokens" "Added a Storybook page rendering every token with its px value and usage notes."
mksession mobile-app     e5f6a7b8-5555-4eee-8000-000000000005 1480 "Fix the flaky checkout E2E test" "Root cause was a race on the payment-sheet animation; replaced the fixed sleep with a wait-for-visible." "Run it 20x to confirm" "Ran 20 iterations green; also added a retry guard around the network stub setup."
mksession infra-terraform f6a7b8c9-6666-4fff-8000-000000000006 4320 "Add a staging VPC and RDS subnet group" "Added a /16 VPC with public+private subnets across two AZs and an RDS subnet group over the private ones." "Tag everything for cost" "Applied env=staging + owner tags via default_tags on the provider so every resource inherits them."

echo "built fake dataset at $BASE"
