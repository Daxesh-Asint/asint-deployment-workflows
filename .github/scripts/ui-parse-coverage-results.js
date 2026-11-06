const fs = require('fs');
const path = require('path');

/**
 * Parse coverage data and filter by changed files
 */
function parseCoverageResults() {
    console.log('Parsing coverage results...');
    
    const modulesData = JSON.parse(fs.readFileSync('ui-modules-to-test.json', 'utf8'));
    const changedSourceFiles = modulesData.changedSourceFiles || [];

    // Filter out skipped projects so their source files are not evaluated for coverage
    let skippedProjectNames = [];
    if (fs.existsSync('ui-skipped-projects.json')) {
        const skipped = JSON.parse(fs.readFileSync('ui-skipped-projects.json', 'utf8'));
        skippedProjectNames = skipped.map(s => s.project);
    }
    const effectiveSourceFiles = changedSourceFiles.filter(f => !skippedProjectNames.includes(f.project));

    const coverageResults = [];

    // Group changed files by project
    const filesByProject = {};
    effectiveSourceFiles.forEach(f => {
        if (!filesByProject[f.project]) {
            filesByProject[f.project] = [];
        }
        filesByProject[f.project].push(f);
    });

    // Process each project
    Object.keys(filesByProject).forEach(project => {
        const coverageFile = path.join(project, 'tmp', 'coverage-reports', 'json', 'coverage-final.json');
        

        if (!fs.existsSync(coverageFile)) {
            return;
        }

        const coverageData = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));

        // Filter coverage data for changed files
        filesByProject[project].forEach(sourceFile => {
            const file = sourceFile.file;
            
            // Try to find the file in coverage data
            // Coverage keys might have absolute paths or relative paths
            const matchingKeys = Object.keys(coverageData).filter(key => {
                return key.includes(file) || key.endsWith(file);
            });

            if (matchingKeys.length === 0) {
                coverageResults.push({
                    project,
                    file,
                    statements: { pct: 0, covered: 0, total: 0 },
                    branches: { pct: 0, covered: 0, total: 0 },
                    functions: { pct: 0, covered: 0, total: 0 },
                    lines: { pct: 0, covered: 0, total: 0 },
                    noCoverage: true
                });
                return;
            }

            // Use the first matching key
            const coverageKey = matchingKeys[0];
            const fileCoverage = coverageData[coverageKey];

            // Calculate diff coverage - only for changed lines
            const coverage = calculateDiffCoverage(fileCoverage, sourceFile.changedRanges || []);
            
            const statements = coverage.statements;
            const branches = coverage.branches;
            const functions = coverage.functions;
            const lines = coverage.lines;

            const rangeInfo = sourceFile.changedRanges && sourceFile.changedRanges.length > 0 
                ? ` [diff coverage]` 
                : ` [full file]`;
            
            console.log(`  ${file}${rangeInfo} - S:${statements.pct}% B:${branches.pct}% F:${functions.pct}% L:${lines.pct}%`);

            coverageResults.push({
                project,
                file,
                statements,
                branches,
                functions,
                lines
            });
        });

    });

    return coverageResults;
}

/**
 * Calculate statement coverage
 */
function calculateStatementCoverage(statements) {
    if (!statements || Object.keys(statements).length === 0) {
        return { pct: 0, covered: 0, total: 0 };
    }
    const total = Object.keys(statements).length;
    const covered = Object.values(statements).filter(count => count > 0).length;
    const pct = total > 0 ? Math.round((covered / total) * 100 * 100) / 100 : 0;
    return { pct, covered, total };
}

/**
 * Calculate branch coverage
 */
function calculateBranchCoverage(branches) {
    if (!branches || Object.keys(branches).length === 0) {
        return { pct: 0, covered: 0, total: 0 };
    }
    let total = 0;
    let covered = 0;
    
    // Each branch has an array of paths [path1Hits, path2Hits, ...]
    Object.values(branches).forEach(branchPaths => {
        if (Array.isArray(branchPaths)) {
            total += branchPaths.length;
            covered += branchPaths.filter(hits => hits > 0).length;
        }
    });
    
    const pct = total > 0 ? Math.round((covered / total) * 100 * 100) / 100 : 0;
    return { pct, covered, total };
}

