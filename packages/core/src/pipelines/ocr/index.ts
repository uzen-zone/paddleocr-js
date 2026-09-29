/*
 * Copyright (c) 2026 PaddlePaddle Authors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeOcrPipelineConfig, parseOcrPipelineConfigText } from "./config";
import { ensureServedFromHttp, sourceToMat } from "../../platform/browser";
import type { OcrPipelineRunnerOptions } from "./core";
import { OcrPipelineRunner } from "./core";
import { resolvePaddleOCROptions, resolveWorkerOptions } from "./shared";
import { createWorkerBackedPaddleOCR } from "./worker-backed";
import type { WorkerBackedPaddleOCR } from "./worker-backed";
import type { OrtOptions } from "../../runtime/ort";
import type { ModelAsset } from "../../resources/model-asset";
import type { LimitType } from "./runtime-params";

export interface PaddleOCRCreateOptions {
  worker?: boolean | { createWorker?: () => Worker };
  fetch?: typeof fetch;

  /**
   * Whether `create()` awaits `initialize()` before resolving.
   *
   * Defaults to eager initialization. That means the first `await
   * PaddleOCR.create(...)` downloads and opens the ONNX models, which for the
   * default language is roughly 21 MB and takes tens of seconds on a cold
   * cache. Expect a long-running `create()` on first load, not a hang.
   *
   * Pass `initialize: false` to get an instance back immediately and start the
   * work yourself -- useful for deferring model loading until the user has
   * supplied an image, or for driving a loading indicator:
   *
   * ```ts
   * const ocr = await PaddleOCR.create({ initialize: false });
   * const ready = ocr.initialize();          // kicks off the download
   * await whenTheUserPicksAnImage();
   * await ready;
   * ```
   *
   * Either way `initialize()` is idempotent and safe to await more than once,
   * so no initialization state needs tracking on the caller side.
   */
  initialize?: boolean;

  ortOptions?: OrtOptions;

  pipelineConfig?: unknown;
  unsupportedBehavior?: "warn" | "ignore" | "error";

  lang?: string;
  ocrVersion?: string;
  ocr_version?: string;

  textDetectionModelName?: string;
  text_detection_model_name?: string;
  textRecognitionModelName?: string;
  text_recognition_model_name?: string;
  docOrientationModelName?: string;
  doc_orientation_model_name?: string;
  docUnwarpingModelName?: string;
  doc_unwarping_model_name?: string;
  textLineOrientationModelName?: string;
  textline_orientation_model_name?: string;

  textDetectionModelAsset?: ModelAsset;
  text_detection_model_asset?: ModelAsset;
  textDetectionModelDir?: ModelAsset;
  text_detection_model_dir?: ModelAsset;
  textRecognitionModelAsset?: ModelAsset;
  text_recognition_model_asset?: ModelAsset;
  textRecognitionModelDir?: ModelAsset;
  text_recognition_model_dir?: ModelAsset;
  docOrientationModelAsset?: ModelAsset;
  doc_orientation_model_asset?: ModelAsset;
  docOrientationModelDir?: ModelAsset;
  doc_orientation_model_dir?: ModelAsset;
  docUnwarpingModelAsset?: ModelAsset;
  doc_unwarping_model_asset?: ModelAsset;
  docUnwarpingModelDir?: ModelAsset;
  doc_unwarping_model_dir?: ModelAsset;
  textLineOrientationModelAsset?: ModelAsset;
  textline_orientation_model_asset?: ModelAsset;
  textLineOrientationModelDir?: ModelAsset;
  textline_orientation_model_dir?: ModelAsset;

  textDetectionBatchSize?: number;
  text_detection_batch_size?: number;
  textRecognitionBatchSize?: number;
  text_recognition_batch_size?: number;
  textLineOrientationBatchSize?: number;
  textline_orientation_batch_size?: number;
  batch_size?: number;

  textDetLimitSideLen?: number;
  text_det_limit_side_len?: number;
  textDetLimitType?: LimitType;
  text_det_limit_type?: LimitType;
  textDetMaxSideLimit?: number;
  text_det_max_side_limit?: number;
  textDetThresh?: number;
  text_det_thresh?: number;
  textDetBoxThresh?: number;
  text_det_box_thresh?: number;
  textDetUnclipRatio?: number;
  text_det_unclip_ratio?: number;
  textRecScoreThresh?: number;
  text_rec_score_thresh?: number;

  [key: string]: unknown;
}

export class PaddleOCR extends OcrPipelineRunner {
  constructor(options: OcrPipelineRunnerOptions) {
    super({
      ...options,
      ensureServedFromHttp,
      sourceToMat
    });
  }

  static async create(
    options: PaddleOCRCreateOptions = {}
  ): Promise<PaddleOCR | WorkerBackedPaddleOCR> {
    const workerOptions = resolveWorkerOptions(options.worker);
    if (workerOptions.enabled && options.fetch) {
      throw new Error("worker mode does not support a custom fetch implementation.");
    }

    const resolvedOptions = resolvePaddleOCROptions(options);
    const instance = workerOptions.enabled
      ? createWorkerBackedPaddleOCR(resolvedOptions, {
          createWorker: workerOptions.createWorker ?? undefined
        })
      : new PaddleOCR({
          ...resolvedOptions,
          fetch: options.fetch
        });

    if (options.initialize !== false) {
      await instance.initialize();
    }
    return instance;
  }
}

export { normalizeOcrPipelineConfig, parseOcrPipelineConfigText };
