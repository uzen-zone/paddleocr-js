/*
 * Copyright (c) 2026 PaddlePaddle Authors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

declare const __INLINED_ORT_VERSION__: string | undefined;

/**
 * The `onnxruntime-web` version whose JS glue is baked into this SDK's package
 * worker, or `null` when the build did not define one (unit tests, or any
 * consumer build that consumed the sources directly).
 *
 * ORT's glue and its `.wasm`/`.mjs` binaries must come from the same version, so
 * this number is what a consumer needs in order to pin their own copy of
 * `onnxruntime-web` and lay down matching binaries under `ortOptions.wasmPaths`.
 * A mismatch surfaces late and opaquely — as a WASM instantiation failure with
 * no mention of versions — so it is worth comparing at startup:
 *
 * ```ts
 * import { INLINED_ORT_VERSION } from "@uzen/paddleocr-js";
 *
 * if (INLINED_ORT_VERSION && INLINED_ORT_VERSION !== myInstalledOrtVersion) {
 *   console.warn(`onnxruntime-web ${myInstalledOrtVersion} != ${INLINED_ORT_VERSION}`);
 * }
 * ```
 *
 * The two execution modes pick up ORT differently, which is why this matters
 * most for `worker: true`:
 *
 * - main thread: `import("onnxruntime-web")` stays external, so the consumer's
 *   own installed version is used, and their bundler emits the binaries
 * - worker: the glue is inlined at this version, and the binaries come from
 *   `ortOptions.wasmPaths` if set, otherwise from a CDN pinned to this version
 *
 * In other words the main thread is governed by the consumer's dependency and
 * the worker by this constant. Setting `ortOptions.wasmPaths` does not change
 * either version — it only changes where the binaries are fetched from, so
 * pointing it at binaries from a different ORT version is exactly the
 * mismatch this value lets you rule out.
 */
export const INLINED_ORT_VERSION: string | null =
  typeof __INLINED_ORT_VERSION__ === "string" ? __INLINED_ORT_VERSION__ : null;
