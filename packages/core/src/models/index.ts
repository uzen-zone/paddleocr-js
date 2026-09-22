/*
 * Copyright (c) 2026 PaddlePaddle Authors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  DEFAULT_DET_MODEL_PARSE_FALLBACKS,
  DEFAULT_DET_MODEL_CONFIG,
  createDetModel,
  createDetModelSession,
  parseDetModelConfigText
} from "./det";
export {
  DEFAULT_REC_MODEL_PARSE_FALLBACKS,
  DEFAULT_REC_RUNTIME_LIMITS,
  DEFAULT_REC_MODEL_CONFIG,
  createRecModel,
  createRecModelSession,
  parseRecModelConfigText
} from "./rec";
export type { RecRuntimeOverrides } from "./rec";
export {
  DEFAULT_DOC_ORIENTATION_MODEL_CONFIG,
  createDocOrientationModel,
  createDocOrientationModelSession,
  parseDocOrientationModelConfigText
} from "./doc-orientation";
export type {
  DocOrientationAngle,
  DocOrientationModel,
  DocOrientationModelConfig,
  DocOrientationResult
} from "./doc-orientation";
export {
  DEFAULT_DOC_UNWARPING_MODEL_CONFIG,
  createDocUnwarpingModel,
  createDocUnwarpingModelSession,
  parseDocUnwarpingModelConfigText,
  validateDocUnwarpingModelName
} from "./doc-unwarping";
export type {
  DocUnwarpingModel,
  DocUnwarpingModelConfig,
  DocUnwarpingResult
} from "./doc-unwarping";
export {
  DEFAULT_TEXTLINE_ORIENTATION_MODEL_CONFIG,
  createTextLineOrientationModel,
  createTextLineOrientationModelSession,
  parseTextLineOrientationModelConfigText
} from "./textline-orientation";
export type {
  TextLineOrientationAngle,
  TextLineOrientationModel,
  TextLineOrientationModelConfig,
  TextLineOrientationResult,
  TextLineOrientationRuntimeOverrides
} from "./textline-orientation";
