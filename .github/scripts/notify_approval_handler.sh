#!/usr/bin/env bash
set -e

# ==============================================================================
# MS Teams Auto-Merge PR Approval Notification Handler
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/resolve_teams_webhooks.sh"

if [ "${#TARGET_WEBHOOKS[@]}" -eq 0 ]; then
  echo "ℹ️ No specific or fallback Teams webhook configured for '$DEPLOY_NAME'. Skipping notification."
  exit 0
fi

TIMESTAMP="${TIMESTAMP:-$(TZ='Asia/Kolkata' date +"%Y-%m-%d %I:%M %p IST")}"
REPO="${REPO:-$GITHUB_REPOSITORY}"
PR_URL="https://github.com/$REPO/pull/$PR_NUMBER"

if [ "$EVENT_NAME" = "pull_request_review" ] && [ "$REVIEW_STATE" = "approved" ]; then
  CARD_TITLE="🚀 $DEPLOY_NAME: PR Approved & Deployment Started"
  CARD_SUBTITLE="PR #$PR_NUMBER was approved by $REVIEWER. PR has been merged and SAP CI/CD deployment has started!"
  STATUS_TEXT="✅ Approved & Merged • Deployment Started"
  REVIEWER_LABEL="Approved By"
else
  CARD_TITLE="🚀 $DEPLOY_NAME: PR Merged & Deployment Started"
  CARD_SUBTITLE="PR #$PR_NUMBER was merged by $REVIEWER. SAP CI/CD deployment has started!"
  STATUS_TEXT="✅ Merged • Deployment Started"
  REVIEWER_LABEL="Merged By"
fi

PAYLOAD=$(jq -n \
  --arg title "$CARD_TITLE" \
  --arg subtitle "$CARD_SUBTITLE" \
  --arg status "$STATUS_TEXT" \
  --arg color "good" \
  --arg repo "$REPO" \
  --arg pr "PR #$PR_NUMBER" \
  --arg source "$HEAD_BRANCH" \
  --arg target "$BASE_BRANCH" \
  --arg reviewer "$REVIEWER" \
  --arg reviewer_label "$REVIEWER_LABEL" \
  --arg commit_id "$MERGE_COMMIT_ID" \
  --arg pr_url "$PR_URL" \
  --arg time "$TIMESTAMP" \
  --arg dashboard "$DASHBOARD_URL" \
  --arg env "$DEPLOY_NAME" \
  '{
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          {
            type: "TextBlock",
            size: "Large",
            weight: "Bolder",
            text: $title,
            wrap: true
          },
          {
            type: "TextBlock",
            text: $subtitle,
            size: "Medium",
            wrap: true,
            color: "Good"
          },
          {
            type: "ColumnSet",
            columns: [
              {
                type: "Column",
                width: "auto",
                items: [{
                  type: "TextBlock",
                  text: $status,
                  weight: "Bolder",
                  color: $color
                }]
              }
            ]
          },
          {
            type: "FactSet",
            facts: [
              { title: "Environment", value: $env },
              { title: $reviewer_label, value: $reviewer },
              { title: "Pull Request", value: $pr },
              { title: "Source Branch", value: $source },
              { title: "Target Branch", value: $target },
              { title: "CI/CD Commit ID", value: $commit_id },
              { title: "Timestamp", value: $time },
              { title: "Next Step", value: "SAP CI/CD pipeline will be started shortly" }
            ]
          }
        ],
        actions: [
          {
            type: "Action.OpenUrl",
            title: "View Merged PR on GitHub",
            url: $pr_url
          },
          {
            type: "Action.OpenUrl",
            title: "Open SAP CI/CD Dashboard",
            url: $dashboard
          }
        ]
      }
    }]
  }')

for WEBHOOK_URL in "${TARGET_WEBHOOKS[@]}"; do
  if [ -n "$WEBHOOK_URL" ]; then
    echo "Sending notification to webhook..."
    curl -s -X POST \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      "$WEBHOOK_URL" || true
  fi
done
