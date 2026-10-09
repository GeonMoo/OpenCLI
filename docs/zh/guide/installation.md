# 安装

## 系统要求

- **Node.js**: >= 20.18.1，或 **Bun** >= 1.0
- **Chrome** 已运行并登录目标网站（浏览器命令需要）

## 通过 npm 安装（推荐）

```bash
npm install -g @geonmoo/opencli
```

## 从源码安装

```bash
git clone https://github.com/GeonMoo/OpenCLI.git
cd OpenCLI
npm install -g .
opencli list
```

源码安装会自动准备依赖并构建。npm 会将克隆目录链接到全局安装位置，请保留这个目录。从 `@jackwener/opencli` 迁移到本 fork 时，先执行 `npm uninstall -g @jackwener/opencli`，再执行 `npm install -g .`；同包名更新直接使用 `npm install -g .`。`--force` 可以立即覆盖命令，但旧包仍然存在，长期使用应卸载旧包以消除冲突。

## 更新

```bash
npm install -g @geonmoo/opencli@latest

# 如果你在用打包发布的 OpenCLI skills，也一起刷新
npx skills add jackwener/opencli
```

如果你只装了部分 skill，也可以只刷新自己在用的：

```bash
npx skills add jackwener/opencli --skill opencli-adapter-author
npx skills add jackwener/opencli --skill opencli-autofix
npx skills add jackwener/opencli --skill opencli-browser
npx skills add jackwener/opencli --skill opencli-usage
npx skills add jackwener/opencli --skill smart-search
```

## 验证安装

```bash
opencli --version
opencli list
opencli doctor
```
