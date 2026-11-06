const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PAYLOAD_STR = process.env.WIKI_PAYLOAD;
if (!PAYLOAD_STR) {
  console.log("No WIKI_PAYLOAD provided. Skipping wiki update.");
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(PAYLOAD_STR);
} catch (e) {
  console.error("Failed to parse WIKI_PAYLOAD JSON:", e.message);
  process.exit(1);
}

const wikiDir = path.join(process.cwd(), 'wiki');
if (!fs.existsSync(wikiDir)) {
  console.error("Wiki directory does not exist at:", wikiDir);
  process.exit(1);
}

// Extract parameters
const rawEnv = payload.environment || payload.deployment_name || payload.resource_name || 'General';

function normalizeEnv(name) {
  if (!name || name === 'General') return 'General';
  let clean = name.replace(/^AsInt[-_ ]?/i, '').replace(/[-_]/g, ' ').trim();
  // Preserve well-known uppercase acronyms
  return clean
    .split(/\s+/)
    .map(word => {
      const upper = word.toUpperCase();
      if (['QA', 'PROD', 'AIS', 'APM', 'EIOT', 'HSC', 'IRC', 'ST', 'ENV', 'DEMO', 'BAYSTAR', 'VMOS', 'DC'].includes(upper)) {
        return upper;
      }
      if (upper === 'ADDIN' || upper === 'ADD-IN') {
        return 'AddIn';
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

const cleanEnv = normalizeEnv(rawEnv);
const envSlug = cleanEnv.replace(/\s+/g, '-');
const envKey = cleanEnv.toLowerCase().replace(/[^a-z0-9]/g, '');

const REPO = process.env.GITHUB_REPOSITORY || 'Daxesh-Asint/GitHub-Actions-Trial-2';
const action = payload.action || 'deploy'; // 'deploy', 'approval_merge', 'conflict_merge', 'sap_start', 'sap_finish'
const prNumber = payload.pr_number ? String(payload.pr_number).replace(/[^0-9]/g, '') : '';
const commitId = payload.commit_id || payload.commit || payload.sha || 'N/A';
const shortCommit = commitId && commitId !== 'N/A' ? commitId.substring(0, 7) : 'N/A';
const sourceBranch = payload.source_branch || payload.head_branch || 'dev';
const targetBranch = payload.target_branch || payload.base_branch || 'tenant';
const actor = payload.actor || payload.initiator || 'github-actions[bot]';
const status = payload.status || 'Success';

const now = new Date();
const dateIST = payload.date || now.toLocaleDateString('en-US', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});
const timeIST = payload.time || now.toLocaleTimeString('en-US', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true
}) + ' IST';

// Styling helpers
function formatBadge(text, type) {
  if (type === 'good') return `<span style="color:#2ea44f;font-weight:bold;">${text}</span>`;
  if (type === 'warn') return `<span style="color:#d99b00;font-weight:bold;">${text}</span>`;
  if (type === 'danger') return `<span style="color:#cb2431;font-weight:bold;">${text}</span>`;
  return `<span>${text}</span>`;
}

function updateHistoryArray(historyList, envName) {
  let entry = null;
  if (prNumber) {
    entry = historyList.find(item => item.pr_number === prNumber);
  }
  if (!entry && shortCommit !== 'N/A') {
    entry = historyList.find(item => item.commit_id && item.commit_id.startsWith(shortCommit));
  }

  if (!entry) {
    const nextId = historyList.length > 0 ? Math.max(...historyList.map(h => h.id || 0)) + 1 : 1;
    entry = {
      id: nextId,
      date: dateIST,
      time: timeIST,
      environment: envName,
      pr_number: prNumber || 'N/A',
      commit_id: shortCommit,
      source_branch: sourceBranch,
      target_branch: targetBranch,
      actor: actor,
      merge_status: 'Merged',
      sap_status: '<nobr>⏳&nbsp;Pending</nobr>',
      status: status
    };
    historyList.unshift(entry);
  }

  if (action === 'deploy' || action === 'merge_attempt') {
    if (status === 'Success' || status === 'Merged') {
      entry.merge_status = formatBadge('<nobr>✅&nbsp;Yes</nobr>', 'good');
      entry.status = '<nobr>🚀&nbsp;Deploying</nobr>';
    } else if (status === 'Awaiting Approval') {
      entry.merge_status = formatBadge('<nobr>⏳&nbsp;Awaiting&nbsp;Approval</nobr>', 'warn');
      entry.status = '<nobr>🟡&nbsp;Awaiting&nbsp;Review</nobr>';
    } else {
      entry.merge_status = formatBadge('<nobr>❌&nbsp;Failed</nobr>', 'danger');
      entry.status = '<nobr>❌&nbsp;Merge&nbsp;Failed</nobr>';
    }
    if (shortCommit !== 'N/A') entry.commit_id = shortCommit;
    if (prNumber) entry.pr_number = prNumber;
  } else if (action === 'approval_merge') {
    entry.merge_status = formatBadge('<nobr>✅&nbsp;Yes&nbsp;(Approved)</nobr>', 'good');
    entry.status = '<nobr>🚀&nbsp;Deploying</nobr>';
    if (shortCommit !== 'N/A') entry.commit_id = shortCommit;
  } else if (action === 'conflict_merge') {
    entry.merge_status = formatBadge('<nobr>✅&nbsp;Yes&nbsp;(Resolved)</nobr>', 'good');
    entry.status = '<nobr>🚀&nbsp;Deploying</nobr>';
    if (shortCommit !== 'N/A') entry.commit_id = shortCommit;
  } else if (action === 'sap_start') {
    entry.sap_status = formatBadge('<nobr>⏳&nbsp;Running</nobr>', 'warn');
    entry.status = '<nobr>🚀&nbsp;In&nbsp;Progress</nobr>';
    if (shortCommit !== 'N/A' && entry.commit_id === 'N/A') entry.commit_id = shortCommit;
  } else if (action === 'sap_finish') {
    if (status === 'SUCCESS' || status === 'INFO') {
      entry.sap_status = formatBadge('<nobr>✅&nbsp;Success</nobr>', 'good');
      entry.status = '<nobr>✅&nbsp;Succeeded</nobr>';
    } else {
      entry.sap_status = formatBadge('<nobr>❌&nbsp;Failed</nobr>', 'danger');
      entry.status = '<nobr>❌&nbsp;SAP&nbsp;Build&nbsp;Failed</nobr>';
    }
    if (shortCommit !== 'N/A' && entry.commit_id === 'N/A') entry.commit_id = shortCommit;
  }

  return entry;
}

function renderMarkdownTable(title, list) {
  let md = `# ${title} Deployment History\n\n`;
  md += `> Auto-updated by GitHub Actions upon every deployment event and SAP CI/CD completion.\n\n`;
  md += `| # | 📅 Date (IST) | 🔀 Pull Request | 🏷️ Commit | 🌿 Source &rarr; Target | 👤 Initiator | 🔀 Merge Status | ⚙️ SAP CI/CD | 📊 Overall Status |\n`;
  md += `|---|---|---|---|---|---|---|---|---|\n`;

  for (const row of list) {
    const prLink = row.pr_number && row.pr_number !== 'N/A'
      ? `[#${row.pr_number}](https://github.com/${REPO}/pull/${row.pr_number})`
      : 'N/A';

    const commitLink = row.commit_id && row.commit_id !== 'N/A'
      ? `[\`${row.commit_id}\`](https://github.com/${REPO}/commit/${row.commit_id})`
      : 'N/A';

    const branches = `<nobr>\`${row.source_branch || '-'}\` &rarr;</nobr><br><nobr>\`${row.target_branch || '-'}\`</nobr>`;
    const dateFormatted = (row.date || '').replace(', ', ',<br>').replace(/ /g, '&nbsp;');
    const initiator = row.actor && row.actor !== 'N/A' ? `<nobr>${row.actor}</nobr>` : 'N/A';

    md += `| ${row.id} | ${dateFormatted} | ${prLink} | ${commitLink} | ${branches} | ${initiator} | ${row.merge_status || '-'} | ${row.sap_status || '-'} | ${row.status || '-'} |\n`;
  }
  return md;
}

// Environments that follow the Snapshot Cycle deployment process (APM-02 family).
// These manage their own dedicated snapshot-cycle tables (via update_wiki.js) and
// are excluded here from individual Deployment-History wiki pages.
// They are still tracked in General Deployment History.
const SNAPSHOT_CYCLE_ENVS = [
  'apm02',       // APM-02 Core
  'asintapm02',  // alias
  'apm02dc',     // APM-02 DC
  'apm02dcaddin' // APM-02 DC AddIn
];

// ── Stale File Cleanup ───────────────────────────────────────────────────────
// If any *-Deployment-History.md files still exist for snapshot-cycle environments
// (written before those envs were added to SNAPSHOT_CYCLE_ENVS), delete them now.
// Converts filename slug back to envKey: remove suffix, lowercase, strip non-alphanumeric.
// e.g. "APM-02-DC-AddIn-Deployment-History.md" → slug "APM-02-DC-AddIn" → key "apm02dcaddin" → match!
const allWikiFiles = fs.readdirSync(wikiDir);
for (const f of allWikiFiles) {
  if (!f.endsWith('-Deployment-History.md')) continue;
  const slug = f.replace(/-Deployment-History\.md$/, '');
  const key  = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SNAPSHOT_CYCLE_ENVS.includes(key)) {
    const stalePath = path.join(wikiDir, f);
    fs.unlinkSync(stalePath);
    console.log(`🗑️  Removed stale deployment history page for snapshot env: ${f}`);
  }
}
// ────────────────────────────────────────────────────────────────────────────

// 1. Update individual environment history
const targets = [];
if (cleanEnv && cleanEnv !== 'General' && !SNAPSHOT_CYCLE_ENVS.includes(envKey)) {
  targets.push({
    name: cleanEnv,
    jsonPath: path.join(wikiDir, `${envKey}_history.json`),
    mdPath: path.join(wikiDir, `${envSlug}-Deployment-History.md`)
  });
}

// 2. Always keep General Deployment History updated with all deployments across every environment
targets.push({
  name: 'General',
  jsonPath: path.join(wikiDir, 'general_history.json'),
  mdPath: path.join(wikiDir, 'General-Deployment-History.md')
});

for (const target of targets) {
  let hist = [];
  if (fs.existsSync(target.jsonPath)) {
    try {
      hist = JSON.parse(fs.readFileSync(target.jsonPath, 'utf8'));
    } catch (e) {
      hist = [];
    }
  }

  updateHistoryArray(hist, target.name === 'General' ? cleanEnv : target.name);
  fs.writeFileSync(target.jsonPath, JSON.stringify(hist, null, 2), 'utf8');
  fs.writeFileSync(target.mdPath, renderMarkdownTable(target.name, hist), 'utf8');
}

// 3. Update Home.md index
const homeMdFile = path.join(wikiDir, 'Home.md');
let homeContent = `# Welcome to the Repository Deployment Wiki\n\n`;
homeContent += `Auto-generated deployment logs and tracking across all configured tenant environments.\n\n`;

// ── Section A: Individual Tenant Deployment Histories ───────────────────────
homeContent += `### 🌐 Tenant Deployment Histories\n\n`;
homeContent += `| Environment | Wiki History Page | Last Activity (IST) |\n`;
homeContent += `|:---|:---|:---|\n`;

const files = fs.readdirSync(wikiDir);
const deploymentPages = files.filter(f => f.endsWith('-Deployment-History.md')).sort();

for (const page of deploymentPages) {
  const label = page.replace(/-Deployment-History\.md$/, '').replace(/-/g, ' ');
  const pageNameNoExt = page.replace(/\.md$/, '');
  const pagePath = path.join(wikiDir, page);
  const mtime = fs.statSync(pagePath).mtime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) + ' IST';
  homeContent += `| **${label}** | [${label} Deployment History](${pageNameNoExt}) | ${mtime} |\n`;
}

