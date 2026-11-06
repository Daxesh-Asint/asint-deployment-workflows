const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
/**
 * Get changed test files from git diff
 */
function getChangedTestFiles(baseRef, headRef) {
    try {
        const diff = execSync(
            `git diff ${baseRef}..${headRef} --name-only`,
            { encoding: 'utf8' }
        );
        const files = diff.split('\n')
            .filter(f => f.trim().length > 0)
            .filter(f => f.includes('/webapp/test/unit/') && (f.endsWith('.js') || f.endsWith('.test.js')))
            .filter(f => {
                const fileName = path.basename(f);
                const excludePatterns = [
                    'unitTests.qunit.js',
                    'AllTests.js',
                    'wdioTestRunner.js',
                    'wdio.conf.js',
                    'testsuite.qunit.js'
                ];
                return !excludePatterns.includes(fileName);
            });
        return files;
    } catch (error) {
        console.error('Error getting changed test files:', error.message);
        return [];
    }
}
/**
 * Get changed source files from git diff (for coverage filtering)
 * Includes both directly modified source files AND source files tested by changed test files
 */
function getChangedSourceFiles(baseRef, headRef, changedTestFiles) {
    try {
        const diff = execSync(
            `git diff ${baseRef}..${headRef} --name-only`,
            { encoding: 'utf8' }
        );
        // Get directly modified source files
        const modifiedSourceFiles = diff.split('\n')
            .filter(f => f.trim().length > 0)
            .filter(f => f.includes('/webapp/') && f.endsWith('.js'))
            .filter(f => {
                // Include controller, model, and Component.js files
                return f.includes('/controller/') || 
                       f.includes('/model/') || 
                       f.endsWith('/Component.js');
            })
            .filter(f => {
                // Exclude test files
                return !f.includes('/test/');
            });
        // Map changed test files to their corresponding source files
        const inferredSourceFiles = changedTestFiles.map(testFile => {
            // Convert test path to source path
            // e.g., project1/webapp/test/unit/controller/App.controller.js
            //    -> project1/webapp/controller/App.controller.js
            if (testFile.includes('/test/unit/controller/')) {
                return testFile.replace('/test/unit/controller/', '/controller/');
            } else if (testFile.includes('/test/unit/model/')) {
                return testFile.replace('/test/unit/model/', '/model/');
            } else if (testFile.includes('/test/unit/') && testFile.endsWith('Component.js')) {
                return testFile.replace('/test/unit/', '/');
            }
            return null;
        }).filter(f => f !== null);
        // Combine and deduplicate
        const allSourceFiles = [...new Set([...modifiedSourceFiles, ...inferredSourceFiles])];
        // Verify files exist and format output WITH line ranges
        const result = allSourceFiles
            .filter(f => {
                try {
                    return fs.existsSync(f);
                } catch (e) {
                    return false;
                }
            })
            .map(f => {
                // Extract project name
                const projectName = f.split('/')[0];
                // Get relative path from webapp
                const webappIndex = f.indexOf('/webapp/');
                const relativePath = webappIndex >= 0 ? f.substring(webappIndex + 8) : f;
                // Get changed line ranges for directly modified files
                let changedRanges = [];
                if (modifiedSourceFiles.includes(f)) {
                    changedRanges = getChangedLineRanges(f, baseRef, headRef);
                }
                return {
                    project: projectName,
                    file: relativePath,
                    fullPath: f,
                    changedRanges: changedRanges,
                    isDirect: modifiedSourceFiles.includes(f) // true if directly modified, false if inferred from tests
                };
            });
        return result;
    } catch (error) {
        return [];
    }
}
/**
 * Get changed line ranges from git diff
 */
function getChangedLineRanges(filePath, baseRef, headRef) {
    try {
        const diff = execSync(
            `git diff ${baseRef}..${headRef} --unified=0 -- "${filePath}"`,
            { encoding: 'utf8' }
        );
        const ranges = [];
        const lines = diff.split('\n');
        const hunkRegex = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
        lines.forEach(line => {
            const match = line.match(hunkRegex);
            if (match) {
                const start = parseInt(match[1], 10);
                const count = match[2] ? parseInt(match[2], 10) : 1;
                const end = start + count - 1;
                ranges.push({ start, end });
            }
        });
        return ranges;
    } catch (error) {
        return [];
    }
}
/**
 * Extract module name and changed tests from a test file
 */
