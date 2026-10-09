import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const temp = mkdtempSync(join(tmpdir(), 'opencli-package-test-'));
const home = join(temp, 'home');
mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home, CI: '', CONTINUOUS_INTEGRATION: '', SHELL: '' };
assert.ok(process.env.npm_execpath, 'Run this check with npm run test:package');

function runNpm(...args) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    throw new Error(`npm ${args[0]} failed (${result.status})`);
  }
  assert.doesNotMatch(result.stdout + result.stderr, /Optional (?:postinstall setup|adapter sync) skipped/);
  return result.stdout;
}

try {
  assert.equal(pkg.name, '@geonmoo/opencli');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org');
  const [packed] = JSON.parse(runNpm('pack', '--ignore-scripts', '--json', '--pack-destination', temp));
  const files = new Set(packed.files.map(file => file.path));
  for (const file of [pkg.bin.opencli, 'cli-manifest.json', 'scripts/postinstall.js', 'scripts/fetch-adapters.js', ...Object.values(pkg.exports)]) {
    assert.ok(files.has(file.replace(/^\.\//, '')), `Missing package file: ${file}`);
  }
  assert.ok(![...files].some(file => /(?:\.test\.|__fixtures__\/)/.test(file)), 'Test files leaked into the package');
  const tarball = join(temp, packed.filename);

  for (const ignoreScripts of [false, true]) {
    const prefix = join(temp, ignoreScripts ? 'no scripts' : 'normal install');
    runNpm('install', '--global', tarball, '--prefix', prefix,
      '--registry=https://registry.npmjs.org', '--no-audit', '--no-fund', '--foreground-scripts',
      ...(ignoreScripts ? ['--ignore-scripts'] : []));
    const installRoot = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
    const installed = join(installRoot, '@geonmoo', 'opencli');
    const bin = process.platform === 'win32' ? join(prefix, 'opencli.cmd') : join(prefix, 'bin', 'opencli');
    function runCli(...args) {
      // cmd.exe is needed for npm's Windows .cmd shim; quote paths with spaces.
      return process.platform === 'win32'
        ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${bin}" ${args.join(' ')}"`], { cwd: temp, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024, windowsVerbatimArguments: true })
        : execFileSync(bin, args, { cwd: temp, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
    }
    assert.equal(runCli('--version').trim(), pkg.version);
    assert.match(runCli('--help'), /Usage:/);
    assert.match(runCli('list', '-f', 'json'), /hackernews/);
    assert.match(runCli('liepin', 'search', '--help'), /Usage:/);
    assert.match(runCli('--get-completions', '--cursor', '0'), /hackernews/);

    const compatProbe = join(home, '.opencli', 'verify-compat.mjs');
    writeFileSync(compatProbe, `import { getRegistry as current } from '@geonmoo/opencli/registry';
import { getRegistry as upstream } from '@jackwener/opencli/registry';
if (current() !== upstream()) throw new Error('Package aliases must share the registry');
`);
    execFileSync(process.execPath, [compatProbe], { cwd: temp, env, encoding: 'utf8', timeout: 30_000 });

    // Import every shipped adapter: help/list use the manifest and can hide broken imports.
    const manifest = JSON.parse(readFileSync(join(installed, 'cli-manifest.json'), 'utf8'));
    const probe = join(installed, 'verify-adapters.mjs');
    writeFileSync(probe, `import { getRegistry } from '@geonmoo/opencli/registry';
for (const modulePath of ${JSON.stringify([...new Set(manifest.map(entry => entry.modulePath))])}) {
  await import('./clis/' + modulePath);
}
if (!getRegistry().has('liepin/search')) throw new Error('liepin/search failed to register');
console.log('All packaged adapters loaded');
`);
    execFileSync(process.execPath, [probe], { cwd: temp, env, encoding: 'utf8', timeout: 60_000 });
    console.log(`Verified ${packed.filename}: global install${ignoreScripts ? ' --ignore-scripts' : ''}, CLI shim, exports, adapters, help, list, completion`);
  }
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
