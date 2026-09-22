/*
 * Copyright (c) 2026 PaddlePaddle Authors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OpenCv, Mat } from "@techstark/opencv-js";
import type { Tensor } from "onnxruntime-web";

import { assertModelResources } from "../resources/model-asset";
import { createSession, getProviderCandidates, releaseSessions } from "../runtime/ort";
import type { OrtModule, SessionState, WebGpuState } from "../runtime/ort";
import { chunkArray, resolveRuntimeBatchSize, withTimeout } from "../utils/common";
import {
  getTransformOp,
  parseInferenceConfigText,
  parseScaleValue,
  toBgrFloatCHWFromBgr
} from "./common";
import type { NormalizeConfig } from "./common";
import { runInference } from "./infer";

export type TextLineOrientationAngle = 0 | 180;

export interface TextLineOrientationModelConfig {
  width: number;
  height: number;
  normalize: NormalizeConfig;
  labelList: string[];
}

export interface TextLineOrientationResult {
  angle: TextLineOrientationAngle;
  score: number;
}

export interface TextLineOrientationRuntimeOverrides {
  batchSize?: number;
}

export interface TextLineOrientationModel {
  readonly kind: "textlineOrientation";
  readonly config: TextLineOrientationModelConfig;
  readonly provider: string;
  predict(
    cv: OpenCv,
    mats: Mat[],
    overrides?: TextLineOrientationRuntimeOverrides
  ): Promise<TextLineOrientationResult[]>;
  dispose(): Promise<void>;
}

export const DEFAULT_TEXTLINE_ORIENTATION_MODEL_CONFIG: Readonly<TextLineOrientationModelConfig> =
  Object.freeze({
    width: 160,
    height: 80,
    normalize: {
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225],
      scale: 1 / 255
    },
    labelList: ["0_degree", "180_degree"]
  });

interface CreateTextLineOrientationModelArgs {
  ort: OrtModule;
  modelBytes: Uint8Array;
  configText: string;
  backend: string;
  webgpuState: WebGpuState;
  batchSize?: number;
}

interface TextLineOrientationSample {
  chw: Float32Array;
}

export function parseTextLineOrientationModelConfigText(
  text: string
): TextLineOrientationModelConfig {
  const parsed = parseInferenceConfigText(text);
  const preProcess = parsed.PreProcess as Record<string, unknown> | undefined;
  const transformOps = preProcess?.transform_ops as Array<Record<string, unknown>> | undefined;
  const resize = getTransformOp(transformOps, "ResizeImage");
  const normalize = getTransformOp(transformOps, "NormalizeImage");
  const topk = ((parsed.PostProcess as Record<string, unknown> | undefined)?.Topk || {}) as Record<
    string,
    unknown
  >;
  const size = resize?.size as number[] | undefined;
  const labels = topk.label_list;

  return {
    width: size?.[0] ?? DEFAULT_TEXTLINE_ORIENTATION_MODEL_CONFIG.width,
    height: size?.[1] ?? DEFAULT_TEXTLINE_ORIENTATION_MODEL_CONFIG.height,
    normalize: {
      mean:
        (normalize?.mean as number[] | undefined) ??
        DEFAULT_TEXTLINE_ORIENTATION_MODEL_CONFIG.normalize.mean,
      std:
        (normalize?.std as number[] | undefined) ??
        DEFAULT_TEXTLINE_ORIENTATION_MODEL_CONFIG.normalize.std,
      scale: parseScaleValue(
        normalize?.scale,
        DEFAULT_TEXTLINE_ORIENTATION_MODEL_CONFIG.normalize.scale
      )
    },
    labelList:
      Array.isArray(labels) && labels.length > 0
        ? labels.map((label) => String(label))
        : [...DEFAULT_TEXTLINE_ORIENTATION_MODEL_CONFIG.labelList]
  };
}

export async function createTextLineOrientationModel({
  ort,
  modelBytes,
  configText,
  backend,
  webgpuState,
  batchSize: batchSizeArg
}: CreateTextLineOrientationModelArgs): Promise<TextLineOrientationModel> {
  assertModelResources("Text line orientation", {
    model: modelBytes,
    config: configText
  });
  const config = parseTextLineOrientationModelConfigText(configText);
  const defaultBatchSize = Math.max(1, batchSizeArg ?? 1);
  let sessionState: SessionState | null = await createTextLineOrientationModelSession(
    ort,
    modelBytes,
    backend,
    webgpuState
  );

  return {
    kind: "textlineOrientation",
    config,
    get provider() {
      return sessionState?.provider || "";
    },
    async predict(cv, mats, overrides) {
      if (!sessionState?.session) {
        throw new Error("Text line orientation model session is not initialized.");
      }
      const batchSize = resolveRuntimeBatchSize(overrides?.batchSize, defaultBatchSize);
      const results: TextLineOrientationResult[] = [];
      for (const chunk of chunkArray(mats, batchSize)) {
        const samples = chunk.map((mat) => preprocessSample({ cv, config }, mat));
        const inputTensor = packBatchTensor(ort, samples, config);
        const output = await runInference(sessionState.session, inputTensor);
        results.push(...postprocess(output, config.labelList));
      }
      return results;
    },
    async dispose() {
      await releaseSessions(sessionState?.session);
      sessionState = null;
    }
  };
}

export async function createTextLineOrientationModelSession(
  ort: OrtModule,
  modelBytes: Uint8Array,
  backend: string,
  webgpuState: WebGpuState
): Promise<SessionState> {
  const providerCandidates = getProviderCandidates(backend, webgpuState);
  return withTimeout(
    createSession(ort, modelBytes, providerCandidates),
    60000,
    "Text line orientation model"
  );
}

function preprocessSample(
  context: { cv: OpenCv; config: TextLineOrientationModelConfig },
  sourceMat: Mat
): TextLineOrientationSample {
  const { cv, config } = context;
  const resized = new cv.Mat();
  const bgr = new cv.Mat();
  cv.resize(sourceMat, resized, new cv.Size(config.width, config.height), 0, 0, cv.INTER_LINEAR);
  if (resized.channels() === 4) {
    cv.cvtColor(resized, bgr, cv.COLOR_RGBA2BGR);
  } else if (resized.channels() === 1) {
    cv.cvtColor(resized, bgr, cv.COLOR_GRAY2BGR);
  } else {
    resized.copyTo(bgr);
  }
  const chw = toBgrFloatCHWFromBgr(bgr.data, config.width, config.height, config.normalize);
  resized.delete();
  bgr.delete();
  return { chw };
}

function packBatchTensor(
  ort: OrtModule,
  samples: TextLineOrientationSample[],
  config: TextLineOrientationModelConfig
): Tensor {
  const plane = 3 * config.height * config.width;
  const out = new Float32Array(samples.length * plane);
  for (let i = 0; i < samples.length; i += 1) {
    out.set(samples[i].chw, i * plane);
  }
  return new ort.Tensor("float32", out, [samples.length, 3, config.height, config.width]);
}

function postprocess(output: Tensor, labelList: string[]): TextLineOrientationResult[] {
  const dims = output.dims;
  if (dims.length !== 2) {
    throw new Error(`Unexpected text line orientation output dims: [${dims.join(", ")}]`);
  }
  const sampleCount = dims[0];
  const classes = dims[1];
  const data = output.data as Float32Array;
  const results: TextLineOrientationResult[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const offset = sample * classes;
    let maxIndex = 0;
    let maxValue = -Infinity;
    let expSum = 0;
    for (let cls = 0; cls < classes; cls += 1) {
      const value = data[offset + cls];
      if (value > maxValue) {
        maxValue = value;
        maxIndex = cls;
      }
    }
    for (let cls = 0; cls < classes; cls += 1) {
      expSum += Math.exp(data[offset + cls] - maxValue);
    }
    const label = labelList[maxIndex] ?? "0_degree";
    const angle = label.startsWith("180") ? 180 : 0;
    results.push({
      angle,
      score: expSum > 0 ? 1 / expSum : 0
    });
  }
  return results;
}
