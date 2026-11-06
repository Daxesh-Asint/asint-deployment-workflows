# AsInt Deployment Automation — GitHub Actions Workflow Inventory & Optimization Analysis

**Author:** Daxesh Prajapati  
**Target Reviewers:** Sharan N, Alisha Verma  
**Scope:** Complete inventory of all custom deployment & automation workflows in `StillSomehowSane/asint_ais`.  

---

## Executive Overview
This document breaks down every custom GitHub Actions workflow powering the AsInt deployment pipeline. For each workflow, four key operational aspects are addressed:
1. **What does each workflow do?** (Technical responsibility)
2. **When is it triggered?** (Exact GitHub Actions trigger event)
3. **Why do we have it?** (Underlying business/engineering purpose)
4. **Can it be clubbed or removed?** (Feasibility assessment for consolidation)

---

## Section 1: APM-02 Deployment Family (Workflows 1 to 6)

### 1. `apm02_1_create_and_wait.yml` (APM-02 Step 1: Create Snapshot & Countdown)
* **What does it do?**
  * Creates an isolated snapshot branch from `dev`.
  * Sends an announcement to Microsoft Teams notifying developers that deployment has initiated.
  * Initiates the countdown wait loop (default: 30 minutes) allowing developers to cherry-pick pending hotfixes before code freeze.
  * Automatically proceeds to trigger Step 3 (finalize) once countdown expires, or immediately if bypassed via `@Jarvis deploy now`.
* **When is it triggered?**
  * Triggered via `repository_dispatch` with event type `trigger_apm02_deployment` (dispatched by GCP Jarvis Bot when someone types `@Jarvis share snapshot [minutes]`).
* **Why do we have it (Business Reason)?**
  * Protects production stability. It establishes an organized, predictable window for engineers to commit critical bug fixes without racing against an immediate deployment lock.
* **Can it be clubbed or removed?**
  * **Cannot be removed:** It is the core initiator of the entire APM-02 deployment pipeline.
  * **Can it be optimized/clubbed?** **YES.** Currently, the 30-minute countdown runs as an active wait loop inside GitHub Actions. We can offload the 30-minute timer to GCP Cloud Tasks/Webhook so GitHub Actions is only triggered *after* the 30 minutes expire. This reduces workflow runtime from 30 minutes down to < 2 minutes.

---

### 2. `apm02_2_extend_wait.yml` (APM-02 Step 2: Extend Snapshot Wait Window)
* **What does it do?**
  * Extends the running countdown timer on an active snapshot deployment if developers need extra time to complete testing or cherry-picks.
  * Updates the state in Microsoft Teams.
* **When is it triggered?**
  * Triggered via `repository_dispatch` with event type `extend_apm02_wait` (dispatched when someone requests `@Jarvis extend wait [minutes]`).
* **Why do we have it (Business Reason)?**
  * Prevents premature deployment cut-offs when complex testing or unexpected bug resolution requires an extra 15–30 minutes without having to abort the entire deployment cycle.
* **Can it be clubbed or removed?**
  * **Keep as is:** It is an on-demand auxiliary trigger. If the 30-minute wait loop is offloaded to GCP Cloud Tasks in the future, this extension logic would naturally move into GCP as well.

---

### 3. `apm02_3_finalize_cycle.yml` (APM-02 Step 3: Finalize, Merge & Content Channel Refresh)
* **What does it do?**
  * Merges the validated snapshot branch into the designated tenant deployment branch (`tenant/asint-apm-02-*`).
  * Triggers SAP Build Work Zone (BWZ) content channel refresh via headless Playwright automation (for APM-02).
  * Sends deployment completion notifications and cleanup signals.
* **When is it triggered?**
  * Triggered via `repository_dispatch` with event type `sap_cicd_finished` (dispatched once SAP CI/CD ANS deployment finishes).
* **Why do we have it (Business Reason)?**
  * Ensures that changes successfully deployed through SAP CI/CD are permanently recorded back into tenant branches and SAP Launchpad tiles are immediately refreshed for end-users.
