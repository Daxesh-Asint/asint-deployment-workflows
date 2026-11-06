#!/usr/bin/env bash
set -e

# ==============================================================================
# MS Teams Auto-Merge Notification Handler
# ==============================================================================

COMMIT_COUNT="0"
MERGE_COMMIT_ID="N/A"
if [ -n "$PR_NUMBER" ]; then
  AUTHORS=$(gh api repos/"$REPO"/pulls/"$PR_NUMBER"/commits --paginate --jq '[.[] | if .author.login then .author.login else .commit.author.name end] | unique | if length > 3 then (.[0:3] + ["and \(length - 3) others"]) else . end | join(", ")' 2>/dev/null || echo "")
  COMMIT_COUNT=$(gh api repos/"$REPO"/pulls/"$PR_NUMBER"/commits --paginate --jq 'length' 2>/dev/null || echo "0")
  
  # Fetch the resulting merge commit ID (shortened to 7 characters)
  if [ "$JOB_STATUS" = "success" ]; then
    MERGE_COMMIT_ID=$(gh pr view "$PR_NUMBER" --json mergeCommit --jq '.mergeCommit.oid // empty' 2>/dev/null | cut -c 1-7 || echo "")
    [ -z "$MERGE_COMMIT_ID" ] && MERGE_COMMIT_ID="N/A"
  fi
fi

if [ -z "$AUTHORS" ]; then
  AUTHORS="$ACTOR"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/resolve_teams_webhooks.sh"

if [ "${#TARGET_WEBHOOKS[@]}" -eq 0 ]; then
  echo "ℹ️ No specific or fallback Teams webhook configured for '$DEPLOY_NAME'. Skipping notification."
  exit 0
fi

# Determine merge status and card title
if [ "$JOB_STATUS" = "success" ]; then
  if [ -z "$PR_NUMBER" ]; then
    MERGE_STATUS="🔄 Already Up to Date"
    MERGE_COLOR="good"
    if [ -n "$DEPLOY_NAME" ]; then
      CARD_TITLE="✅ $DEPLOY_NAME Sync: Up to Date"
    else
      CARD_TITLE="Sync Status: Up to Date"
    fi
    CARD_SUBTITLE="No new commits to merge from $SOURCE to $TARGET"
    PR_URL="https://github.com/$REPO/actions/runs/$RUN_ID"
    PR_LABEL="View Run on GitHub"
    PR_FACT_VAL="None Required"
  elif [ "$AWAITING_APPROVAL" = "true" ]; then
    MERGE_STATUS="⏳ Waiting for Approval"
    MERGE_COLOR="warning"
    if [ -n "$DEPLOY_NAME" ]; then
      CARD_TITLE="🟡 $DEPLOY_NAME: Awaiting Review & Approval"
    else
      CARD_TITLE="🟡 Awaiting Review & Approval"
    fi
    ASSIGNED_REVS="$ASSIGNED_REVIEWERS"
    [ -z "$ASSIGNED_REVS" ] && ASSIGNED_REVS="$INPUT_REVIEWERS"
    CARD_SUBTITLE="Target branch is protected. Assigned $ASSIGNED_REVS as reviewer(s). Once approved, deployment will start automatically."
    PR_URL="https://github.com/$REPO/pull/$PR_NUMBER"
    PR_LABEL="Review & Approve PR on GitHub"
    if [ -n "$COMMIT_COUNT" ] && [ "$COMMIT_COUNT" -gt 0 ] 2>/dev/null; then
      PR_FACT_VAL="PR #$PR_NUMBER ($COMMIT_COUNT commits)"
    else
      PR_FACT_VAL="PR #$PR_NUMBER"
    fi
  else
    MERGE_STATUS="✅ Merged Successfully"
    MERGE_COLOR="good"
    if [ -n "$DEPLOY_NAME" ]; then
      CARD_TITLE="🚀 $DEPLOY_NAME Deployment Triggered"
      CARD_SUBTITLE="Auto-merge completed • SAP CI/CD deployment started"
    else
      CARD_TITLE="GitHub Auto-Merge Notification"
      CARD_SUBTITLE=""
    fi
    PR_URL="https://github.com/$REPO/pull/$PR_NUMBER"
    PR_LABEL="View PR on GitHub"
    if [ -n "$COMMIT_COUNT" ] && [ "$COMMIT_COUNT" -gt 0 ] 2>/dev/null; then
      PR_FACT_VAL="PR #$PR_NUMBER ($COMMIT_COUNT commits)"
    else
      PR_FACT_VAL="PR #$PR_NUMBER"
    fi
  fi
