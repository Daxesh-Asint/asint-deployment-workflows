const fs = require('fs');
/**
 * Parse QUnit test results from WDIO/QUnit log output
 */
function parseQUnitResults(logContent, moduleName) {
    const results = {
        total: 0,
        passed: 0,
        failed: 0,
        tests: []
    };
    const lines = logContent.split('\n');
    // Find the module section in the log
    let inModuleSection = false;
    let moduleFound = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Look for test results first (has checkmark)
        // WDIO format: [chrome 147.0.7727.57 linux #0-0]    ✓ test name
        // or: [chrome 147.0.7727.57 linux #0-0]    ✖ test name
        const testMatch = line.match(/\[chrome[^\]]+\]\s+(✓|✖)\s+(.+?)$/);
        if (testMatch && inModuleSection) {
            const checkMark = testMatch[1];
            const testName = testMatch[2].trim();
            const isPassed = checkMark === '✓';
            // Extract error message if failed
            let errorMessage = '';
            if (!isPassed) {
                // Look back for error details in the WDIO error logs
                // Error format: [0-0] timestamp ERROR wdio-qunit-service: QUnit Test: ModuleName.testName
                // Followed by: Expected:, Received:, Message: lines
                let expectedVal = '';
                let receivedVal = '';
                let errorMsg = '';
                let foundErrorBlock = false;
                // Search backwards for ERROR wdio-qunit-service messages containing this test
                for (let j = Math.max(0, i - 25); j < i; j++) {
                    const errorLine = lines[j];
                    // Check if this is an ERROR line mentioning our test
                    // The test name appears as "ModuleName.testName" in the error
                    if (errorLine.includes('ERROR wdio-qunit-service') && 
                        (errorLine.includes(testName) || errorLine.includes(`.${testName}`))) {
                        foundErrorBlock = true;
                        // Now collect Expected/Received/Message from following lines
                        for (let k = j + 1; k < Math.min(j + 6, lines.length); k++) {
                            if (lines[k].includes('ERROR wdio-qunit-service: Expected:')) {
                                expectedVal = lines[k].split('Expected:')[1].trim();
                            } else if (lines[k].includes('ERROR wdio-qunit-service: Received:')) {
                                receivedVal = lines[k].split('Received:')[1].trim();
                            } else if (lines[k].includes('ERROR wdio-qunit-service: Message:')) {
                                errorMsg = lines[k].split('Message:')[1].trim();
                            }
                        }
                        break;
                    }
                }
                // Build concise error message
                if (errorMsg) errorMessage += errorMsg + ' | ';
                if (expectedVal && receivedVal) {
                    errorMessage += `Expected: ${expectedVal}, Got: ${receivedVal}`;
                } else if (expectedVal) {
                    errorMessage += `Expected: ${expectedVal}`;
                } else if (receivedVal) {
                    errorMessage += `Got: ${receivedVal}`;
                }
            }
            results.tests.push({
                module: moduleName,
                name: testName,
                status: isPassed ? 'passed' : 'failed',
                message: errorMessage.trim()
            });
            if (isPassed) results.passed++;
            else results.failed++;
            continue;
        }
        // WDIO format module header: [chrome 147.0.7727.57 linux #0-0] Module Name
        // This line should NOT have ✓ or ✖ in it
        if (!line.includes('✓') && !line.includes('✖')) {
            const moduleHeaderMatch = line.match(/\[chrome[^\]]+\]\s+(.+?)$/);
            if (moduleHeaderMatch) {
                const lineModuleName = moduleHeaderMatch[1].trim();
                // Check if this is our target module
                if (lineModuleName === moduleName) {
                    inModuleSection = true;
                    moduleFound = true;
                    continue;
                } else if (inModuleSection && lineModuleName && lineModuleName.length > 0) {
                    // We've moved to a different module section, stop parsing
                    // Check if this looks like a module name (not too long, capitalized, etc.)
                    if (lineModuleName.length < 100 && /^[A-Z]/.test(lineModuleName)) {
                        break;
                    }
                }
            }
        }
    }
    if (!moduleFound) {
    }
    results.total = results.passed + results.failed;
    return results;
}
/**
 * Generate markdown table for PR comment
 */
