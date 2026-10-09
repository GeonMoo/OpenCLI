const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// npm 10 can still invoke prepare during pack --ignore-scripts.
if (process.env.npm_config_ignore_scripts === 'true' || !fs.existsSync(path.join(process.cwd(), 'src'))) {
  process.exit(0);
}

const npmExecPath = process.env.npm_execpath;
// npm, pnpm, and Yarn expose a JavaScript CLI entry here, which Node can run
// directly. Bun exposes its native executable instead; passing that binary to
// Node would make `bun install` fail during prepare, so use npm for non-JS
// runners (the build scripts themselves already invoke npm).
const hasJsExecPath = npmExecPath && /\.(?:c|m)?js$/i.test(npmExecPath);
const command = hasJsExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
function runNpm(args) {
  const result = spawnSync(command, hasJsExecPath ? [npmExecPath, ...args] : args, {
    stdio: 'inherit',
    shell: !hasJsExecPath && process.platform === 'win32',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Global installs of a local folder link the source without installing its dependencies.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
if (Object.keys(dependencies).some(name => !fs.existsSync(path.join('node_modules', name, 'package.json')))) {
  runNpm(['ci', '--ignore-scripts', '--include=dev', '--global=false', '--prefix', process.cwd()]);
}

runNpm(['run', 'build']);
