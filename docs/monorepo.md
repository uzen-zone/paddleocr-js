# Monorepo conventions

English | [简体中文](monorepo_cn.md)

## Command execution

When you only want one workspace, use root-level workspace commands with explicit paths:

```bash
npm run build --workspace packages/core
npm run dev --workspace demo
```

(You can also use workspace package names where unambiguous, e.g. `npm run dev --workspace demo`.)

## Workspace roles

- `packages/*`: reusable packages; the SDK lives under `packages/core` but keeps the **npm package name** `@uzen/paddleocr-js`
- `demo`: a private application (the demo); not published to npm as a product

## Versioning and release

- **Directory:** `packages/core` — SDK source and publish manifest for the public package
- **npm package name:** `@uzen/paddleocr-js` — what consumers `npm install` and import in code
- **Directory:** `demo` — private demo, not an npm release target
- Changesets manages versioning; the demo package is ignored in `.changeset/config.json`
- `npm run release` builds the SDK and publishes via `changeset publish`
- `packages/core` has a `prepublishOnly` script that auto-builds before `npm publish` / `npm pack`

## Linting and tests

- `packages/**/src/**/*.ts` is linted with `strictTypeChecked` TypeScript rules and browser-oriented globals
- `packages/**/test/**/*.ts` is linted with the lighter `recommendedTypeChecked` preset (browser + Node globals, with relaxed rules such as `no-unsafe-*` and `no-explicit-any` disabled)
- `demo/**/src/**/*.ts` also uses `strictTypeChecked` TypeScript rules with browser-oriented globals
- `demo/**/*.js`, root config files (`*.config.{js,ts}`), and package config files (`packages/**/*.config.*`) are linted with basic ESLint rules and both Node and browser globals
