const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PAYLOAD = process.env.WIKI_PAYLOAD;
if (!PAYLOAD) {
  console.error("Missing WIKI_PAYLOAD environment variable.");
  process.exit(1);
}
const payload = JSON.parse(PAYLOAD);
const action = payload.action;
const snapshot = payload.snapshot;

// ── Bug Fix #1 ──────────────────────────────────────────────────────────────
// Guard: if snapshot is empty/undefined (e.g. finalize job failed before
// setting outputs), skip the update to prevent orphan/corrupt rows.
if (!snapshot || snapshot === 'undefined' || snapshot.trim() === '') {
  console.warn("⚠️  WIKI_PAYLOAD.snapshot is empty or undefined. Skipping wiki update to prevent corrupt rows.");
  process.exit(0);
}
// ────────────────────────────────────────────────────────────────────────────

const rawEnv = payload.environment || payload.deployment_name || 'APM-02';

// normalizeEnv: strip AsInt prefix, preserve well-known acronyms & "AddIn" casing.
// Produces e.g. "APM-02 DC AddIn" → "APM-02-DC-AddIn" slug.
function normalizeEnv(name) {
  if (!name) return 'APM-02';
  const clean = name.replace(/^AsInt[-_ ]?/i, '').replace(/[-_]/g, ' ').trim();
  return clean
    .split(/\s+/)
    .map(word => {
      const upper = word.toUpperCase();
      if (['APM', 'DC', 'AIS', 'EIOT', 'IRC', 'ST', 'QA'].includes(upper)) return upper;
      if (upper === 'ADDIN' || upper === 'ADD-IN') return 'AddIn';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

const cleanEnv  = normalizeEnv(rawEnv);        // e.g. "APM-02 DC AddIn"
const envSlug   = cleanEnv.replace(/\s+/g, '-'); // e.g. "APM-02-DC-AddIn"
const envTitle  = cleanEnv.toUpperCase();         // e.g. "APM-02 DC ADDIN" (for table headers)
// envKey is used for the history JSON filename — must stay identical to the original
// so existing wiki files are read correctly (e.g. "apm02dcaddin_history.json")
const envKey    = rawEnv.toLowerCase().replace(/[^a-z0-9]/g, '');

const wikiDir     = path.join(process.cwd(), 'wiki');
const historyFile = path.join(wikiDir, `${envKey}_history.json`);
// Use -Snapshot-History suffix to keep these pages visually distinct from
// the global -Deployment-History pages written by update_wiki_global.js.
const mdFile      = path.join(wikiDir, `${envSlug}-Snapshot-History.md`);

if (!fs.existsSync(wikiDir)) {
  console.error("Wiki directory not found.");
  process.exit(1);
}

let history = [];
if (fs.existsSync(historyFile)) {
  try {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  } catch (e) {
    console.warn("Could not parse history file, starting fresh:", e.message);
  }
}

// ── Bug Fix (cleanup) ────────────────────────────────────────────────────────
// Remove any orphan rows that were created with a missing/empty/undefined snapshot.
// This self-heals the history file on every wiki update run.
const before = history.length;
history = history.filter(r =>
  r.snapshot &&
  r.snapshot !== 'undefined' &&
  r.snapshot.trim() !== ''
);
if (history.length < before) {
  console.log(`🧹 Cleaned ${before - history.length} corrupt row(s) with missing/undefined snapshot.`);
}
// ────────────────────────────────────────────────────────────────────────────

const GREEN_YES = '<span style="color:green;font-weight:bold">Yes</span>';
const RED_NO    = '<span style="color:red;font-weight:bold">No</span>';

// Find existing row for this snapshot, or create a new one
let row = history.find(r => r.snapshot === snapshot);

if (!row) {
  row = {
    id: history.length > 0 ? Math.max(...history.map(r => r.id || 0)) + 1 : 1,
    date: payload.date || new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }),
    snapshot: snapshot,
    // ── Bug Fix #2 ────────────────────────────────────────────────────────
    // Use environment-agnostic field names (tenant_pr, merged_tenant) so the
    // lookup/render logic works for APM-02, APM-02 DC, APM-02 DC AddIn, etc.
    // Old rows that have apm02_pr / merged_apm02 are read via backwards-compat
    // fallbacks in the render block below.
    tenant_pr:       'N/A',
    main_pr:         'N/A',
    // ──────────────────────────────────────────────────────────────────────
    initiated_by:    payload.actor || 'N/A',
    merge_time:      'N/A',
    status:          '⏳ Waiting',
    merged_tenant:   '-',
    merged_main:     '-',
    cycle_completed: '-'
  };
  history.unshift(row);
}

// ── Update row based on action ───────────────────────────────────────────────
if (action === 'create') {
  row.status = '⏳ Waiting';

} else if (action === 'merged-apm02') {
  if (payload.pr_number) row.tenant_pr = payload.pr_number;
  if (payload.merge_time) row.merge_time = payload.merge_time;
  row.merged_tenant = payload.success ? GREEN_YES : RED_NO;
  row.status = payload.success ? '🚀 Deploying' : '⚠️ Blocked (Pre-Deploy)';

} else if (action === 'finalize-success') {
  if (payload.pr_number) row.main_pr = payload.pr_number;
  row.merged_main     = GREEN_YES;
  row.cycle_completed = GREEN_YES;
  row.status          = '✅ Success';

} else if (action === 'finalize-fail') {
  if (payload.pr_number) row.main_pr = payload.pr_number;
  row.merged_main     = RED_NO;
  row.cycle_completed = RED_NO;
  row.status          = '❌ SAP Build Failed';

} else if (action === 'post-conflict') {
  row.merged_main     = GREEN_YES;
  row.cycle_completed = GREEN_YES;
  row.status          = '✅ Success';
}
// ────────────────────────────────────────────────────────────────────────────

fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));