else
  # Check the specific reason for failure
  if [ "$PROTECTED_FILES_MODIFIED" = "true" ]; then
    MERGE_STATUS="🚫 Protected Files Modified"
    MERGE_COLOR="attention"
    if [ -n "$DEPLOY_NAME" ]; then
      CARD_TITLE="🚫 $DEPLOY_NAME Deployment Blocked — Protected Files"
      CARD_SUBTITLE="mta.yaml or xs-security.json were modified. Please revert these changes before merging."
    else
      CARD_TITLE="🚫 Auto-Merge Blocked — Protected Files"
      CARD_SUBTITLE="mta.yaml or xs-security.json were modified. Please revert these changes."
    fi
  elif [ "$HAS_CONFLICTS" = "true" ]; then
    MERGE_STATUS="⚠️ Merge Conflicts Detected"
    MERGE_COLOR="attention"
    if [ -n "$DEPLOY_NAME" ]; then
      CARD_TITLE="⚠️ $DEPLOY_NAME Deployment Blocked — Merge Conflicts"
      CARD_SUBTITLE="Merge conflicts detected between $SOURCE and $TARGET. Manual resolution required before deployment can proceed."
    else
      CARD_TITLE="⚠️ Auto-Merge Blocked — Merge Conflicts"
      CARD_SUBTITLE="Merge conflicts detected between $SOURCE and $TARGET. Manual resolution required."
    fi
  else
    MERGE_STATUS="❌ Failed / Blocked"
    MERGE_COLOR="attention"
    if [ -n "$DEPLOY_NAME" ]; then
      CARD_TITLE="❌ $DEPLOY_NAME Deployment Failed"
      CARD_SUBTITLE="Auto-merge workflow failed. Please check the workflow logs."
    else
      CARD_TITLE="GitHub Auto-Merge Notification"
      CARD_SUBTITLE=""
    fi
  fi
  if [ -n "$PR_NUMBER" ]; then
    PR_URL="https://github.com/$REPO/pull/$PR_NUMBER"
    PR_LABEL="View PR on GitHub"
    if [ -n "$COMMIT_COUNT" ] && [ "$COMMIT_COUNT" -gt 0 ] 2>/dev/null; then
      PR_FACT_VAL="PR #$PR_NUMBER ($COMMIT_COUNT commits)"
    else
      PR_FACT_VAL="PR #$PR_NUMBER"
    fi
  else
    PR_URL="https://github.com/$REPO/actions/runs/$RUN_ID"
    PR_LABEL="View Run on GitHub"
    PR_FACT_VAL="N/A"
  fi
fi

CF_APP_NOTE=""
if [ "$APP_WAS_STOPPED" = "true" ] && [ -n "$CF_APPS_COMMA" ]; then
  if [ "$JOB_STATUS" != "success" ]; then
    CF_APP_NOTE="▶️ Restarted $CF_APPS_COMMA (Merge did not complete; app restored automatically)"
  else
    CF_APP_NOTE="🛑 Stopped $CF_APPS_COMMA — Stopped because more Cloud Foundry runtime memory is needed to get deployment completed. Once deployment is completed, the app will be restarted automatically."
  fi
fi

DASHBOARD_TITLE="Track Deployment in SAP CI/CD Dashboard"
if [ -n "$DEPLOY_NAME" ]; then
  DASHBOARD_TITLE="Track $DEPLOY_NAME Deployment in SAP CI/CD Dashboard"
fi

# Build Adaptive Card JSON using jq
PAYLOAD=$(jq -n \
  --arg title "$CARD_TITLE" \
  --arg status "$MERGE_STATUS" \
  --arg color "$MERGE_COLOR" \
  --arg repo "$REPO" \
  --arg pr "$PR_FACT_VAL" \
  --arg source "$SOURCE" \
  --arg target "$TARGET" \
  --arg merge_commit "$MERGE_COMMIT_ID" \
  --arg authors "$AUTHORS" \
  --arg pr_url "$PR_URL" \
  --arg pr_label "$PR_LABEL" \
  --arg subtitle "$CARD_SUBTITLE" \
  --arg dashboard_url "$DASHBOARD_URL" \
  --arg dashboard_title "$DASHBOARD_TITLE" \
  --arg cf_app_note "$CF_APP_NOTE" \
  '{
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: (
          [
            {
              type: "TextBlock",
              size: "Large",
              weight: "Bolder",
              text: $title,
              wrap: true
            }
          ] +
          (if $subtitle != "" then [
            {
              type: "TextBlock",
              text: $subtitle,
              size: "Small",
              isSubtle: true,
              wrap: true
            }
          ] else [] end) +
          [
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
                  { title: "Repository", value: $repo },
                  { title: "Changes By", value: $authors },
                  { title: "Pull Request", value: $pr },
                  { title: "Source Branch", value: $source },
                  { title: "Target Branch", value: $target },
                  { title: "CI/CD Commit ID", value: $merge_commit }
                ] +
                (if $cf_app_note != "" then [
                  { title: "CF App Control", value: $cf_app_note }
                ] else [] end)
              )
            }
          ]
        ),
        actions: (
          [
            {
              type: "Action.OpenUrl",
              title: $pr_label,
              url: $pr_url
            }
          ] +
          (if $dashboard_url != "" then [
            {
              type: "Action.OpenUrl",
              title: $dashboard_title,
              url: $dashboard_url
            }
          ] else [] end)
        )
      }
    }]
  }')

# Send to target channel MS Teams webhooks
for WEBHOOK_URL in "${TARGET_WEBHOOKS[@]}"; do
  if [ -n "$WEBHOOK_URL" ]; then
    echo "Sending notification to webhook..."
    curl -s -X POST \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      "$WEBHOOK_URL" || true
  fi
done
