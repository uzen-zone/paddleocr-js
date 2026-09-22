# Monorepo 约定

[English](monorepo.md) | 简体中文

## 命令与 workspace

当您只想操作一个 workspace 时，请在仓库根目录使用带显式路径的 workspace 命令：

```bash
npm run build --workspace packages/core
npm run dev --workspace demo
```

（在包名没有歧义时，也可以直接使用 workspace 的包名，例如 `npm run dev --workspace demo`。）

## Workspace 角色

- `packages/*`：可复用包；SDK 位于 `packages/core`，但其 **npm 包名** 仍为 `@uzen/paddleocr-js`
- `demo`：私有应用（即 demo），不作为 npm 产品发布

仓库刻意将私有 demo 放在根目录，而不是单独的 `apps/` 目录。`demo` 是唯一且永远不会再增加的非发布应用，添加 `apps/` 这一层只会徒增嵌套。因此 `packages/*` 永远只表示「可发布的库包」，`demo` 是唯一的消费方应用。

## 版本与发布

- **目录：** `packages/core` — 对外 npm 包的源码与发布清单
- **npm 包名：** `@uzen/paddleocr-js` — 用户 `npm install` 后在代码中实际导入的名称
- **目录：** `demo` — 私有 demo，不是 npm 发布目标
- 版本由 Changesets 管理；demo 包在 `.changeset/config.json` 中被忽略
- `npm run release` 会构建 SDK 并通过 `changeset publish` 发布
- `packages/core` 的 `prepublishOnly` 会在 `npm publish` / `npm pack` 前自动执行构建

## Lint 与测试

- `packages/**/src/**/*.ts` 使用 `strictTypeChecked` TypeScript 规则，并启用面向浏览器的全局变量
- `packages/**/test/**/*.ts` 使用较轻的 `recommendedTypeChecked` 规则集（浏览器 + Node 全局），并放宽部分规则，例如 `no-unsafe-*` 和 `no-explicit-any`
- `demo/**/src/**/*.ts` 同样使用 `strictTypeChecked` TypeScript 规则与浏览器全局变量
- `demo/**/*.js`、仓库根目录配置文件（`*.config.{js,ts}`）以及包内配置文件（`packages/**/*.config.*`）使用基础 ESLint 规则，同时启用 Node 与浏览器全局
