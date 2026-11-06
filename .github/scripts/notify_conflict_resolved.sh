#!/usr/bin/env bash
set -e

# ==============================================================================
# MS Teams Conflict Resolution Notification Handler
# Supports:
#   ACTION_TYPE="awaiting_approval"
#   ACTION_TYPE="merged"
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/resolve_teams_webhooks.sh"

if [ "${#TARGET_WEBHOOKS[@]}" -eq 0 ]; then
  echo "ℹ️ No specific or fallback Teams webhook configured for '$DEPLOY_NAME'. Skipping notification."
  exit 0
fi

REPO="${REPO:-$GITHUB_REPOSITORY}"
PR_URL="https://github.com/$REPO/pull/$PR_NUMBER"
DASHBOARD_TITLE="Open $DEPLOY_NAME SAP CI/CD Dashboard"

CF_APP_NOTE=""
if [ "$APP_WAS_STOPPED" = "true" ] && [ -n "$CF_APPS_COMMA" ]; then
  CF_APP_NOTE="App(s) [$CF_APPS_COMMA] stopped before merge (pipeline will restart them)"
fi

if [ "$ACTION_TYPE" = "awaiting_approval" ]; then
  CARD_TITLE="🟡 $DEPLOY_NAME: Merge Conflicts Resolved — Awaiting Approval"
  CARD_SUBTITLE="Merge conflicts for PR #$PR_NUMBER have been successfully resolved. The PR is now mergeable and awaiting 1 peer review approval to auto-merge and resume deployment."
  STATUS_TEXT="🟡 Conflicts Resolved • Awaiting Approval"
  CARD_COLOR="warning"

  PAYLOAD=$(jq -n \
    --arg title "$CARD_TITLE" \
    --arg subtitle "$CARD_SUBTITLE" \
    --arg status "$STATUS_TEXT" \
    --arg color "$CARD_COLOR" \
    --arg repo "$REPO" \
    --arg pr "PR #$PR_NUMBER" \
    --arg source "$HEAD_BRANCH" \
    --arg target "$BASE_BRANCH" \
    --arg resolver "$RESOLVER" \
    --arg reviewers "$REVIEWERS" \
    --arg pr_url "$PR_URL" \
    --arg dashboard_url "$DASHBOARD_URL" \
    --arg dashboard_title "$DASHBOARD_TITLE" \
    --arg deploy_name "$DEPLOY_NAME" \
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
              color: "Warning"
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
                    color: "Warning"
                  }]
                }
              ]
            },
            {
              type: "FactSet",
              facts: [
                { title: "Environment", value: $deploy_name },
                { title: "Repository", value: $repo },
                { title: "Resolved By", value: $resolver },
                { title: "Pull Request", value: $pr },
                { title: "Source Branch", value: $source },
                { title: "Target Branch", value: $target },
                { title: "Reviewers Assigned", value: $reviewers },
                { title: "Next Step", value: "Auto-merge will trigger once any 1 reviewer approves" }
              ]
            }
          ],
          actions: [
            {
              type: "Action.OpenUrl",
              title: "View PR & Approve on GitHub",
              url: $pr_url
            },
            {
              type: "Action.OpenUrl",
              title: $dashboard_title,
              url: $dashboard_url
            }
          ]
        }
      }]
    }')
else
  if [ -z "$MERGE_COMMIT_ID" ] || [ "$MERGE_COMMIT_ID" = "N/A" ]; then
    MERGE_COMMIT_ID=$(gh pr view "$PR_NUMBER" --json mergeCommit --jq '.mergeCommit.oid // empty' 2>/dev/null | cut -c 1-7 || echo "")
    [ -z "$MERGE_COMMIT_ID" ] && MERGE_COMMIT_ID="N/A"
  fi

  CARD_TITLE="🟢 $DEPLOY_NAME: Merge Conflicts Resolved & Merged"
  CARD_SUBTITLE="Merge conflicts for PR #$PR_NUMBER have been successfully resolved and changes were merged. Deployment pipeline has resumed."
  STATUS_TEXT="🟢 Conflicts Resolved • Merged Successfully"
  CARD_COLOR="good"

  PAYLOAD=$(jq -n \
    --arg title "$CARD_TITLE" \
    --arg subtitle "$CARD_SUBTITLE" \
    --arg status "$STATUS_TEXT" \
    --arg color "$CARD_COLOR" \
    --arg repo "$REPO" \
    --arg pr "PR #$PR_NUMBER" \
    --arg source "$HEAD_BRANCH" \
    --arg target "$BASE_BRANCH" \
    --arg resolver "$RESOLVER" \
    --arg commit_id "$MERGE_COMMIT_ID" \
    --arg pr_url "$PR_URL" \
    --arg dashboard_url "$DASHBOARD_URL" \
    --arg dashboard_title "$DASHBOARD_TITLE" \
    --arg deploy_name "$DEPLOY_NAME" \
    --arg cf_app_note "$CF_APP_NOTE" \
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
              facts: (
                [
                  { title: "Environment", value: $deploy_name },
                  { title: "Repository", value: $repo },
                  { title: "Resolved By", value: $resolver },
                  { title: "Pull Request", value: $pr },
                  { title: "Source Branch", value: $source },
                  { title: "Target Branch", value: $target },
                  { title: "CI/CD Commit ID", value: $commit_id },
                  { title: "Next Step", value: "SAP CI/CD pipeline will be started shortly" }
                ] +
                (if $cf_app_note != "" then [
                  { title: "CF App Control", value: $cf_app_note }
                ] else [] end)
              )
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
              title: $dashboard_title,
              url: $dashboard_url
            }
          ]
        }
      }]
    }')
fi

for WEBHOOK_URL in "${TARGET_WEBHOOKS[@]}"; do
  if [ -n "$WEBHOOK_URL" ]; then
    echo "Sending notification to webhook..."
    curl -s -X POST \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      "$WEBHOOK_URL" || true
  fi
done