/**
 * Calculate function coverage
 */
function calculateFunctionCoverage(functions) {
    if (!functions || Object.keys(functions).length === 0) {
        return { pct: 0, covered: 0, total: 0 };
    }
    const total = Object.keys(functions).length;
    const covered = Object.values(functions).filter(count => count > 0).length;
    const pct = total > 0 ? Math.round((covered / total) * 100 * 100) / 100 : 0;
    return { pct, covered, total };
}

/**
 * Calculate line coverage from statements
 */
function calculateLineCoverage(statements, statementMap) {
    if (!statements || !statementMap || Object.keys(statements).length === 0) {
        return { pct: 0, covered: 0, total: 0 };
    }
    
    const lineHits = {};
    
    // Map statements to lines
    Object.keys(statements).forEach(stmtId => {
        const stmt = statementMap[stmtId];
        if (stmt && stmt.start && stmt.start.line) {
            const line = stmt.start.line;
            if (!lineHits[line]) {
                lineHits[line] = 0;
            }
            lineHits[line] += statements[stmtId];
        }
    });
    
    const total = Object.keys(lineHits).length;
    const covered = Object.values(lineHits).filter(hits => hits > 0).length;
    const pct = total > 0 ? Math.round((covered / total) * 100 * 100) / 100 : 0;
    
    return { pct, covered, total };
}

/**
 * Check if a line is within any of the changed ranges
 */
function isLineInChangedRanges(line, ranges) {
    if (!ranges || ranges.length === 0) {
        return true; // If no ranges (inferred file), include all
    }
    return ranges.some(range => line >= range.start && line <= range.end);
}

/**
 * Calculate diff coverage - only for changed lines
 */
function calculateDiffCoverage(fileCoverage, changedRanges) {
    if (!changedRanges || changedRanges.length === 0) {
        // No specific ranges - calculate full file coverage
        return {
            statements: calculateStatementCoverage(fileCoverage.s),
            branches: calculateBranchCoverage(fileCoverage.b),
            functions: calculateFunctionCoverage(fileCoverage.f),
            lines: calculateLineCoverage(fileCoverage.s, fileCoverage.statementMap)
        };
    }
    
    // Filter statements to only changed lines
    const filteredStatements = {};
    Object.keys(fileCoverage.s).forEach(stmtId => {
        const stmt = fileCoverage.statementMap[stmtId];
        if (stmt && stmt.start && isLineInChangedRanges(stmt.start.line, changedRanges)) {
            filteredStatements[stmtId] = fileCoverage.s[stmtId];
        }
    });
    
    // Filter branches to only changed lines
    const filteredBranches = {};
    Object.keys(fileCoverage.b).forEach(branchId => {
        const branch = fileCoverage.branchMap[branchId];
        if (branch && branch.loc && isLineInChangedRanges(branch.loc.start.line, changedRanges)) {
            filteredBranches[branchId] = fileCoverage.b[branchId];
        }
    });
    
    // Filter functions to only changed lines
    const filteredFunctions = {};
    Object.keys(fileCoverage.f).forEach(fnId => {
        const fn = fileCoverage.fnMap[fnId];
        if (fn && fn.loc && isLineInChangedRanges(fn.loc.start.line, changedRanges)) {
            filteredFunctions[fnId] = fileCoverage.f[fnId];
        }
    });
    
    return {
        statements: calculateStatementCoverage(filteredStatements),
        branches: calculateBranchCoverage(filteredBranches),
        functions: calculateFunctionCoverage(filteredFunctions),
        lines: calculateLineCoverage(filteredStatements, fileCoverage.statementMap)
    };
}

/**
 * Calculate overall coverage percentage
 */
