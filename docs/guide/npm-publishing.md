# Publish the GeonMoo fork to npm

This fork publishes as `@geonmoo/opencli` from `GeonMoo/OpenCLI`; the command remains `opencli`. The original project is [jackwener/OpenCLI](https://github.com/jackwener/OpenCLI).

## Validate before publishing

Use Node.js 22 and run:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:package
```

After the build, `test:package` packs the actual npm tarball, verifies its entry points and exclusions, and installs it into temporary global prefixes with and without lifecycle scripts. It checks the installed command shim, version, help, list, completion, and imports every packaged adapter. The check isolates the user home and runs in the existing Linux/macOS/Windows CI build matrix and before release.

## Install a clean source checkout

```sh
git clone https://github.com/GeonMoo/OpenCLI.git
cd OpenCLI
npm install -g .
opencli --version
opencli list
```

`prepare` installs missing source/build dependencies from the lockfile before building. No existing `dist/` or `node_modules/` is required. A source installation links this directory into npm's global prefix; keep the checkout. To replace an upstream `@jackwener/opencli` installation with this differently named fork, run `npm uninstall -g @jackwener/opencli` before `npm install -g .`. npm rejects the shared `opencli` command before lifecycle scripts with `EEXIST` otherwise. Same-name updates use `npm install -g .` normally.

`npm install -g . --force` overwrites the shared command immediately, but keeps the old package installed. A later update or uninstall of that old package can affect the shared command. Removing the old package is the lasting migration; use separate prefixes if retaining both packages intentionally.

## Publish through GitHub Actions

Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for `@geonmoo/opencli` with owner `GeonMoo`, repository `OpenCLI`, and workflow `release.yml`. The workflow publishes with provenance when you push a release tag matching `package.json`. Increment the package version for each release. See the [release procedure](../../.github/RELEASING.md) for the verification and recovery steps.

## Verify the published package

From a clean machine or isolated global prefix:

```sh
npm view @geonmoo/opencli name version dist-tags bin engines --json --registry=https://registry.npmjs.org
npm install -g @geonmoo/opencli --registry=https://registry.npmjs.org
opencli --version
opencli list
opencli liepin search --help
```

Wait for a mirror to synchronize before using it to verify a new release. This fork and the upstream package both provide `opencli`; use separate prefixes when comparing them. Browser commands additionally require the Browser Bridge extension and login; npm installation alone does not establish browser connectivity.