* **Can it be clubbed or removed?**
  * **Cannot be removed:** Core finalization pipeline.
  * **Optimization:** Notification steps can be combined directly into the main job to eliminate auxiliary sub-job dispatches.

---

### 4. `apm02_4_conflict_monitor.yml` (Base PR Conflict Monitor)
* **What does it do?**
  * Continuously evaluates open Pull Requests targeting base branches (`main`, `main-dc`, `main-dc-addin`) to verify whether incoming commits conflict with upstream base code.
  * Dispatches an alert to Teams if base-level divergence occurs.
* **When is it triggered?**
  * Triggered on `pull_request` events (opened, synchronize, reopened) strictly targeting base branches.
* **Why do we have it (Business Reason)?**
  * Early warning system. Detects merge conflicts hours before scheduled production cut-offs, preventing deployment freezes during release windows.
* **Can it be clubbed or removed?**
  * **Can be clubbed:** Highly viable candidate to merge with `apm02_5_apm02_conflict_monitor.yml` into a single unified conflict-monitoring workflow using a branch matrix.

---

### 5. `apm02_5_apm02_conflict_monitor.yml` (Tenant Deployment Conflict Monitor)
* **What does it do?**
  * Evaluates open Pull Requests targeting tenant-specific deployment streams (`tenant/asint-apm-02-v2`, `tenant/asint-apm-02-dc`, `tenant/asint-apm-02-dc-addin`).
* **When is it triggered?**
  * Triggered on `pull_request` events targeting tenant deployment branches.
* **Why do we have it (Business Reason)?**
  * Isolates tenant branch conflicts so that tenant-specific customizations or schema differences do not silently collide with base deployment PRs.
* **Can it be clubbed or removed?**
  * **Can be clubbed:** Can be consolidated with `apm02_4_conflict_monitor.yml` into one reusable conflict monitor.

---

### 6. `apm02_6_recovery.yml` (Deployment Recovery & Rollback)
* **What does it do?**
  * Recovers the branch state if any deployment step crashes or fails validation midway.
  * Restores git refs to their pre-snapshot baseline and cleans up orphaned deployment branches.
* **When is it triggered?**
  * Triggered via `workflow_dispatch` (manual emergency recovery) or programmatically when fatal errors occur in finalize steps.
* **Why do we have it (Business Reason)?**
  * Disaster recovery safeguard. Guarantees that a failed deployment never leaves the repository in a corrupted or half-merged state.
* **Can it be clubbed or removed?**
  * **Keep separate:** Essential safety tool. Keeping recovery isolated ensures it can run independently even if other deployment workflows fail.

---

## Section 2: Intelligent Auto-Merge & Governance (Workflows 7 to 9)

### 7. `_auto_merge.yml` (Direct Auto-Merge — Happy Path)
* **What does it do?**
  * Inspects automated deployment PRs (e.g. PR created from `dev` to `tenant/asint-ais-02`).
  * If the PR is mergeable with **zero conflicts** and meets standard branch checks, it automatically merges the PR and triggers deployment.
* **When is it triggered?**
  * Triggered automatically on `pull_request` creation or updates targeting deployment streams.
* **Why do we have it (Business Reason)?**
  * Eliminates human bottleneck. In 90% of routine deployments where code is clean, deployment proceeds immediately without waiting hours for manual clicks.
* **Can it be clubbed or removed?**
  * **Cannot be removed:** The cornerstone of autonomous deployment.

---

### 8. `auto_merge_conflict_resolver.yml` (Self-Healing Conflict Resolver)
* **What does it do?**
  * Pauses auto-merge if merge conflicts exist and posts exact conflict notifications to the engineering team.
  * Listens for developer push events. As soon as a developer resolves the conflicts and pushes fixes, it detects the clean state, merges the PR, and resumes the deployment pipeline automatically.
* **When is it triggered?**
  * Triggered on `pull_request` synchronize (push) events on PRs with previous conflict states.
* **Why do we have it (Business Reason)?**
  * Zero-touch resumption. Once developers resolve git conflicts, they do not need to call DevOps to manually restart pipelines—it self-heals and finishes deployment automatically.
