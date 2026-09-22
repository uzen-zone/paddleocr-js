/*
 * Copyright (c) 2026 PaddlePaddle Authors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OpenCv, Mat } from "@techstark/opencv-js";
import type { ModelAsset, ModelLoadSummary } from "../../resources/model-asset";
import { loadModelAsset } from "../../resources/index";
import {
  createDetModel,
  createDocOrientationModel,
  createDocUnwarpingModel,
  createRecModel,
  createTextLineOrientationModel,
  validateDocUnwarpingModelName
} from "../../models/index";
import type { DetModel } from "../../models/det";
import type { DocOrientationModel, DocOrientationResult } from "../../models/doc-orientation";
import type { DocUnwarpingModel, DocUnwarpingResult } from "../../models/doc-unwarping";
import type { RecModel } from "../../models/rec";
import type {
  TextLineOrientationModel,
  TextLineOrientationResult
} from "../../models/textline-orientation";
import type { Point2D } from "../../models/common";
import { cropByPoly } from "./crop";
import { initOpenCvRuntime } from "../../runtime/opencv";
import { initOrtRuntime } from "../../runtime/ort";
import type { OrtModule, WebGpuState, OrtOptions } from "../../runtime/ort";
import { chunkArray, nowMs } from "../../utils/common";
import type { OcrModelConfig, OcrRuntimeParamsInput } from "./runtime-params";
import { getOcrRuntimeParams } from "./runtime-params";
import type { NormalizedPipelineConfig } from "./config";
import { cloneDefaultOcrConfig, validateLoadedModelName } from "./shared";
import type { NormalizedOrtOptions } from "./shared";
import type { SourceMatResult } from "../../platform/browser";

export interface OcrResultItem {
  poly: Point2D[];
  text: string;
  score: number;
  textLineOrientation?: TextLineOrientationResult;
}

export interface OcrResultMetrics {
  detMs: number;
  recMs: number;
  totalMs: number;
  detectedBoxes: number;
  recognizedCount: number;
}

export interface OcrResultRuntime {
  requestedBackend: string;
  detProvider: string;
  recProvider: string;
  webgpuAvailable: boolean;
}

export interface OcrResult {
  image: { width: number; height: number };
  items: OcrResultItem[];
  preprocessing?: {
    docOrientation?: DocOrientationResult;
    docUnwarping?: DocUnwarpingResult;
  };
  metrics: OcrResultMetrics;
  runtime: OcrResultRuntime;
}

export interface InitializationSummary {
  backend: string;
  webgpuAvailable: boolean;
  detProvider: string;
  recProvider: string;
  assets: ModelLoadSummary[];
  elapsedMs: number;
  pipelineConfigWarnings: string[];
}

export type SourceToMatFn = (
  cv: OpenCv,
  source: unknown
) => SourceMatResult | Promise<SourceMatResult>;
type EnsureServedFromHttpFn = () => void;

export interface OcrPipelineRunnerOptions {
  pipelineConfig: NormalizedPipelineConfig;
  ortOptions?: OrtOptions | NormalizedOrtOptions;
  fetch?: typeof fetch;
  ensureServedFromHttp?: EnsureServedFromHttpFn;
  sourceToMat?: SourceToMatFn;
}

function noopEnsureServedFromHttp(): void {}

function getResolvedAssets(assets: Partial<Record<string, ModelAsset>> | undefined): {
  det: ModelAsset;
  rec: ModelAsset;
  docOri?: ModelAsset;
  docUnwarp?: ModelAsset;
  textLineOri?: ModelAsset;
} {
  const det = assets?.det;
  const rec = assets?.rec;
  if (!det || typeof det !== "object" || !rec || typeof rec !== "object") {
    throw new Error(
      "PaddleOCRCore requires pre-resolved detection and recognition asset descriptors."
    );
  }
  return {
    det,
    rec,
    ...(assets.docOri ? { docOri: assets.docOri } : {}),
    ...(assets.docUnwarp ? { docUnwarp: assets.docUnwarp } : {}),
    ...(assets.textLineOri ? { textLineOri: assets.textLineOri } : {})
  };
}

function rotateMatByDocOrientation(
  cv: OpenCv,
  sourceMat: Mat,
  orientation: DocOrientationResult | null
): Mat {
  if (!orientation || orientation.angle === 0) {
    return sourceMat.clone();
  }
  const rotated = new cv.Mat();
  if (orientation.angle === 90) {
    cv.rotate(sourceMat, rotated, cv.ROTATE_90_COUNTERCLOCKWISE);
  } else if (orientation.angle === 180) {
    cv.rotate(sourceMat, rotated, cv.ROTATE_180);
  } else {
    cv.rotate(sourceMat, rotated, cv.ROTATE_90_CLOCKWISE);
  }
  return rotated;
}

function rotateMatByTextLineOrientation(
  cv: OpenCv,
  sourceMat: Mat,
  orientation: TextLineOrientationResult | null
): Mat {
  if (!orientation || orientation.angle === 0) {
    return sourceMat.clone();
  }
  const rotated = new cv.Mat();
  cv.rotate(sourceMat, rotated, cv.ROTATE_180);
  return rotated;
}

export class OcrPipelineRunner {
  protected options: OcrPipelineRunnerOptions;
  protected modelConfig: OcrModelConfig;
  protected runtimeDefaults: Partial<OcrRuntimeParamsInput>;
  protected cv: OpenCv | null;
  protected ort: OrtModule | null;
  protected docOrientationModel: DocOrientationModel | null;
  protected docUnwarpingModel: DocUnwarpingModel | null;
  protected textLineOrientationModel: TextLineOrientationModel | null;
  protected detModel: DetModel | null;
  protected recModel: RecModel | null;
  protected webgpuState: WebGpuState;
  protected pipelineConfig: NormalizedPipelineConfig;
  protected lastInitializationSummary: InitializationSummary | null;
  private ensureServedFromHttp: EnsureServedFromHttpFn;
  private sourceToMat: SourceToMatFn | undefined;

  constructor(options: OcrPipelineRunnerOptions) {
    this.options = options;
    this.modelConfig = cloneDefaultOcrConfig();
    this.pipelineConfig = options.pipelineConfig;
    this.runtimeDefaults = { ...options.pipelineConfig.runtimeDefaults };
    this.cv = null;
    this.ort = null;
    this.docOrientationModel = null;
    this.docUnwarpingModel = null;
    this.textLineOrientationModel = null;
    this.detModel = null;
    this.recModel = null;
    this.webgpuState = { available: false, reason: "" };
    this.lastInitializationSummary = null;
    this.ensureServedFromHttp = options.ensureServedFromHttp || noopEnsureServedFromHttp;
    this.sourceToMat = options.sourceToMat;
  }

  async initialize(): Promise<InitializationSummary> {
    this.ensureServedFromHttp();
    const start = nowMs();
    const { cv } = await initOpenCvRuntime();
    this.cv = cv;
    const { ort, webgpuState, backend } = await initOrtRuntime(this.options.ortOptions || {});
    this.ort = ort;
    this.webgpuState = webgpuState;

    const assets = getResolvedAssets(this.pipelineConfig.assets);
    const fetchImpl = this.options.fetch || fetch;
    const shouldLoadDocOrientation = Boolean(
      this.pipelineConfig.useDocOrientationClassify && assets.docOri
    );
    const shouldLoadDocUnwarping = Boolean(this.pipelineConfig.useDocUnwarping && assets.docUnwarp);
    const shouldLoadTextLineOrientation = Boolean(
      this.pipelineConfig.useTextLineOrientation && assets.textLineOri
    );
    const loadedAssets = await Promise.all([
      ...(shouldLoadDocOrientation && assets.docOri
        ? [loadModelAsset(assets.docOri, fetchImpl)]
        : []),
      ...(shouldLoadDocUnwarping && assets.docUnwarp
        ? [loadModelAsset(assets.docUnwarp, fetchImpl)]
        : []),
      loadModelAsset(assets.det, fetchImpl),
      ...(shouldLoadTextLineOrientation && assets.textLineOri
        ? [loadModelAsset(assets.textLineOri, fetchImpl)]
        : []),
      loadModelAsset(assets.rec, fetchImpl)
    ]);
    const docOriAsset = shouldLoadDocOrientation ? loadedAssets[0] : null;
    const docUnwarpAsset = shouldLoadDocUnwarping ? loadedAssets[docOriAsset ? 1 : 0] : null;
    const detAsset = loadedAssets[(docOriAsset ? 1 : 0) + (docUnwarpAsset ? 1 : 0)];
    const textLineOriAsset = shouldLoadTextLineOrientation
      ? loadedAssets[(docOriAsset ? 2 : 1) + (docUnwarpAsset ? 1 : 0)]
      : null;
    const recAsset = loadedAssets[
      (docOriAsset ? 2 : 1) + (docUnwarpAsset ? 1 : 0) + (textLineOriAsset ? 1 : 0)
    ];
    if (docOriAsset) {
      validateLoadedModelName(
        "DocOrientationClassify",
        this.pipelineConfig.modelSelection.docOrientationModelName,
        docOriAsset.configText
      );
    }
    if (docUnwarpAsset) {
      validateDocUnwarpingModelName(
        this.pipelineConfig.modelSelection.docUnwarpingModelName,
        docUnwarpAsset.configText
      );
    }
    validateLoadedModelName(
      "TextDetection",
      this.pipelineConfig.modelSelection.textDetectionModelName,
      detAsset.configText
    );
    if (textLineOriAsset) {
      validateLoadedModelName(
        "TextLineOrientation",
        this.pipelineConfig.modelSelection.textLineOrientationModelName,
        textLineOriAsset.configText
      );
    }
    validateLoadedModelName(
      "TextRecognition",
      this.pipelineConfig.modelSelection.textRecognitionModelName,
      recAsset.configText
    );
    await this.disposeModelsOnly();
    const detBatchSize = this.pipelineConfig.textDetectionBatchSize;
    const textLineOriBatchSize = this.pipelineConfig.textLineOrientationBatchSize;
    const recBatchSize = this.pipelineConfig.textRecognitionBatchSize;

    const [
      docOrientationModel,
      docUnwarpingModel,
      detModel,
      textLineOrientationModel,
      recModel
    ] = await Promise.all([
      docOriAsset
        ? createDocOrientationModel({
            ort: this.ort,
            modelBytes: docOriAsset.modelBytes,
            configText: docOriAsset.configText,
            backend,
            webgpuState
          })
        : Promise.resolve(null),
      docUnwarpAsset
        ? createDocUnwarpingModel({
            ort: this.ort,
            modelBytes: docUnwarpAsset.modelBytes,
            configText: docUnwarpAsset.configText,
            backend,
            webgpuState
          })
        : Promise.resolve(null),
      createDetModel({
        ort: this.ort,
        modelBytes: detAsset.modelBytes,
        configText: detAsset.configText,
        backend,
        webgpuState,
        batchSize: detBatchSize
      }),
      textLineOriAsset
        ? createTextLineOrientationModel({
            ort: this.ort,
            modelBytes: textLineOriAsset.modelBytes,
            configText: textLineOriAsset.configText,
            backend,
            webgpuState,
            batchSize: textLineOriBatchSize
          })
        : Promise.resolve(null),
      createRecModel({
        ort: this.ort,
        modelBytes: recAsset.modelBytes,
        configText: recAsset.configText,
        backend,
        webgpuState,
        batchSize: recBatchSize
      })
    ]);
    this.docOrientationModel = docOrientationModel;
    this.docUnwarpingModel = docUnwarpingModel;
    this.detModel = detModel;
    this.textLineOrientationModel = textLineOrientationModel;
    this.recModel = recModel;
    this.modelConfig = {
      det: this.detModel.config,
      rec: this.recModel.config
    };

    const elapsed = nowMs() - start;
    this.lastInitializationSummary = {
      backend,
      webgpuAvailable: webgpuState.available,
      detProvider: this.detModel.provider,
      recProvider: this.recModel.provider,
      assets: loadedAssets.map((asset) => asset.download),
      elapsedMs: elapsed,
      pipelineConfigWarnings: this.pipelineConfig.warnings
    };
    return this.lastInitializationSummary;
  }

  getInitializationSummary(): InitializationSummary | null {
    return this.lastInitializationSummary;
  }

  getModelConfig(): OcrModelConfig {
    return this.modelConfig;
  }

  async predict(input: unknown, params: OcrRuntimeParamsInput = {}): Promise<OcrResult[]> {
    if (!this.sourceToMat) {
      throw new Error("PaddleOCR source adapter is not configured.");
    }
    if (!this.detModel || !this.recModel || !this.cv || !this.ort) {
      await this.initialize();
    }

    const cv = this.cv;
    const detModel = this.detModel;
    const recModel = this.recModel;
    if (!cv || !detModel || !recModel) {
      throw new Error("Initialization did not complete. Call initialize() first.");
    }

    const sources = Array.isArray(input) ? input : [input];
    const sourceToMat = this.sourceToMat;
    const pipelineBatchSize = Math.max(1, Math.floor(this.pipelineConfig.pipelineBatchSize) || 1);
    const sourceBatches = chunkArray(sources, pipelineBatchSize);

    const totalStart = nowMs();
    const resolved = getOcrRuntimeParams(this.modelConfig, this.runtimeDefaults, params);

    let sumDetMs = 0;
    let sumRecMs = 0;
    const partials: Array<{
      image: { width: number; height: number };
      items: OcrResultItem[];
      docOrientation: DocOrientationResult | null;
      docUnwarping: DocUnwarpingResult | null;
      detectedBoxes: number;
      recognizedCount: number;
    }> = [];

    for (const batchSources of sourceBatches) {
      const sourceImages = await Promise.all(
        batchSources.map((source) => Promise.resolve(sourceToMat(cv, source)))
      );
      const processedImages: Array<{
        mat: Mat;
        width: number;
        height: number;
        docOrientation: DocOrientationResult | null;
        docUnwarping: DocUnwarpingResult | null;
      }> = [];
      try {
        for (const sourceImage of sourceImages) {
          const docOrientation = this.docOrientationModel
            ? await this.docOrientationModel.predict(cv, sourceImage.mat)
            : null;
          let mat = rotateMatByDocOrientation(cv, sourceImage.mat, docOrientation);
          let docUnwarping: DocUnwarpingResult | null = null;
          if (this.docUnwarpingModel) {
            const unwarped = await this.docUnwarpingModel.predict(cv, mat);
            mat.delete();
            mat = unwarped.mat;
            docUnwarping = unwarped.result;
          }
          processedImages.push({
            mat,
            width: mat.cols,
            height: mat.rows,
            docOrientation,
            docUnwarping
          });
        }

        const detStart = nowMs();
        const detResults = await detModel.predict(
          cv,
          processedImages.map((s) => s.mat),
          resolved.det
        );
        sumDetMs += nowMs() - detStart;

        const recStart = nowMs();
        const perImageItems: OcrResultItem[][] = [];

        for (let imgIdx = 0; imgIdx < detResults.length; imgIdx += 1) {
          const detBoxes = detResults[imgIdx]?.boxes ?? [];
          const cropMats: Mat[] = [];
          for (let boxIdx = 0; boxIdx < detBoxes.length; boxIdx += 1) {
            cropMats.push(cropByPoly(cv, processedImages[imgIdx].mat, detBoxes[boxIdx].poly));
          }

          try {
            const textLineOrientations =
              this.textLineOrientationModel && cropMats.length
                ? await this.textLineOrientationModel.predict(cv, cropMats)
                : [];
            const recInputMats = textLineOrientations.length
              ? cropMats.map((mat, index) =>
                  rotateMatByTextLineOrientation(cv, mat, textLineOrientations[index] ?? null)
                )
              : cropMats;
            let recResults;
            try {
              recResults = cropMats.length ? await recModel.predict(cv, recInputMats) : [];
            } finally {
              if (recInputMats !== cropMats) {
                for (const mat of recInputMats) {
                  mat.delete();
                }
              }
            }
            const items: OcrResultItem[] = [];
            for (let boxIdx = 0; boxIdx < recResults.length; boxIdx += 1) {
              const rec = recResults[boxIdx];
              if (rec.text && rec.score >= resolved.pipeline.scoreThresh) {
                items.push({
                  poly: detBoxes[boxIdx].poly,
                  text: rec.text,
                  score: rec.score,
                  ...(textLineOrientations[boxIdx]
                    ? { textLineOrientation: textLineOrientations[boxIdx] }
                    : {})
                });
              }
            }
            perImageItems.push(items);
          } finally {
            for (const mat of cropMats) {
              mat.delete();
            }
          }
        }

        sumRecMs += nowMs() - recStart;

        for (let i = 0; i < sourceImages.length; i += 1) {
          const processedImage = processedImages[i];
          const detBoxes = detResults[i]?.boxes ?? [];
          const items = perImageItems[i] ?? [];
          partials.push({
            image: {
              width: processedImage.width,
              height: processedImage.height
            },
            items,
            docOrientation: processedImage.docOrientation,
            docUnwarping: processedImage.docUnwarping,
            detectedBoxes: detBoxes.length,
            recognizedCount: items.length
          });
        }
      } finally {
        for (const processedImage of processedImages) {
          processedImage.mat.delete();
        }
        for (const sourceImage of sourceImages) {
          sourceImage.dispose();
        }
      }
    }

    const totalElapsed = nowMs() - totalStart;
    const requestedBackend =
      (this.options.ortOptions as NormalizedOrtOptions | undefined)?.backend ?? "auto";

    return partials.map(
      (p): OcrResult => ({
        image: p.image,
        items: p.items,
        ...(p.docOrientation || p.docUnwarping
          ? {
              preprocessing: {
                ...(p.docOrientation ? { docOrientation: p.docOrientation } : {}),
                ...(p.docUnwarping ? { docUnwarping: p.docUnwarping } : {})
              }
            }
          : {}),
        metrics: {
          detMs: sumDetMs,
          recMs: sumRecMs,
          totalMs: totalElapsed,
          detectedBoxes: p.detectedBoxes,
          recognizedCount: p.recognizedCount
        },
        runtime: {
          requestedBackend,
          detProvider: detModel.provider,
          recProvider: recModel.provider,
          webgpuAvailable: this.webgpuState.available
        }
      })
    );
  }

  async disposeModelsOnly(): Promise<void> {
    await Promise.all([
      this.docOrientationModel?.dispose(),
      this.docUnwarpingModel?.dispose(),
      this.detModel?.dispose(),
      this.textLineOrientationModel?.dispose(),
      this.recModel?.dispose()
    ]);
    this.docOrientationModel = null;
    this.docUnwarpingModel = null;
    this.detModel = null;
    this.textLineOrientationModel = null;
    this.recModel = null;
  }

  async dispose(): Promise<void> {
    await this.disposeModelsOnly();
  }
}

export { OcrPipelineRunner as PaddleOCRCore };
