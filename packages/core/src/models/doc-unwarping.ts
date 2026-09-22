/*
 * Copyright (c) 2026 PaddlePaddle Authors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OpenCv, Mat } from "@techstark/opencv-js";
import type { Tensor } from "onnxruntime-web";

import { assertModelResources } from "../resources/model-asset";
import { createSession, getProviderCandidates, releaseSessions } from "../runtime/ort";
import type { OrtModule, SessionState, WebGpuState } from "../runtime/ort";
import { clamp, withTimeout } from "../utils/common";
import { extractInferenceModelName } from "./common";
import { runInference } from "./infer";

export interface DocUnwarpingModelConfig {
  maxSideLen: number;
}

export interface DocUnwarpingResult {
  applied: boolean;
  width: number;
  height: number;
}

export interface DocUnwarpingModel {
  readonly kind: "docUnwarping";
  readonly config: DocUnwarpingModelConfig;
  readonly provider: string;
  predict(cv: OpenCv, mat: Mat): Promise<{ mat: Mat; result: DocUnwarpingResult }>;
  dispose(): Promise<void>;
}

export const DEFAULT_DOC_UNWARPING_MODEL_CONFIG: Readonly<DocUnwarpingModelConfig> =
  Object.freeze({
    maxSideLen: 0
  });

interface CreateDocUnwarpingModelArgs {
  ort: OrtModule;
  modelBytes: Uint8Array;
  configText: string;
  backend: string;
  webgpuState: WebGpuState;
}

interface PreprocessResult {
  tensor: Tensor;
  width: number;
  height: number;
}

export function parseDocUnwarpingModelConfigText(_text?: string): DocUnwarpingModelConfig {
  void _text;
  return { ...DEFAULT_DOC_UNWARPING_MODEL_CONFIG };
}

export async function createDocUnwarpingModel({
  ort,
  modelBytes,
  configText,
  backend,
  webgpuState
}: CreateDocUnwarpingModelArgs): Promise<DocUnwarpingModel> {
  assertModelResources("Document unwarping", {
    model: modelBytes,
    config: configText
  });
  const config = parseDocUnwarpingModelConfigText(configText);
  let sessionState: SessionState | null = await createDocUnwarpingModelSession(
    ort,
    modelBytes,
    backend,
    webgpuState
  );

  return {
    kind: "docUnwarping",
    config,
    get provider() {
      return sessionState?.provider || "";
    },
    async predict(cv, mat) {
      if (!sessionState?.session) {
        throw new Error("Document unwarping model session is not initialized.");
      }
      const prep = preprocess({ cv, ort, config }, mat);
      const output = await runInference(sessionState.session, prep.tensor);
      const outputMat = postprocess(cv, output, prep.width, prep.height);
      return {
        mat: outputMat,
        result: {
          applied: true,
          width: outputMat.cols,
          height: outputMat.rows
        }
      };
    },
    async dispose() {
      await releaseSessions(sessionState?.session);
      sessionState = null;
    }
  };
}

export async function createDocUnwarpingModelSession(
  ort: OrtModule,
  modelBytes: Uint8Array,
  backend: string,
  webgpuState: WebGpuState
): Promise<SessionState> {
  const providerCandidates = getProviderCandidates(backend, webgpuState);
  return withTimeout(
    createSession(ort, modelBytes, providerCandidates),
    60000,
    "Document unwarping model"
  );
}

export function validateDocUnwarpingModelName(
  expectedModelName: string | null | undefined,
  configText: string
): void {
  if (!expectedModelName) {
    throw new Error("DocUnwarping model selection must define model_name.");
  }
  const declaredModelName = extractInferenceModelName(configText);
  if (declaredModelName !== expectedModelName) {
    throw new Error(
      `DocUnwarping in inference.yml declares model_name "${declaredModelName ?? ""}" but requested model_name is "${expectedModelName}".`
    );
  }
}

function preprocess(
  context: { cv: OpenCv; ort: OrtModule; config: DocUnwarpingModelConfig },
  sourceMat: Mat
): PreprocessResult {
  const { cv, ort, config } = context;
  const srcW = sourceMat.cols;
  const srcH = sourceMat.rows;
  const maxSide = Math.max(srcW, srcH);
  const scale = config.maxSideLen > 0 && maxSide > config.maxSideLen ? config.maxSideLen / maxSide : 1;
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const resized = new cv.Mat();
  const bgr = new cv.Mat();
  cv.resize(sourceMat, resized, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);
  if (resized.channels() === 4) {
    cv.cvtColor(resized, bgr, cv.COLOR_RGBA2BGR);
  } else if (resized.channels() === 1) {
    cv.cvtColor(resized, bgr, cv.COLOR_GRAY2BGR);
  } else {
    resized.copyTo(bgr);
  }

  const hw = width * height;
  const chw = new Float32Array(3 * hw);
  for (let i = 0; i < hw; i += 1) {
    const p = i * 3;
    chw[i] = bgr.data[p] / 255;
    chw[i + hw] = bgr.data[p + 1] / 255;
    chw[i + 2 * hw] = bgr.data[p + 2] / 255;
  }
  resized.delete();
  bgr.delete();

  return {
    tensor: new ort.Tensor("float32", chw, [1, 3, height, width]),
    width,
    height
  };
}

function postprocess(cv: OpenCv, output: Tensor, fallbackW: number, fallbackH: number): Mat {
  const dims = output.dims;
  if (dims.length !== 4 || dims[1] !== 3) {
    throw new Error(`Unexpected document unwarping output dims: [${dims.join(", ")}]`);
  }
  const height = dims[2] || fallbackH;
  const width = dims[3] || fallbackW;
  const hw = width * height;
  const data = output.data as Float32Array;
  const rgba = new Uint8Array(hw * 4);
  for (let i = 0; i < hw; i += 1) {
    rgba[i * 4] = clamp(Math.round(data[i + 2 * hw] * 255), 0, 255);
    rgba[i * 4 + 1] = clamp(Math.round(data[i + hw] * 255), 0, 255);
    rgba[i * 4 + 2] = clamp(Math.round(data[i] * 255), 0, 255);
    rgba[i * 4 + 3] = 255;
  }
  return cv.matFromArray(height, width, cv.CV_8UC4, rgba);
}
