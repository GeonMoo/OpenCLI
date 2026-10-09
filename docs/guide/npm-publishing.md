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

## First publication

The npm account must own the `@geonmoo` scope. Authenticate locally (never commit credentials) and publish:

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish --access public --registry=https://registry.npmjs.org
```

Use the npm account's required 2FA flow. The package's `publishConfig` explicitly selects the official npm registry even when the development registry is a mirror. `prepublishOnly` rebuilds the package before publishing. A successful tarball check does not prove registry authentication or scope ownership.

## Subsequent GitHub releases

The existing `release.yml` runs on `v*` tags, verifies that the tag matches `package.json`, and publishes with provenance. Configure the repository's `NPM_TOKEN` secret with publishing permission for this package and the appropriate npm 2FA policy before pushing a release tag. Increment the version for each new publication; npm will not overwrite an existing version.

As an alternative, [configure npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for owner `GeonMoo`, repository `OpenCLI`, workflow `release.yml`. Then use a supported npm version and remove the workflow's `NODE_AUTH_TOKEN` environment block. The workflow already grants `id-token: write`. Trusted publishing configuration is separate from committing these files.

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