function calculateOverallCoverage(coverageResults) {
    if (!coverageResults || coverageResults.length === 0) {
        return { pct: 0, covered: 0, total: 0 };
    }

    // Aggregate all metrics
    let totalStatements = 0, coveredStatements = 0;
    let totalBranches = 0, coveredBranches = 0;
    let totalFunctions = 0, coveredFunctions = 0;
    let totalLines = 0, coveredLines = 0;

    coverageResults.forEach(result => {
        totalStatements += result.statements.total;
        coveredStatements += result.statements.covered;
        totalBranches += result.branches.total;
        coveredBranches += result.branches.covered;
        totalFunctions += result.functions.total;
        coveredFunctions += result.functions.covered;
        totalLines += result.lines.total;
        coveredLines += result.lines.covered;
    });

    // Calculate average percentage across all four metrics
    const stmtPct = totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0;
    const branchPct = totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0;
    const fnPct = totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0;
    const linePct = totalLines > 0 ? (coveredLines / totalLines) * 100 : 0;

    // Average of all four metrics
    const overallPct = Math.round(((stmtPct + branchPct + fnPct + linePct) / 4) * 100) / 100;

    return {
        pct: overallPct,
        statements: { pct: Math.round(stmtPct * 100) / 100, covered: coveredStatements, total: totalStatements },
        branches: { pct: Math.round(branchPct * 100) / 100, covered: coveredBranches, total: totalBranches },
        functions: { pct: Math.round(fnPct * 100) / 100, covered: coveredFunctions, total: totalFunctions },
        lines: { pct: Math.round(linePct * 100) / 100, covered: coveredLines, total: totalLines }
    };
}

/**
 * Generate markdown table
 */
function generateMarkdownTable(coverageResults) {
    if (!coverageResults || coverageResults.length === 0) {
        return null;
    }

    const COVERAGE_THRESHOLD = 80;
    const overallCoverage = calculateOverallCoverage(coverageResults);
    const meetsThreshold = overallCoverage.pct >= COVERAGE_THRESHOLD;

    const lines = [
        '## 📊 Code Coverage',
        '',
        `**Overall Coverage: ${overallCoverage.pct}%** (Threshold: ≥${COVERAGE_THRESHOLD}%)`,
        '',
        '| Metric | Coverage |',
        '|--------|----------|',
        `| Statements | ${formatBadgeInline(overallCoverage.statements)} |`,
        `| Branches | ${formatBadgeInline(overallCoverage.branches)} |`,
        `| Functions | ${formatBadgeInline(overallCoverage.functions)} |`,
        `| Lines | ${formatBadgeInline(overallCoverage.lines)} |`,
        '',
        meetsThreshold 
            ? '✅ **Coverage check passed** — PR can be merged'
            : `❌ **Coverage check failed** — Minimum ${COVERAGE_THRESHOLD}% coverage required`,
        '',
        '<details>',
        '<summary>📁 File-level Coverage Details</summary>',
        '',
        '<table>',
        '<thead>',
        '<tr>',
        '<th width="20%">Project</th>',
        '<th width="25%" nowrap>File</th>',
        '<th width="15%" align="center">Statements</th>',
        '<th width="15%" align="center">Branches</th>',
        '<th width="15%" align="center">Functions</th>',
        '<th width="15%" align="center">Lines</th>',
        '</tr>',
        '</thead>',
        '<tbody>'
    ];

    coverageResults.forEach(result => {
        const stmtBadge = formatBadge(result.statements);
        const branchBadge = formatBadge(result.branches);
        const fnBadge = formatBadge(result.functions);
        const lineBadge = formatBadge(result.lines);

        const fileName = result.file.length > 40 
            ? '...' + result.file.substring(result.file.length - 37) 
            : result.file;

        lines.push(
            '<tr>',
            `<td>${result.project}</td>`,
            `<td nowrap><code>${fileName}</code></td>`,
            `<td align="center">${stmtBadge}</td>`,
            `<td align="center">${branchBadge}</td>`,
            `<td align="center">${fnBadge}</td>`,
            `<td align="center">${lineBadge}</td>`,
            '</tr>'
        );
    });

    lines.push(
        '</tbody>',
        '</table>',
        '',
        '</details>'
    );
    lines.push('');
    lines.push('_Coverage for changed lines only (diff coverage) - Statements / Branches / Functions / Lines_');
    lines.push('');

    return { markdown: lines.join('\n'), meetsThreshold, overallPct: overallCoverage.pct };
}

