# OpenCLI — GeonMoo Fork

[中文文档](./README.zh-CN.md) · [Upstream: jackwener/OpenCLI](https://github.com/jackwener/OpenCLI)

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install_extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk)

This repository is our fork of [jackwener/OpenCLI](https://github.com/jackwener/OpenCLI). We maintain our own adapters and customize output formats for our workflows. Keeping these changes here lets us iterate without waiting for every change to go through the upstream contribution process, while continuing to merge upstream improvements.

**Install this fork with `npm install -g @geonmoo/opencli`.** The npm package for this repository is **`@geonmoo/opencli`**; it provides the `opencli` command.

## Quick Start

### 1. Install this fork

Requires **Node.js >= 20.18.1**.

```bash
node --version
npm install -g @geonmoo/opencli
```

### 2. Install the Browser Bridge Extension

OpenCLI connects to Chrome/Chromium through a lightweight Browser Bridge extension plus a small local daemon. The daemon auto-starts when needed.

**Option A — Chrome Web Store (recommended):**
Install **OpenCLI** from the [Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk).

**Option B — Manual install:**
1. Download the latest `opencli-extension-v{version}.zip` from the GitHub [Releases page](https://github.com/jackwener/opencli/releases).
2. Unzip it, open `chrome://extensions`, and enable **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

### 3. Verify the setup

```bash
opencli doctor
```

### 4. Optional: name your Chrome profile

Each Chrome profile runs its own OpenCLI extension instance. If you use multiple Chrome profiles, list the connected profiles and assign local aliases:

```bash
opencli profile list
opencli profile rename <contextId> work
opencli profile use work
opencli --profile work browser state --session main
```

With only one connected profile, OpenCLI uses it automatically. With multiple connected profiles and no default, OpenCLI asks you to choose instead of guessing.

### 5. Run your first commands

```bash
opencli list
opencli hackernews top --limit 5
opencli bilibili hot --limit 5
```

## Commands Added in This Fork

Compared with the local `upstream/main` snapshot at [`e6174a95`](https://github.com/jackwener/OpenCLI/commit/e6174a95), this fork's command manifest includes the following additional commands:

| Site | Added commands | Purpose |
|------|----------------|---------|
| **github** | `search` `stars` `trend` | Repository, code and other GitHub searches, trending and starred repositories |
| **hgface** | `papers` `search` | Hugging Face model, dataset and Space search; daily papers |
| **jinshi** | `news` | Jinshi financial news |
| **jisilu** | `adjust` `delisted` `list` `login` `pre` `put` `redeem` `whoami` | Convertible bond lists, terms and account status |
| **jobs** | `companies` `search` | Search official recruitment sites of 18 employers |
| **jumpserver** | `connect` `download` `exec` `upload` `view` | Remote terminal commands and file transfers through JumpServer |
| **jupyter** | `console` `download` `pyconsole` `upload` | JupyterLab terminal, Python console and file transfers |
| **ke** | `search` | Beike second-hand property search and details |
| **liepin** | `chatlist` `chatmsg` `detail` `login` `search` `stats` `whoami` | Liepin jobs, candidate chats and account statistics |
| **tianyancha** | `detail` `login` `search` `whoami` | Company search, details and account status |
| **tradingview** | `calendar` `ideas` `news` `scripts` | Calendars, news, trading ideas, indicators and strategies |

Run `opencli list` to browse available commands, or `opencli <site> <command> --help` for arguments. For upstream features and documentation, see [jackwener/OpenCLI](https://github.com/jackwener/OpenCLI).

When upgrading, uninstall any old *opencli-sitemap-author* and *opencli-browser-sitemap* skills through your agent. Current OpenCLI releases no longer ship these skills.

## Syncing with Upstream

This fork uses `origin` for `GeonMoo/OpenCLI` and `upstream` for `jackwener/OpenCLI`. If `upstream` is missing, add it once:

```bash
git remote add upstream https://github.com/jackwener/OpenCLI.git
```

With a clean working tree, merge the latest upstream changes into `main`, then push to your fork:

```bash
git switch main
git fetch upstream
git merge upstream/main
git push origin main
```

If you have uncommitted changes, stash them before switching branches with `git stash push -u -m "before upstream sync"`. After merging, return to the branch where you stashed them and run `git stash pop`. The `-u` option also saves untracked files.

If the merge reports conflicts, resolve the affected files, run `git add <resolved-file>` for each one, then `git commit` to finish the merge before pushing. If `git stash pop` reports conflicts, resolve those separately; Git keeps the stash until you explicitly drop it.
