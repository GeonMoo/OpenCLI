# Installation

## Requirements

- **Node.js**: >= 20.18.1, or **Bun** >= 1.0
- **Chrome** running and logged into the target site (for browser commands)

## Install via npm (Recommended)

```bash
npm install -g @geonmoo/opencli
```

## Install the Browser Bridge Extension

For browser commands, install **OpenCLI** from the [Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) (recommended). See [Browser Bridge setup](./browser-bridge) for manual installation and verification.

## Install from Source

```bash
git clone https://github.com/GeonMoo/OpenCLI.git
cd OpenCLI
npm install -g .
opencli list  # Now you can use it anywhere!
```

The source install prepares dependencies and builds automatically. npm links the checkout into the global installation, so keep the checkout directory. When replacing `@jackwener/opencli` with this fork, run `npm uninstall -g @jackwener/opencli` first, then `npm install -g .`. Reinstalling the same package name uses `npm install -g .` normally. `--force` can overwrite the command immediately but leaves the old package installed, so uninstall the old package for a lasting migration.

## Update

```bash
npm install -g @geonmoo/opencli@latest

# If you use the packaged OpenCLI skills, refresh them too
npx skills add jackwener/opencli
```

Or refresh only the skills you actually use:

```bash
npx skills add jackwener/opencli --skill opencli-adapter-author
npx skills add jackwener/opencli --skill opencli-autofix
npx skills add jackwener/opencli --skill opencli-browser
npx skills add jackwener/opencli --skill opencli-usage
npx skills add jackwener/opencli --skill smart-search
```

OpenCLI no longer ships the sitemap skills. Older `opencli-sitemap-author` and
`opencli-browser-sitemap` copies may remain in an agent's separate skills directory after an
upgrade. If they remain, use the agent's removal flow if available; otherwise remove only those two
directories (for example, `~/.agents/skills/opencli-sitemap-author`). The location varies by agent;
keep the rest of the skills directory.

## Verify Installation

```bash
opencli --version   # Check version
opencli list        # List all commands
opencli doctor      # Diagnose connectivity
```
