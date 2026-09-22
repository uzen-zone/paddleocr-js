/*
 * Copyright (c) 2026 PaddlePaddle Authors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OpenCv, Mat } from "@techstark/opencv-js";
import type { Tensor } from "onnxruntime-web";

import { assertModelResources } from "../resources/model-asset";
import { createSession, getProviderCandidates, releaseSessions } from "../runtime/ort";
import type { OrtModule, SessionState, WebGpuState } from "../runtime/ort";
import { withTimeout } from "../utils/common";
import {
  getTransformOp,
  parseInferenceConfigText,
  parseScaleValue,
  toBgrFloatCHWFromBgr
} from "./common";
import type { NormalizeConfig } from "./common";
import { runInference } from "./infer";

export type DocOrientationAngle = 0 | 90 | 180 | 270;

export interface DocOrientationModelConfig {
  resizeShort: number;
  cropSize: number;
  normalize: NormalizeConfig;
  labelList: string[];
}

export interface DocOrientationResult {
  angle: DocOrientationAngle;
  score: number;
}

export interface DocOrientationModel {
  readonly kind: "docOrientation";
  readonly config: DocOrientationModelConfig;
  readonly provider: string;
  predict(cv: OpenCv, mat: Mat): Promise<DocOrientationResult>;
  dispose(): Promise<void>;
}

export const DEFAULT_DOC_ORIENTATION_MODEL_CONFIG: Readonly<DocOrientationModelConfig> =
  Object.freeze({
    resizeShort: 256,
    cropSize: 224,
    normalize: {
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225],
      scale: 1 / 255
    },
    labelList: ["0", "90", "180", "270"]
  });

interface CreateDocOrientationModelArgs {
  ort: OrtModule;
  modelBytes: Uint8Array;
  configText: string;
  backend: string;
  webgpuState: WebGpuState;
}

interface PreprocessResult {
  tensor: Tensor;
}

export function parseDocOrientationModelConfigText(text: string): DocOrientationModelConfig {
  const parsed = parseInferenceConfigText(text);
  const preProcess = parsed.PreProcess as Record<string, unknown> | undefined;
  const transformOps = preProcess?.transform_ops as Array<Record<string, unknown>> | undefined;
  const resize = getTransformOp(transformOps, "ResizeImage");
  const crop = getTransformOp(transformOps, "CropImage");
  const normalize = getTransformOp(transformOps, "NormalizeImage");
  const topk = ((parsed.PostProcess as Record<string, unknown> | undefined)?.Topk || {}) as Record<
    string,
    unknown
  >;
  const labels = topk.label_list;

  return {
    resizeShort: Number(
      resize?.resize_short ?? DEFAULT_DOC_ORIENTATION_MODEL_CONFIG.resizeShort
    ),
    cropSize: Number(crop?.size ?? DEFAULT_DOC_ORIENTATION_MODEL_CONFIG.cropSize),
    normalize: {
      mean:
        (normalize?.mean as number[] | undefined) ??
        DEFAULT_DOC_ORIENTATION_MODEL_CONFIG.normalize.mean,
      std:
        (normalize?.std as number[] | undefined) ??
        DEFAULT_DOC_ORIENTATION_MODEL_CONFIG.normalize.std,
      scale: parseScaleValue(normalize?.scale, DEFAULT_DOC_ORIENTATION_MODEL_CONFIG.normalize.scale)
    },
    labelList:
      Array.isArray(labels) && labels.length > 0
        ? labels.map((label) => String(label))
        : [...DEFAULT_DOC_ORIENTATION_MODEL_CONFIG.labelList]
  };
}

export async function createDocOrientationModel({
  ort,
  modelBytes,
  configText,
  backend,
  webgpuState
}: CreateDocOrientationModelArgs): Promise<DocOrientationModel> {
  assertModelResources("Document orientation", {
    model: modelBytes,
    config: configText
  });
  const config = parseDocOrientationModelConfigText(configText);
  let sessionState: SessionState | null = await createDocOrientationModelSession(
    ort,
    modelBytes,
    backend,
    webgpuState
  );

  return {
    kind: "docOrientation",
    config,
    get provider() {
      return sessionState?.provider || "";
    },
    async predict(cv, mat) {
      if (!sessionState?.session) {
        throw new Error("Document orientation model session is not initialized.");
      }
      const prep = preprocess({ cv, ort, config }, mat);
      const output = await runInference(sessionState.session, prep.tensor);
      return postprocess(output, config.labelList);
    },
    async dispose() {
      await releaseSessions(sessionState?.session);
      sessionState = null;
    }
  };
}

export async function createDocOrientationModelSession(
  ort: OrtModule,
  modelBytes: Uint8Array,
  backend: string,
  webgpuState: WebGpuState
): Promise<SessionState> {
  const providerCandidates = getProviderCandidates(backend, webgpuState);
  return withTimeout(
    createSession(ort, modelBytes, providerCandidates),
    60000,
    "Document orientation model"
  );
}

function preprocess(
  context: { cv: OpenCv; ort: OrtModule; config: DocOrientationModelConfig },
  sourceMat: Mat
): PreprocessResult {
  const { cv, ort, config } = context;
  const srcW = sourceMat.cols;
  const srcH = sourceMat.rows;
  const shortSide = Math.max(1, Math.min(srcW, srcH));
  const scale = config.resizeShort / shortSide;
  const resizedW = Math.max(config.cropSize, Math.round(srcW * scale));
  const resizedH = Math.max(config.cropSize, Math.round(srcH * scale));
  const resized = new cv.Mat();
  const cropped = new cv.Mat();
  const bgr = new cv.Mat();

  cv.resize(sourceMat, resized, new cv.Size(resizedW, resizedH), 0, 0, cv.INTER_LINEAR);
  const x = Math.max(0, Math.floor((resizedW - config.cropSize) / 2));
  const y = Math.max(0, Math.floor((resizedH - config.cropSize) / 2));
  const roi = resized.roi(new cv.Rect(x, y, config.cropSize, config.cropSize));
  roi.copyTo(cropped);
  roi.delete();

  if (cropped.channels() === 4) {
    cv.cvtColor(cropped, bgr, cv.COLOR_RGBA2BGR);
  } else if (cropped.channels() === 1) {
    cv.cvtColor(cropped, bgr, cv.COLOR_GRAY2BGR);
  } else {
    cropped.copyTo(bgr);
  }

  const chw = toBgrFloatCHWFromBgr(bgr.data, config.cropSize, config.cropSize, config.normalize);
  resized.delete();
  cropped.delete();
  bgr.delete();

  return {
    tensor: new ort.Tensor("float32", chw, [1, 3, config.cropSize, config.cropSize])
  };
}

function postprocess(output: Tensor, labelList: string[]): DocOrientationResult {
  const data = output.data as Float32Array;
  if (data.length < 1) {
    throw new Error("Document orientation output is empty.");
  }
  let maxIndex = 0;
  let maxValue = -Infinity;
  let expSum = 0;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] > maxValue) {
      maxValue = data[i];
      maxIndex = i;
    }
  }
  for (let i = 0; i < data.length; i += 1) {
    expSum += Math.exp(data[i] - maxValue);
  }
  const label = labelList[maxIndex] ?? "0";
  const angle = Number.parseInt(label, 10);
  if (angle !== 0 && angle !== 90 && angle !== 180 && angle !== 270) {
    throw new Error(`Unexpected document orientation label: ${label}`);
  }
  return {
    angle,
    score: expSum > 0 ? 1 / expSum : 0
  };
}