// ── Section B: APM-02 Family Snapshot Histories (managed by update_wiki.js) ──
const snapshotPages = files.filter(f => f.endsWith('-Snapshot-History.md')).sort();
if (snapshotPages.length > 0) {
  homeContent += `\n### 📸 APM-02 Snapshot Deployment Histories\n\n`;
  homeContent += `| Environment | Wiki History Page | Last Activity (IST) |\n`;
  homeContent += `|:---|:---|:---|\n`;
  for (const page of snapshotPages) {
    const label = page.replace(/-Snapshot-History\.md$/, '').replace(/-/g, ' ');
    const pageNameNoExt = page.replace(/\.md$/, '');
    const pagePath = path.join(wikiDir, page);
    const mtime = fs.statSync(pagePath).mtime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) + ' IST';
    homeContent += `| **${label}** | [${label} Snapshot History](${pageNameNoExt}) | ${mtime} |\n`;
  }
}

homeContent += `\n*Page dynamically maintained by GitHub Actions automation workflows.*\n`;
fs.writeFileSync(homeMdFile, homeContent, 'utf8');

// 4. Commit & push to wiki repo
try {
  execSync(`git config user.name "github-actions[bot]"`, { cwd: wikiDir });
  execSync(`git config user.email "github-actions[bot]@users.noreply.github.com"`, { cwd: wikiDir });
  execSync(`git add .`, { cwd: wikiDir });

  const statusOut = execSync(`git status --porcelain`, { cwd: wikiDir }).toString();
  if (statusOut.trim() !== '') {
    execSync(`git commit -m "docs(wiki): update deployment history for ${cleanEnv}"`, { cwd: wikiDir });
    execSync(`git push`, { cwd: wikiDir });
    console.log(`✅ Wiki successfully updated and pushed for ${cleanEnv}!`);
  } else {
    console.log("No wiki changes to commit.");
  }
} catch (error) {
  console.error("Error committing to wiki repository:", error.message);
  process.exit(1);
}