function generateMarkdownTable(projectModules, allTestResults, skippedProjects = []) {
    let markdown = '# 🧪 UI Test Check\n\n';
    const skippedProjectNames = skippedProjects.map(s => s.project);
    // Calculate summary statistics (only count modules with actual changed tests)
    const totalChanged = Object.entries(projectModules)
        .filter(([key]) => key !== 'changedSourceFiles' && !skippedProjectNames.includes(key))
        .flatMap(([, modules]) => 
            modules
                .filter(m => m.changedTests && m.changedTests.length > 0)
                .flatMap(m => m.changedTests)
        ).length;
    const changedTests = allTestResults.filter(t => t.changed);
    const changedPassed = changedTests.filter(t => t.status === 'passed').length;
    const changedFailed = changedTests.filter(t => t.status === 'failed').length;
    const regressions = allTestResults.filter(t => !t.changed && t.status === 'failed');
    const totalTests = allTestResults.length;
    const totalPassed = allTestResults.filter(t => t.status === 'passed').length;
    const totalFailed = allTestResults.filter(t => t.status === 'failed').length;
    // Summary status
    if (changedFailed === 0 && regressions.length === 0) {
        markdown += '> **✅ All Tests Passed**\n\n';
    } else {
        markdown += '> **❌ Tests Failed**\n\n';
    }
    // Total changed summary
    markdown += `## 📊 Summary\n\n`;
    markdown += `- **Total Tests:** ${totalPassed}/${totalTests} passed (from changed modules)`;
    if (regressions.length > 0) {
        markdown += ` • ⚠️ ${regressions.length} regression(s)`;
    }
    markdown += `\n- **Changed Tests:** ${changedPassed}/${totalChanged} passed\n\n`;
    // Collapsible: Changed Files
    const changedSourceFiles = projectModules.changedSourceFiles || [];
    if (changedSourceFiles.length > 0) {
        markdown += '<details>\n';
        markdown += '<summary>📁 Changed Files (' + changedSourceFiles.length + ')</summary>\n\n';
        changedSourceFiles.forEach(file => {
            markdown += `- \`${file.project}/${file.file}\`\n`;
        });
        markdown += '\n</details>\n\n';
    }
    // Collapsible: QUnit Modules (only show modules with changed tests)
    const modulesList = Object.entries(projectModules)
        .filter(([key]) => key !== 'changedSourceFiles' && !skippedProjectNames.includes(key))
        .flatMap(([project, modules]) => 
            modules
                .filter(m => m.changedTests && m.changedTests.length > 0)
                .map(m => ({ project, ...m }))
        );
    if (modulesList.length > 0) {
        markdown += '<details>\n';
        markdown += '<summary>📦 QUnit Modules Tested (' + modulesList.length + ')</summary>\n\n';
        markdown += '| Project | Module | Total Tests | Changed Tests |\n';
        markdown += '|---------|--------|------------:|--------------:|\n';
        modulesList.forEach(mod => {
            markdown += `| ${mod.project} | ${mod.module} | ${mod.allTests.length} | ${mod.changedTests.length} |\n`;
        });
        markdown += '\n</details>\n\n';
    }
    // Skipped projects section
    if (skippedProjects.length > 0) {
        markdown += '<details>\n';
        markdown += '<summary>⏭ Skipped Projects (' + skippedProjects.length + ')</summary>\n\n';
        markdown += '| Project | Reason |\n';
        markdown += '|---------|--------|\n';
        skippedProjects.forEach(s => {
            markdown += `| \`${s.project}\` | ${s.reason} |\n`;
        });
        markdown += '\n</details>\n\n';
    }
    // Test Results Table (only changed + failed)
    const testsToShow = allTestResults.filter(t => t.changed || t.status === 'failed');
    if (testsToShow.length > 0) {
        markdown += '## 🧪 Test Results\n\n';
        markdown += '<table>\n';
        markdown += '<thead>\n';
        markdown += '<tr>\n';
        markdown += '<th width="25%">Project</th>\n';
        markdown += '<th width="30%">Module</th>\n';
        markdown += '<th width="30%" nowrap>Test</th>\n';
        markdown += '<th width="8%" align="center">Status</th>\n';
        markdown += '<th width="7%">Type</th>\n';
        markdown += '</tr>\n';
        markdown += '</thead>\n';
        markdown += '<tbody>\n';
        testsToShow.forEach(test => {
            const statusIcon = test.status === 'passed' ? '✅' : '❌';
            const type = test.changed ? 'Changed' : 'Regression';
            markdown += '<tr>\n';
            markdown += `<td>${test.project}</td>\n`;
            markdown += `<td>${test.module}</td>\n`;
            markdown += `<td nowrap>${test.name}</td>\n`;
            markdown += `<td align="center">${statusIcon}</td>\n`;
            markdown += `<td>${type}</td>\n`;
            markdown += '</tr>\n';
        });
        markdown += '</tbody>\n';
        markdown += '</table>\n\n';
    }
    return markdown;
}
/**
 * Main function
 */