// ── Stale File Cleanup ───────────────────────────────────────────────────────
// Delete any old *-Deployment-History.md files for this environment that were
// written before we renamed the suffix to -Snapshot-History.md.
// Covers two variants:
//   1. Mixed-case slug  e.g. APM-02-DC-AddIn-Deployment-History.md
//   2. All-caps slug    e.g. APM-02-DC-ADDIN-Deployment-History.md (legacy)
const staleFiles = [
  path.join(wikiDir, `${envSlug}-Deployment-History.md`),
  path.join(wikiDir, `${rawEnv.replace(/^AsInt[-_ ]?/i, '').replace(/\s+/g, '-').toUpperCase()}-Deployment-History.md`)
];
for (const stale of staleFiles) {
  if (fs.existsSync(stale)) {
    fs.unlinkSync(stale);
    console.log(`🗑️  Removed stale file: ${path.basename(stale)}`);
  }
}
// ────────────────────────────────────────────────────────────────────────────

// ── Render Markdown table ────────────────────────────────────────────────────
const REPO = process.env.GITHUB_REPOSITORY || 'Daxesh-Asint/GitHub-Actions-Trial-2';

let md = `# ${envSlug} Snapshot History\n\n`;
md += `> Auto-updated by GitHub Actions after every APM-02 snapshot deployment cycle.\n`;
md += `> Each row represents one snapshot cycle: branch creation → tenant merge → SAP CI/CD → base-branch sync.\n\n`;
md += `| # | 📅 Date (IST) | 🌿 Snapshot Branch | ${cleanEnv}<br>PR | Main PR | merged into ${cleanEnv}? | merged into main? | Completed? | Status |\n`;
md += `|---|---|---|---|---|---|---|---|---|\n`;

for (const r of history) {
  // ── Bug Fix #3 ────────────────────────────────────────────────────────────
  // Use environment-agnostic `tenant_pr` field with backwards-compat fallback
  // to the old `apm02_pr` field that may exist in older history rows.
  const tenantPrRaw = r.tenant_pr || r.apm02_pr || 'N/A';
  const tenantPrSafe = (tenantPrRaw && tenantPrRaw !== 'undefined') ? tenantPrRaw : 'N/A';
  const tenantPrLink = (tenantPrSafe !== 'N/A' && tenantPrSafe !== 'NO_COMMITS')
    ? `[#${tenantPrSafe}](https://github.com/${REPO}/pull/${tenantPrSafe})`
    : tenantPrSafe;

  const mainPrRaw  = r.main_pr;
  const mainPrSafe = (mainPrRaw && mainPrRaw !== 'undefined') ? mainPrRaw : 'N/A';
  const mainLink   = (mainPrSafe !== 'N/A' && mainPrSafe !== 'NO_COMMITS')
    ? `[#${mainPrSafe}](https://github.com/${REPO}/pull/${mainPrSafe})`
    : mainPrSafe;
  // ──────────────────────────────────────────────────────────────────────────

  // Backwards-compat for merged_tenant vs old merged_apm02 field
  const mergedTenant = r.merged_tenant || r.merged_apm02 || '-';

  // Format date: "Sep 25, 2026" → "Sep&nbsp;25,<br>2026"
  const dateStr = (r.date || 'N/A').replace(', ', ',<br>').replace(/ /g, '&nbsp;');

  // Format snapshot branch with null guard
  const snapshotDisplay = (r.snapshot && r.snapshot !== 'undefined')
    ? `\`${r.snapshot}\``
    : 'N/A';

  // Format status: emoji + first word on line 1, rest on line 2
  const statusParts = (r.status || '-').split(' ');
  let statusStr = statusParts[0];
  if (statusParts.length > 1) statusStr += '&nbsp;' + statusParts[1];
  if (statusParts.length > 2) statusStr += '<br>' + statusParts.slice(2).join(' ');

  md += `| ${r.id || '-'} | ${dateStr} | ${snapshotDisplay} | ${tenantPrLink} | ${mainLink} | ${mergedTenant} | ${r.merged_main || '-'} | ${r.cycle_completed || '-'} | ${statusStr} |\n`;
}

fs.writeFileSync(mdFile, md);
// ────────────────────────────────────────────────────────────────────────────

try {
  execSync(`git config user.name "github-actions[bot]"`, { cwd: wikiDir });
  execSync(`git config user.email "github-actions[bot]@users.noreply.github.com"`, { cwd: wikiDir });
  // Stage the new snapshot file, the JSON, and also any deleted stale files
  execSync(`git add -A`, { cwd: wikiDir });

  const status = execSync(`git status --porcelain`, { cwd: wikiDir }).toString();
  if (status.trim() !== '') {
    execSync(`git commit -m "docs: Update ${cleanEnv} Snapshot History for ${snapshot}"`, { cwd: wikiDir });
    execSync(`git push`, { cwd: wikiDir });
    console.log("✅ Wiki updated successfully.");
  } else {
    console.log("No changes to commit.");
  }
} catch (error) {
  console.error("Error updating wiki repository:", error.message);
  process.exit(1);
}