* **Can it be clubbed or removed?**
  * **Can be clubbed:** Can be merged into `_auto_merge.yml` as a secondary conditional step rather than a standalone workflow file.

---

### 9. `auto_merge_approval_handler.yml` (Protected Branch Review & Governance)
* **What does it do?**
  * On protected branches requiring peer review, it automatically assigns senior developers as reviewers.
  * Listens for review submissions: the moment an approval is logged, it instantly merges the PR and starts deployment.
* **When is it triggered?**
  * Triggered on `pull_request_review` events (submitted, approved).
* **Why do we have it (Business Reason)?**
  * Enforces compliance and quality governance while eliminating manual merge delays once approval is given.
* **Can it be clubbed or removed?**
  * **Can be clubbed:** Could be consolidated with `_auto_merge.yml` under PR lifecycle event triggers (`pull_request` + `pull_request_review`).

---

## Section 3: Notification, Webhooks & Auxiliary Helpers (Workflows 10 to 12)

### 10. `_apm02_notify.yml` (Microsoft Teams Adaptive Card Dispatcher)
* **What does it do?**
  * Formats and posts structured Microsoft Teams Adaptive Cards (Snapshot Created, Countdown Reminders, Deployment Succeeded, Conflicts Detected).
* **When is it triggered?**
  * Called via `workflow_call` or `repository_dispatch` by parent deployment workflows.
* **Why do we have it (Business Reason)?**
  * Centralizes Teams notification formatting so UI styles and webhook URLs are maintained in one place.
* **Can it be clubbed or removed?**
  * **Optimization:** Instead of launching a separate workflow/runner for notifications, notification scripts can be run as inline composite steps inside the primary workflows, saving runner concurrency.

---

### 11. `sap_cicd_notifier.yml` (SAP CI/CD Webhook Listener)
* **What does it do?**
  * Receives webhook payload from SAP CI/CD (ANS - Alert Notification Service) upon build completion and verifies payload authenticity before triggering finalization.
* **When is it triggered?**
  * Triggered via `repository_dispatch` from SAP CI/CD incoming webhooks.
* **Why do we have it (Business Reason)?**
  * Bridges external SAP Cloud Foundry build pipelines back into GitHub Actions.
* **Can it be clubbed or removed?**
  * **Keep as is:** Essential external webhook ingress point.

---

### 12. `_cf_app_control.yml` (Cloud Foundry Application Lifecycle Helper)
* **What does it do?**
  * Handles start, stop, and restart operations for SAP Cloud Foundry approuters/services during database migrations or maintenance.
* **When is it triggered?**
  * Called via `workflow_call` by deployment finalization workflows.
* **Why do we have it (Business Reason)?**
  * Prevents end-user traffic collisions while deployment updates are binding to Cloud Foundry.
* **Can it be clubbed or removed?**
  * **Keep as is:** Excellent example of a modular, reusable sub-workflow.

---

## Executive Optimization Summary for Sharan & Alisha

| Recommendation | Actions to Combine / Optimize | Direct Benefit |
|---|---|---|
| **Optimization 1: Eliminate 30m Runner Wait** | Offload countdown in `apm02_1_create_and_wait.yml` to GCP Cloud Tasks | Reduces workflow runtime from 30 minutes to **under 2 minutes**; completely frees runner. |
| **Optimization 2: Consolidate Conflict Monitors** | Merge `apm02_4_conflict_monitor.yml` + `apm02_5_apm02_conflict_monitor.yml` | Reduces workflow maintenance from 2 files to 1 parameterized workflow. |
| **Optimization 3: Inline Teams Notifications** | Embed `_apm02_notify.yml` directly into main jobs | Eliminates unnecessary runner worker handoffs and speeds up notification delivery. |
| **Optimization 4: Unified Auto-Merge Pipeline** | Merge `_auto_merge.yml`, `auto_merge_conflict_resolver.yml`, and `auto_merge_approval_handler.yml` | Single end-to-end PR lifecycle controller; cuts total workflow count by ~25%. |