function main() {
    // Read ui-modules-to-test.json
    if (!fs.existsSync('ui-modules-to-test.json')) {
        process.exit(1);
    }
    const projectModules = JSON.parse(fs.readFileSync('ui-modules-to-test.json', 'utf8'));

    // Read skipped projects
    let skippedProjects = [];
    if (fs.existsSync('ui-skipped-projects.json')) {
        skippedProjects = JSON.parse(fs.readFileSync('ui-skipped-projects.json', 'utf8'));
    }
    const skippedProjectNames = skippedProjects.map(s => s.project);

    const projectKeys = Object.keys(projectModules).filter(k => k !== 'changedSourceFiles' && !skippedProjectNames.includes(k));
    if (projectKeys.length === 0 && skippedProjects.length > 0) {
        // All projects were skipped - generate informational comment
        let markdown = '# 🧪 UI Test Check\n\n';
        markdown += '## ⏭ Tests Skipped\n\n';
        markdown += '**No projects with `unit-tests-headless` script were found.**\n\n';
        markdown += '| Project | Reason |\n';
        markdown += '|---------|--------|\n';
        skippedProjects.forEach(s => {
            markdown += `| \`${s.project}\` | ${s.reason} |\n`;
        });
        markdown += '\n---\n\n';
        markdown += '> 💡 Add a `unit-tests-headless` script to the project\'s `package.json` to enable automated testing.';
        fs.writeFileSync('ui-pr-comment.md', markdown);
        console.log('⏭ All projects skipped - no tests ran');
        process.exit(0);
    }
    if (projectKeys.length === 0) {
        process.exit(0);
    }
    // Read test results from all projects (only for modules with changed tests)
    const allResults = [];
    Object.entries(projectModules)
        .filter(([key]) => key !== 'changedSourceFiles' && !skippedProjectNames.includes(key)) // Skip metadata and skipped project keys
        .forEach(([project, modules]) => {
        const logFile = `${project}-ui-test-output.log`;
        if (fs.existsSync(logFile)) {
            const logContent = fs.readFileSync(logFile, 'utf8');
            
            // Only process modules that have changed tests
            const modulesWithChanges = modules.filter(m => m.changedTests && m.changedTests.length > 0);
            
            modulesWithChanges.forEach(moduleInfo => {
                // Parse results for this module
                const results = parseQUnitResults(logContent, moduleInfo.module);
                // Mark which tests were changed
                results.tests.forEach(test => {
                    test.project = project;
                    test.changed = moduleInfo.changedTests.includes(test.name);
                });
                allResults.push(...results.tests);
            });
        } else {
        }
    });
    // Generate markdown
    const markdown = generateMarkdownTable(projectModules, allResults, skippedProjects);
    // Write to file
    fs.writeFileSync('ui-pr-comment.md', markdown);
    
    console.log(`✓ Generated test report with ${allResults.length} test result(s)`);
}
main();
