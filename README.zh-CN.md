# OpenCLI — GeonMoo Fork

[English](./README.md) · [上游仓库：jackwener/OpenCLI](https://github.com/jackwener/OpenCLI)

这是基于 [jackwener/OpenCLI](https://github.com/jackwener/OpenCLI) 的 fork。我们有自己的 adapter，也需要按自己的工作流定制输出格式。每次调整都提交上游、等待合并不够方便，因此先独立维护这个仓库，方便快速迭代，同时持续同步上游改进。

**安装本仓库版本，请使用 `npm install -g @geonmoo/opencli`。** 本仓库发布的 npm 包是 **`@geonmoo/opencli`**，安装后使用 `opencli` 命令。

## 快速开始

### 1. 安装本仓库版本

需要 **Node.js >= 20.18.1**。

```bash
node --version
npm install -g @geonmoo/opencli
```

### 2. 安装 Browser Bridge 扩展

OpenCLI 通过轻量 Browser Bridge 扩展和本地微型 daemon 与 Chrome/Chromium 通信。daemon 会按需自动启动。

**方式 A — Chrome Web Store（推荐）：**
在 [Chrome Web Store](https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk) 安装 **OpenCLI** 扩展。

**方式 B — 手动安装：**
1. 到 GitHub [Releases 页面](https://github.com/jackwener/opencli/releases) 下载最新的 `opencli-extension-v{version}.zip`。
2. 解压后打开 `chrome://extensions`，启用 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择解压后的目录。

### 3. 验证环境

```bash
opencli doctor
```

### 4. 可选：为 Chrome 配置别名

每个 Chrome profile 都有独立的 OpenCLI 扩展实例。使用多个 profile 时，可以查看连接情况并设置本地别名：

```bash
opencli profile list
opencli profile rename <contextId> work
opencli profile use work
opencli --profile work browser state --session main
```

只有一个 profile 连接时会自动使用；多个 profile 连接且未设置默认值时，会提示你选择。

### 5. 跑第一个命令

```bash
opencli list
opencli hackernews top --limit 5
opencli bilibili hot --limit 5
```

## 本 Fork 新增的命令

对比本地 `upstream/main` 的 [`e6174a95`](https://github.com/jackwener/OpenCLI/commit/e6174a95) 快照，本仓库的命令清单包含以下额外命令：

| 站点 | 新增命令 | 用途 |
|------|----------|------|
| **github** | `search` `stars` `trend` | GitHub 仓库、代码等内容搜索，趋势仓库与用户收藏 |
| **hgface** | `papers` `search` | Hugging Face 模型、数据集、Space 搜索及每日论文 |
| **jinshi** | `news` | 金十财经快讯 |
| **jisilu** | `adjust` `delisted` `list` `login` `pre` `put` `redeem` `whoami` | 集思录可转债列表、条款及账号状态 |
| **jobs** | `companies` `search` | 18 家公司的官方招聘站搜索 |
| **jumpserver** | `connect` `download` `exec` `upload` `view` | 通过 JumpServer 连接远程终端、执行命令及传输文件 |
| **jupyter** | `console` `download` `pyconsole` `upload` | JupyterLab 终端、Python Console 及文件传输 |
| **ke** | `search` | 贝壳二手房搜索及详情 |
| **liepin** | `chatlist` `chatmsg` `detail` `login` `search` `stats` `whoami` | 猎聘职位、求职聊天及账号统计 |
| **tianyancha** | `detail` `login` `search` `whoami` | 天眼查企业搜索、详情及账号状态 |
| **tradingview** | `calendar` `ideas` `news` `scripts` | TradingView 日历、新闻、交易观点、指标及策略 |

运行 `opencli list` 查看可用命令，使用 `opencli <site> <command> --help` 查看参数。上游功能和完整文档见 [jackwener/OpenCLI](https://github.com/jackwener/OpenCLI)。

## 同步上游

本仓库使用 `origin` 指向 `GeonMoo/OpenCLI`，使用 `upstream` 指向 `jackwener/OpenCLI`。如果尚未配置 `upstream`，先执行一次：

```bash
git remote add upstream https://github.com/jackwener/OpenCLI.git
```

确保工作区干净后，将上游最新变更合并到 `main`，再推送到自己的 fork：

```bash
git switch main
git fetch upstream
git merge upstream/main
git push origin main
```

如果有未提交的修改，切换分支前先运行 `git stash push -u -m "before upstream sync"`。合并后回到保存修改时所在的分支，执行 `git stash pop` 恢复。`-u` 会同时保存未跟踪的文件。

如果合并出现冲突，解决相关文件后，逐个执行 `git add <resolved-file>`，再执行 `git commit` 完成合并，之后再推送。如果 `git stash pop` 出现冲突，需要单独解决；Git 会保留 stash，直到你显式删除它。