/**
 * Format coverage percentage with badge/color and counts
 */
function formatBadge(coverage) {
    const pct = coverage.pct;
    const counts = `(${coverage.covered}/${coverage.total})`;
    
    if (pct >= 80) {
        return `🟢 ${pct}% ${counts}`;
    } else if (pct >= 50) {
        return `🟡 ${pct}% ${counts}`;
    } else {
        return `🔴 ${pct}% ${counts}`;
    }
}

/**
 * Format coverage percentage for inline display with visual bar
 */
function formatBadgeInline(coverage) {
    const pct = coverage.pct;
    
    let emoji;
    if (pct >= 80) {
        emoji = '🟢';
    } else if (pct >= 50) {
        emoji = '🟡';
    } else {
        emoji = '🔴';
    }
    
    return `${emoji} ${pct}%`;
}


/**
 * Main function
 */
function main() {
    // Check if ui-modules-to-test.json exists
    if (!fs.existsSync('ui-modules-to-test.json')) {
        addSkipMessage('No test changes detected');
        return;
    }

    const modulesData = JSON.parse(fs.readFileSync('ui-modules-to-test.json', 'utf8'));
    const changedSourceFiles = modulesData.changedSourceFiles || [];

    if (changedSourceFiles.length === 0) {
        addSkipMessage('No source files changed (only test files modified)');
        return;
    }

    // Check if all source file changes belong to projects that were skipped
    let skippedProjectNames = [];
    if (fs.existsSync('ui-skipped-projects.json')) {
        const skipped = JSON.parse(fs.readFileSync('ui-skipped-projects.json', 'utf8'));
        skippedProjectNames = skipped.map(s => s.project);
    }
    if (changedSourceFiles.length > 0 && changedSourceFiles.every(f => skippedProjectNames.includes(f.project))) {
        addSkipMessage('All projects with source changes were skipped (unit-tests-headless not configured)');
        return;
    }

    const coverageResults = parseCoverageResults();

    if (!coverageResults || coverageResults.length === 0) {
        addSkipMessage('Coverage data not available');
        return;
    }

    const result = generateMarkdownTable(coverageResults);

    if (!result) {
        return;
    }

    // Append to ui-pr-comment.md if it exists, otherwise create new
    let existingComment = '';
    if (fs.existsSync('ui-pr-comment.md')) {
        existingComment = fs.readFileSync('ui-pr-comment.md', 'utf8');
        
        // Update the status blockquote to include coverage
        const coverageStatusText = result.meetsThreshold 
            ? ` | ✅ Coverage: ${result.overallPct}%` 
            : ` | ❌ Coverage: ${result.overallPct}%`;
        
        // Replace "> **✅ All Tests Passed**" or "> **❌ Tests Failed**" with version that includes coverage
        existingComment = existingComment.replace(
            /^> \*\*(✅ All Tests Passed|❌ Tests Failed)\*\*$/m,
            `> **$1${coverageStatusText}**`
        );
    }

    const updatedComment = existingComment + '\n\n' + result.markdown;
    fs.writeFileSync('ui-pr-comment.md', updatedComment);

    // Log result
    console.log(`\n${result.meetsThreshold ? '✅' : '❌'} Overall coverage: ${result.overallPct}% (threshold: ≥80%)`);

    // Exit with error code if threshold not met
    if (!result.meetsThreshold) {
        console.log('❌ Coverage check failed - PR cannot be merged\n');
        process.exit(1);
    } else {
        console.log('✅ Coverage check passed - PR can be merged\n');
    }

}

/**
 * Add skip message to ui-pr-comment.md
 */
function addSkipMessage(reason) {
    const skipMessage = [
        '### 📊 Code Coverage',
        '',
        `_Coverage report skipped: ${reason}_`,
        ''
    ].join('\n');

    let existingComment = '';
    if (fs.existsSync('ui-pr-comment.md')) {
        existingComment = fs.readFileSync('ui-pr-comment.md', 'utf8');
    }

    const updatedComment = existingComment + '\n\n' + skipMessage;
    fs.writeFileSync('ui-pr-comment.md', updatedComment);

}

main();
