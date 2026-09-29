import { describe, expect, it } from "vitest";

import {
  cloneDefaultOcrConfig,
  normalizeOrtOptions,
  resolvePaddleOCROptions,
  resolveWorkerOptions,
  validateLoadedModelName
} from "../src/pipelines/ocr/shared";

describe("OCR shared option resolution", () => {
  it("normalizes ORT options and reuses the same backend fallback", () => {
    const defaultOrt = normalizeOrtOptions();

    expect(defaultOrt).toMatchObject({
      backend: expect.any(String)
    });
    expect(normalizeOrtOptions({ backend: "invalid", proxy: true })).toEqual({
      backend: defaultOrt.backend,
      proxy: true
    });
    expect(
      normalizeOrtOptions({
        backend: "wasm",
        wasmPaths: "/wasm/",
        numThreads: 2,
        simd: true,
        proxy: false
      })
    ).toEqual({
      backend: "wasm",
      wasmPaths: "/wasm/",
      numThreads: 2,
      simd: true,
      proxy: false
    });
  });

  it("resolves worker options from booleans and custom factories", () => {
    const createWorker = () => ({});

    expect(resolveWorkerOptions(false)).toEqual({
      enabled: false,
      createWorker: null
    });
    expect(resolveWorkerOptions(true)).toEqual({
      enabled: true,
      createWorker: null
    });
    expect(resolveWorkerOptions({ createWorker })).toEqual({
      enabled: true,
      createWorker
    });
    expect(resolveWorkerOptions({})).toEqual({
      enabled: true,
      createWorker: null
    });
  });

  it("rejects unsupported worker option types", () => {
    expect(() => resolveWorkerOptions("yes")).toThrow(
      /worker must be a boolean or an options object/i
    );
  });

  it("returns ortOptions, assets, and model selection for explicit model names", () => {
    const options = resolvePaddleOCROptions({
      text_detection_model_name: "PP-OCRv5_mobile_det",
      text_recognition_model_name: "PP-OCRv5_mobile_rec",
      ortOptions: {
        backend: "webgpu",
        proxy: true
      }
    });

    expect(options.ortOptions).toEqual({
      backend: "webgpu",
      proxy: true
    });
    expect(options.pipelineConfig.assets.det?.url).toMatch(/PP-OCRv5_mobile_det.*\.tar$/);
    expect(options.pipelineConfig.assets.rec?.url).toMatch(/PP-OCRv5_mobile_rec.*\.tar$/);
    expect(options.pipelineConfig.modelSelection).toEqual({
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textRecognitionModelName: "PP-OCRv5_mobile_rec",
      docOrientationModelName: "PP-LCNet_x1_0_doc_ori",
      docUnwarpingModelName: "UVDoc",
      textLineOrientationModelName: "PP-LCNet_x1_0_textline_ori"
    });
  });

  it("rejects incomplete pipeline model selection", () => {
    expect(() =>
      resolvePaddleOCROptions({
        pipelineConfig: {
          pipeline_name: "OCR",
          SubModules: {
            TextDetection: {
              model_name: "PP-OCRv5_mobile_det"
            }
          }
        }
      })
    ).toThrow(/must define both "SubModules.TextDetection" and "SubModules.TextRecognition"/i);
  });

  it("clones the default OCR config deeply", () => {
    const cloned = cloneDefaultOcrConfig();
    cloned.det.postprocess.thresh = 0.99;

    expect(cloned.det.postprocess.thresh).toBe(0.99);

    const freshClone = cloneDefaultOcrConfig();
    expect(freshClone.det.postprocess.thresh).not.toBe(0.99);
  });

  it("validates loaded model names against inference.yml (roles match pipeline initialize)", () => {
    expect(() =>
      validateLoadedModelName(
        "TextDetection",
        "PP-OCRv5_mobile_det",
        "Global:\n  model_name: PP-OCRv5_mobile_det"
      )
    ).not.toThrow();

    expect(() =>
      validateLoadedModelName(
        "TextDetection",
        "PP-OCRv5_mobile_det",
        "Global:\n  model_name: other"
      )
    ).toThrow(/requested model_name is "PP-OCRv5_mobile_det"/i);
  });

  it("throws on an unknown create option key", () => {
    // The JavaScript-side counterpart to the TypeScript index signature
    // removal: a JS caller gets a clear error instead of a silent no-op.
    expect(() => resolvePaddleOCROptions({ lang: "ch", ocrVersoin: "PP-OCRv5" })).toThrow(
      /Unknown PaddleOCRCreateOptions key: "ocrVersoin"\. Did you mean "ocrVersion"\?/
    );
  });

  it("does not suggest a key when nothing is close enough", () => {
    // A suggestion is only useful when it is right; otherwise the caller is
    // better off reading the error than a wrong guess.
    expect(() => resolvePaddleOCROptions({ zzz: 1 })).toThrow(
      /Unknown PaddleOCRCreateOptions key: "zzz"\.$/
    );
  });

  it("accepts every documented create option key", () => {
    // Guards the known-keys list itself: a key missing from it would throw for
    // a legitimate option, which is worse than not checking at all.
    //
    // Aliases of one role must share a single object reference -- the conflict
    // check compares by identity, so two literals with the same URL are
    // "conflicting" even though they are the same value.
    const det = { url: "https://example.com/det.tar" };
    const rec = { url: "https://example.com/rec.tar" };
    const docOri = { url: "https://example.com/doc-ori.tar" };
    const docUnwarp = { url: "https://example.com/uvdoc.tar" };
    const textLineOri = { url: "https://example.com/textline.tar" };

    const options = {
      worker: false,
      fetch,
      initialize: false,
      ortOptions: {},
      pipelineConfig: undefined,
      unsupportedBehavior: "warn",
      lang: "ch",
      ocrVersion: "PP-OCRv5",
      textDetectionModelName: "PP-OCRv5_mobile_det",
      text_detection_model_name: "PP-OCRv5_mobile_det",
      textRecognitionModelName: "PP-OCRv5_mobile_rec",
      text_recognition_model_name: "PP-OCRv5_mobile_rec",
      docOrientationModelName: "PP-LCNet_x1_0_doc_ori",
      doc_orientation_model_name: "PP-LCNet_x1_0_doc_ori",
      docUnwarpingModelName: "UVDoc",
      doc_unwarping_model_name: "UVDoc",
      textLineOrientationModelName: "PP-LCNet_x1_0_textline_ori",
      textline_orientation_model_name: "PP-LCNet_x1_0_textline_ori",
      textDetectionModelAsset: det,
      textDetectionModelDir: det,
      text_detection_model_dir: det,
      textRecognitionModelAsset: rec,
      textRecognitionModelDir: rec,
      text_recognition_model_dir: rec,
      docOrientationModelAsset: docOri,
      docOrientationModelDir: docOri,
      doc_orientation_model_dir: docOri,
      docUnwarpingModelAsset: docUnwarp,
      docUnwarpingModelDir: docUnwarp,
      doc_unwarping_model_dir: docUnwarp,
      textLineOrientationModelAsset: textLineOri,
      textLineOrientationModelDir: textLineOri,
      textline_orientation_model_dir: textLineOri,
      textDetectionBatchSize: 2,
      text_detection_batch_size: 2,
      textRecognitionBatchSize: 8,
      text_recognition_batch_size: 8,
      textLineOrientationBatchSize: 6,
      textline_orientation_batch_size: 6,
      batch_size: 4,
      textDetLimitSideLen: 64,
      text_det_limit_side_len: 64,
      textDetLimitType: "min",
      text_det_limit_type: "min",
      textDetMaxSideLimit: 4000,
      text_det_max_side_limit: 4000,
      textDetThresh: 0.3,
      text_det_thresh: 0.3,
      textDetBoxThresh: 0.6,
      text_det_box_thresh: 0.6,
      textDetUnclipRatio: 1.5,
      text_det_unclip_ratio: 1.5,
      textRecScoreThresh: 0.5,
      text_rec_score_thresh: 0.5
    };

    expect(() => resolvePaddleOCROptions(options)).not.toThrow();
  });
});