function extractModuleAndTests(filePath, baseRef, headRef) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Extract all modules with their line numbers
        const modules = [];
        const moduleRegex = /QUnit\.module\s*\(\s*["']([^"']+)["']/g;
        let moduleMatch;
        
        while ((moduleMatch = moduleRegex.exec(content)) !== null) {
            const moduleName = moduleMatch[1];
            const beforeMatch = content.substring(0, moduleMatch.index);
            const lineNumber = beforeMatch.split('\n').length;
            
            modules.push({
                name: moduleName,
                line: lineNumber
            });
        }
        
        if (modules.length === 0) {
            return null;
        }
        
        // Get changed line ranges
        const changedRanges = getChangedLineRanges(filePath, baseRef, headRef);
        
        // Extract all tests with their line numbers
        const tests = [];
        const testRegex = /QUnit\.test\s*\(\s*["']([^"']+)["']\s*,\s*function/g;
        let testMatch;
        
        while ((testMatch = testRegex.exec(content)) !== null) {
            const testName = testMatch[1];
            const beforeMatch = content.substring(0, testMatch.index);
            const lineNumber = beforeMatch.split('\n').length;
            
            // Find which module this test belongs to
            // The test belongs to the last module that appears before it
            let moduleName = modules[0].name; // Default to first module
            for (let i = modules.length - 1; i >= 0; i--) {
                if (lineNumber > modules[i].line) {
                    moduleName = modules[i].name;
                    break;
                }
            }
            
            // Check if this test is affected by changes
            const isChanged = changedRanges.length === 0 || 
                            changedRanges.some(range => {
                                // For deletions (start > end), check if test is near the deletion point
                                if (range.start > range.end) {
                                    return Math.abs(lineNumber - range.start) <= 5;
                                }
                                // For additions/modifications, check if line is within or near the range
                                return (lineNumber >= range.start - 5 && lineNumber <= range.end + 5);
                            });
            
            tests.push({
                name: testName,
                line: lineNumber,
                module: moduleName,
                changed: isChanged
            });
        }
        
        // Group tests by module
        const moduleGroups = {};
        tests.forEach(test => {
            if (!moduleGroups[test.module]) {
                moduleGroups[test.module] = {
                    tests: [],
                    changedTests: []
                };
            }
            moduleGroups[test.module].tests.push(test.name);
            if (test.changed) {
                moduleGroups[test.module].changedTests.push(test.name);
            }
        });
        
        // Return array of modules with their tests
        return {
            modules: Object.keys(moduleGroups).map(moduleName => ({
                name: moduleName,
                tests: moduleGroups[moduleName].tests,
                changedTests: moduleGroups[moduleName].changedTests
            })),
            hasChanges: tests.some(t => t.changed)
        };
    } catch (error) {
        return null;
    }
}
/**
 * Main function
 */
function main() {
    const baseRef = process.env.GIT_BASE_REF || 'HEAD~1';
    const headRef = process.env.GIT_HEAD_REF || 'HEAD';
    const changedFiles = getChangedTestFiles(baseRef, headRef);
    const changedSourceFiles = getChangedSourceFiles(baseRef, headRef, changedFiles);
    if (changedFiles.length === 0 && changedSourceFiles.length === 0) {
        fs.writeFileSync('ui-modules-to-test.json', JSON.stringify({ changedSourceFiles: [] }, null, 2));
        process.exit(0);
    }
    const projectModules = {};
    changedFiles.forEach(file => {
        // Extract project name (first folder segment)
        const projectName = file.split('/')[0];
        const moduleInfo = extractModuleAndTests(file, baseRef, headRef);
        if (moduleInfo && moduleInfo.modules) {
            if (!projectModules[projectName]) {
                projectModules[projectName] = [];
            }
            // Add each module as a separate entry
            moduleInfo.modules.forEach(module => {
                projectModules[projectName].push({
                    file: file,
                    module: module.name,
                    changedTests: module.changedTests,
                    allTests: module.tests
                });
            });
        }
    });
    // Add changed source files to output
    projectModules.changedSourceFiles = changedSourceFiles;
    // Write output
    const outputJson = JSON.stringify(projectModules, null, 2);
    fs.writeFileSync('ui-modules-to-test.json', outputJson);
    
    // Summary
    const projectCount = Object.keys(projectModules).filter(k => k !== 'changedSourceFiles').length;
    const sourceCount = changedSourceFiles.length;
    console.log(`✓ Extracted ${projectCount} project(s) with ${sourceCount} changed source file(s)`);
}
main();
