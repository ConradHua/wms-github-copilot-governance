#!/usr/bin/env node

// Scans newly added dependencies for license compliance at session end.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_BLOCKED = 'GPL-2.0,GPL-2.0-only,GPL-2.0-or-later,GPL-3.0,GPL-3.0-only,GPL-3.0-or-later,AGPL-1.0,AGPL-3.0,AGPL-3.0-only,AGPL-3.0-or-later,LGPL-2.0,LGPL-2.1,LGPL-2.1-only,LGPL-2.1-or-later,LGPL-3.0,LGPL-3.0-only,LGPL-3.0-or-later,SSPL-1.0,EUPL-1.1,EUPL-1.2,OSL-3.0,CPAL-1.0,CPL-1.0,CC-BY-SA-4.0,CC-BY-NC-4.0,CC-BY-NC-SA-4.0';
const MODE = process.env.LICENSE_MODE || 'warn';
const LOG_DIR = process.env.LICENSE_LOG_DIR || 'logs/copilot/license-checker';
const blockedLicenses = (process.env.BLOCKED_LICENSES || DEFAULT_BLOCKED)
  .split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
const allowlist = (process.env.LICENSE_ALLOWLIST || '')
  .split(',').map((entry) => entry.trim()).filter(Boolean);
const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout || 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
    ...options,
  });
  return result && result.status === 0 ? result.stdout.trim() : '';
}

function isGitRepository() {
  return Boolean(run('git', ['rev-parse', '--is-inside-work-tree']));
}

function addedLines(file) {
  const diff = run('git', ['diff', 'HEAD', '--', file], { timeout: 10000 });
  return diff.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++'));
}

function addMatches(deps, ecosystem, file, pattern, excluded = []) {
  for (const line of addedLines(file)) {
    const match = line.match(pattern);
    if (match && match[1] && !excluded.includes(match[1])) deps.push({ ecosystem, package: match[1] });
  }
}

