# 🚀 AsInt Deployment Automation & Workflows Repository

Welcome to the central repository for **AsInt Deployment Automation Workflows & Tenant Callers** extracted directly from `StillSomehowSane/asint_ais`.

This repository serves as a dedicated, clean reference strictly for **deployment-related workflows** to help engineering leadership, developers, and DevOps teams review, understand, and optimize our deployment pipelines.

---

## 📑 Repository Structure

```text
├── .github/
│   └── workflows/             # Pure Deployment Workflows & All Tenant Callers
│       ├── apm02_*.yml        # APM-02 Deployment Lifecycle (Steps 1 to 6)
│       ├── _auto_merge*.yml   # Autonomous Auto-Merge & Governance Engine
│       └── deploy_*.yml       # Tenant Deployment Caller Workflows (All Environments)
└── docs/
    └── WORKFLOW_INVENTORY_DOCUMENT.md   # Complete Analysis Document (What, When, Why, Optimization)
```

---

## 🏛️ Deployment Workflow Classification

The workflows in this repository are categorized into 3 distinct functional groups:

### 1. 🎯 APM-02 Deployment Family (Workflows 1 to 6)
Orchestrates scheduled snapshot creation, countdown testing window, automated merge, and SAP content channel refresh:
* [`apm02_1_create_and_wait.yml`](.github/workflows/apm02_1_create_and_wait.yml) — Initiates snapshot branch, notifies Microsoft Teams, runs 30m cherry-pick wait.
* [`apm02_2_extend_wait.yml`](.github/workflows/apm02_2_extend_wait.yml) — Dynamically extends the wait window if testing requires more time.
* [`apm02_3_finalize_cycle.yml`](.github/workflows/apm02_3_finalize_cycle.yml) — Merges snapshot to tenant branch, runs headless Playwright BWZ refresh, and finalizes cycle.
* [`apm02_4_conflict_monitor.yml`](.github/workflows/apm02_4_conflict_monitor.yml) — Base PR conflict detection monitor.
* [`apm02_5_apm02_conflict_monitor.yml`](.github/workflows/apm02_5_apm02_conflict_monitor.yml) — Tenant deployment PR conflict monitor.
* [`apm02_6_recovery.yml`](.github/workflows/apm02_6_recovery.yml) — Automated rollback and branch recovery in case of pipeline failures.

---

### 2. ⚡ Autonomous Auto-Merge & Governance Engine
Handles end-to-end PR lifecycle without requiring human clicks for routine releases:
* [`_auto_merge.yml`](.github/workflows/_auto_merge.yml) — **Direct Auto-Merge (Happy Path):** Automatically merges clean PRs (e.g. `@Jarvis deploy ais-02`) with zero conflicts.
* [`auto_merge_conflict_resolver.yml`](.github/workflows/auto_merge_conflict_resolver.yml) — **Self-Healing Conflict Resolver:** Pauses on conflict; once developers push fixes, it detects clean state and resumes automatically.
* [`auto_merge_approval_handler.yml`](.github/workflows/auto_merge_approval_handler.yml) — **Protected Branch Reviewer:** Auto-assigns reviewers on protected branches and merges instantly upon approval.

---

### 3. 🏢 Tenant Deployment Callers (`deploy_*.yml` — 43 Workflows)
Dedicated trigger workflows per tenant environment supporting Core, Data Collector (DC), and Add-In deployment streams:

| Tenant / Environment | Workflows |
| :--- | :--- |
| **AIS 02** | `deploy_ais02_dc.yml`, `deploy_ais02_dc_addin.yml`, `merge_dev_to_tenant_ais02.yml` |
| **APM 01** | `deploy_apm01.yml`, `deploy_apm01_dc.yml`, `deploy_apm01_dc_addin.yml` |
| **APM EIOT** | `deploy_apm_eiot.yml`, `deploy_apm_eiot_dc.yml`, `deploy_apm_eiot_dc_addin.yml` |
| **AsInt Demo** | `deploy_asint_demo.yml`, `deploy_asint_demo_dc.yml`, `deploy_asint_demo_dc_addin.yml` |
| **Baystar** | `deploy_baystar.yml`, `deploy_baystar_dc.yml`, `deploy_baystar_dc_addin.yml` |
| **HSC Non-Prod & Prod** | `deploy_hsc_non_prod*.yml`, `deploy_hsc_prod*.yml` |
| **Indorama Prod (900 & 933)** | `deploy_indorama_prod_900*.yml`, `deploy_indorama_prod_933*.yml` |
| **Indorama QA (233 & 234)** | `deploy_indorama_qa_233*.yml`, `deploy_indorama_qa_234*.yml` |
| **IRC** | `deploy_irc.yml`, `deploy_irc_dc.yml`, `deploy_irc_dc_addin.yml` |
| **ST Env** | `deploy_st_env.yml`, `deploy_st_env_dc.yml`, `deploy_st_env_dc_addin.yml` |
| **VMOS** | `deploy_vmos.yml`, `deploy_vmos_dc.yml`, `deploy_vmos_dc_addin.yml` |

---

## 🛠️ Helpers & Integration
* [`_apm02_notify.yml`](.github/workflows/_apm02_notify.yml) — Reusable Teams Adaptive Card dispatcher.
* [`sap_cicd_notifier.yml`](.github/workflows/sap_cicd_notifier.yml) — SAP Continuous Integration & Delivery (ANS) webhook receiver.
* [`_cf_app_control.yml`](.github/workflows/_cf_app_control.yml) — Cloud Foundry approuter start/stop lifecycle manager.

---

## 📖 Complete Documentation & Optimization Report

For an in-depth, executive analysis answering:
1. **What does each workflow do?**
2. **When is it triggered?**
3. **Why do we have it (business reason)?**
4. **Can it be clubbed or removed?**

Please refer to the comprehensive review document:  
👉 **[`docs/WORKFLOW_INVENTORY_DOCUMENT.md`](docs/WORKFLOW_INVENTORY_DOCUMENT.md)**