function detectDependencies() {
  const deps = [];
  addMatches(deps, 'npm', 'package.json', /^\+\s*"([^"]+)"\s*:\s*"[^"]*"/, [
    'name', 'version', 'description', 'main', 'scripts', 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies',
  ]);
  for (const line of addedLines('requirements.txt')) {
    const clean = line.slice(1).trim();
    if (!clean || clean.startsWith('#')) continue;
    const pkg = clean.split(/[><=!~\s[]/, 1)[0];
    if (pkg) deps.push({ ecosystem: 'pip', package: pkg });
  }
  addMatches(deps, 'pip', 'pyproject.toml', /^\+\s*"([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*[<>=!~;]/);
  addMatches(deps, 'go', 'go.mod', /^\+\s*([a-zA-Z0-9._/-]*\.[a-zA-Z0-9._/-]*)\s+v/);
  addMatches(deps, 'ruby', 'Gemfile', /^\+\s*gem\s*['"`]([^'"`]+)['"`]/);
  addMatches(deps, 'rust', 'Cargo.toml', /^\+\s*([a-zA-Z0-9_-]+)\s*=/, [
    'name', 'version', 'edition', 'authors', 'description', 'license', 'repository', 'rust-version',
  ]);
  return [...new Map(deps.map((dep) => [`${dep.ecosystem}:${dep.package}`, dep])).values()];
}

function readPackageLicense(pkg) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join('node_modules', pkg, 'package.json'), 'utf8'));
    return typeof data.license === 'string' ? data.license : 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

function detectGoLicense(pkg) {
  const roots = [process.env.GOPATH, path.join(process.env.HOME || '', 'go')].filter(Boolean);
  for (const root of roots) {
    const moduleRoot = path.join(root, 'pkg', 'mod');
    if (!fs.existsSync(moduleRoot)) continue;
    const escaped = pkg.replace(/[A-Z]/g, (char) => `!${char.toLowerCase()}`);
    let dirs;
    try {
      dirs = fs.readdirSync(moduleRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    const queue = dirs.filter((entry) => entry.isDirectory()).map((entry) => path.join(moduleRoot, entry.name));
    for (let depth = 0; queue.length && depth < 4; depth++) {
      const current = queue.splice(0);
      for (const dir of current) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const child = path.join(dir, entry.name);
          if (entry.name.toLowerCase().startsWith(`${escaped.toLowerCase()}@`)) {
            const licenseFile = entries.find((item) => item.isFile() && /^license/i.test(item.name));
            if (licenseFile) {
              let text = '';
              try { text = fs.readFileSync(path.join(child, licenseFile.name), 'utf8'); } catch { continue; }
              if (/GNU LESSER GENERAL PUBLIC/i.test(text)) return 'LGPL';
              if (/GNU AFFERO GENERAL PUBLIC/i.test(text)) return 'AGPL-3.0';
              if (/GNU GENERAL PUBLIC LICENSE/i.test(text)) return /Version 3/i.test(text) ? 'GPL-3.0' : /Version 2/i.test(text) ? 'GPL-2.0' : 'GPL';
              if (/MIT License/i.test(text)) return 'MIT';
              if (/Apache License/i.test(text)) return 'Apache-2.0';
              if (/BSD/i.test(text)) return 'BSD';
            }
          }
          queue.push(child);
        }
      }
    }
  }
  return 'UNKNOWN';
}

function getLicense({ ecosystem, package: pkg }) {
  let license = 'UNKNOWN';
  switch (ecosystem) {
    case 'npm':
      license = readPackageLicense(pkg);
      if (license === 'UNKNOWN') license = run('npm', ['view', pkg, 'license']);
      break;
    case 'pip': {
      const output = run('pip', ['show', pkg]) || run('pip3', ['show', pkg]);
      license = output.match(/^License:\s*(.*)$/im)?.[1]?.trim() || 'UNKNOWN';
      break;
    }
    case 'go':
      license = detectGoLicense(pkg);
      break;
    case 'ruby':
      license = run('gem', ['spec', pkg, 'license']).split(/\r?\n/).find((line) => line.trim() && !/^---|^\.\.\./.test(line))?.replace(/^-\s*/, '').trim() || 'UNKNOWN';
      break;
    case 'rust': {
      const metadata = run('cargo', ['metadata', '--format-version', '1']);
      try {
        license = JSON.parse(metadata).packages.find((item) => item.name === pkg)?.license || 'UNKNOWN';
      } catch { license = 'UNKNOWN'; }
      break;
    }
  }
  return license.trim() || 'UNKNOWN';
}

function isBlocked(license) {
  const value = license.toLowerCase();
  return blockedLicenses.some((blocked) => value.includes(blocked));
}

function appendLog(entry) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOG_DIR, 'check.log'), `${JSON.stringify(entry)}\n`);
}

function main() {
  if (process.env.SKIP_LICENSE_CHECK === 'true') {
    console.log('⏭️  License check skipped (SKIP_LICENSE_CHECK=true)');
    return;
  }
  if (!isGitRepository()) {
    console.log('⚠️  Not in a git repository, skipping license check');
    return;
  }

  const deps = detectDependencies();
  if (!deps.length) {
    console.log('✅ No new dependencies detected');
    appendLog({ timestamp, event: 'license_check_complete', mode: MODE, status: 'clean', dependencies_checked: 0 });
    return;
  }

  console.log(`🔍 Checking licenses for ${deps.length} new dependency(ies)...\n`);
  const results = deps.map((dep) => ({ ...dep, license: getLicense(dep) }));
  const findings = results.filter((dep) => !allowlist.includes(dep.package) && isBlocked(dep.license));
  const findingsSet = new Set(findings);

  console.log(`  ${'PACKAGE'.padEnd(30)} ${'ECOSYSTEM'.padEnd(12)} ${'LICENSE'.padEnd(30)} STATUS`);
  console.log(`  ${'-------'.padEnd(30)} ${'---------'.padEnd(12)} ${'-------'.padEnd(30)} ------`);
  for (const dep of results) {
    const status = allowlist.includes(dep.package) ? 'ALLOWLISTED' : findingsSet.has(dep) ? 'BLOCKED' : 'OK';
    console.log(`  ${dep.package.padEnd(30)} ${dep.ecosystem.padEnd(12)} ${dep.license.padEnd(30)} ${status}`);
  }

  appendLog({
    timestamp,
    event: 'license_check_complete',
    mode: MODE,
    dependencies_checked: results.length,
    violation_count: findings.length,
    violations: findings.map((dep) => ({ package: dep.package, ecosystem: dep.ecosystem, license: dep.license, status: 'BLOCKED' })),
  });

  if (findings.length) {
    console.log(`\n⚠️  Found ${findings.length} license violation(s):\n`);
    for (const dep of findings) console.log(`  - ${dep.package} (${dep.ecosystem}): ${dep.license}`);
    console.log('');
    if (MODE === 'block') {
      console.log('🚫 Session blocked: resolve license violations above before committing.');
      console.log('   Set LICENSE_MODE=warn to log without blocking, or add packages to LICENSE_ALLOWLIST.');
      process.exitCode = 1;
    } else {
      console.log('💡 Review the violations above. Set LICENSE_MODE=block to prevent commits with license issues.');
    }
  } else {
    console.log(`\n✅ All ${results.length} dependencies have compliant licenses`);
  }
}

try {
  main();
} catch (error) {
  console.error(`License check failed: ${error.message}`);
  if (MODE === 'block') process.exitCode = 1;
}