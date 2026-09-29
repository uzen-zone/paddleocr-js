# Changelog

## [1.0.0] - 2026-09-29

本版本包含两项 **breaking change**，升级前请阅读对应小节。

### ⚠️ Breaking changes

#### 1. `predict()` 的返回形态跟随输入形态

```ts
// 之前：单图也返回数组
const [result] = await ocr.predict(blob);

// 现在：单图返回单个结果
const result = await ocr.predict(blob);
const results = await ocr.predict([a, b]); // 数组输入仍是 1:1、顺序一致
```

- 新增并导出 `OcrPredictInput = ImageSource | Mat`，入参不再是 `unknown`
- `cv.Mat` 主线程接受、worker 模式**故意排除**（不可传输，类型层即可拦住）
- **迁移**：单图调用去掉 `[0]` 解包；想保持旧行为就传单元素数组 `predict([blob])`

#### 2. `PaddleOCRCreateOptions` 去掉索引签名

```ts
// 之前：误拼编译通过且被静默忽略
await PaddleOCR.create({ lang: "ch", ocrVersoin: "PP-OCRv5" });

// 现在：编译期报错，并提示正确键名
// error TS2561: ... 'ocrVersoin' does not exist in type
// 'PaddleOCRCreateOptions'. Did you mean to write 'ocrVersion'?
```

- `interface` 改为 `type`（必要：无索引签名的 interface 不能赋给 `Record<string, unknown>`）
- **迁移**：修正误拼的键名。JS 调用方不受影响，仍会静默无效

### 新增

- `INLINED_ORT_VERSION: string | null` —— 导出包内 worker 实际使用的 `onnxruntime-web` 版本。主线程用使用方安装的版本、worker 用构建时烤进去的版本，两者必须一致；该常量让使用方在启动时就能比对，而不是等到 WASM 实例化失败
- `OcrPredictInput` 类型导出
- 补全模型 asset 别名矩阵：新增 `text_detection_model_asset`、`text_recognition_model_asset`、`doc_orientation_model_asset`、`doc_unwarping_model_asset`、`textline_orientation_model_asset` 五个 snake_case 别名。此前 `*ModelAsset` 只有 camelCase、`*ModelDir` 两种都有，snake_case 的 asset 键会被静默忽略

### 改进

- `Point2D` 元组元素加上 `[x, y]` 标签，并在注释中说明 `[x, y]` 顺序，以及 `.x` / `.y` 在元组上会得到 `undefined` 这一陷阱
- worker 模式未设置 `wasmPaths` 时的控制台警告现在会指明所需版本
- `extractTarEntries` 嗅探 gzip magic bytes（`0x1f 0x8b`）并在解析前解压，`.tar.gz` 模型归档现在可用。此前 `.tar.gz` 被当作未压缩 tar 解析，条目名变成乱码，调用方最终看到 `Entry "inference.onnx" was not found in the tar archive.` —— 报错指向归档内容，而真正的问题是归档被压缩了。该函数变为 `async`，但未从包根导出，不涉及公开 API 变更

### 文档

- 说明 `create()` 会**急切初始化**（首次调用下载约 21 MB 模型，冷缓存需数十秒），并补充 `initialize: false` 的延迟加载用法
- 两份 README 与两份 architecture 文档补充 ONNX Runtime 版本对齐说明
- 修正 `predict()` 返回值文档中与本次改动不一致的 5 处表述

### 测试

新增 8 个测试，覆盖：`predict()` 单图/数组两种形态的正反断言、急切初始化的「等待」语义（含变异验证）、`INLINED_ORT_VERSION` 的导出与取值形态、五个 snake_case asset 别名、gzip 往返解压（含变异验证）与截断流。

---

## 升级版（相对于原始 paddleocr-js）

### 新增文件

| 文件                                               | 说明                                 |
| -------------------------------------------------- | ------------------------------------ |
| `packages/core/src/models/doc-orientation.ts`      | 文档方向分类模型（0°/90°/180°/270°） |
| `packages/core/src/models/doc-unwarping.ts`        | 文档去歪曲/展平模型                  |
| `packages/core/src/models/textline-orientation.ts` | 文本行方向分类模型（0°/180°）        |

### 修改文件

| 文件                                         | 变更内容                                                                                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/resources/model-asset.ts` | `DEFAULT_MODEL_ASSETS` 新增 4 个模型：`PP-LCNet_x1_0_doc_ori`、`PP-LCNet_x0_25_textline_ori`、`PP-LCNet_x1_0_textline_ori`、`UVDoc`                                                            |
| `packages/core/src/models/index.ts`          | 导出新增的 3 个模型模块及其类型                                                                                                                                                                |
| `packages/core/src/pipelines/ocr/index.ts`   | `PaddleOCRCreateOptions` 新增 `docOrientationModelName`、`docUnwarpingModelName`、`textLineOrientationModelName` 及对应 asset/batch 选项                                                       |
| `packages/core/src/pipelines/ocr/config.ts`  | `NormalizedPipelineConfig` 新增 `useDocOrientationClassify`、`useDocUnwarping`、`useTextLineOrientation` 标志；`PipelineModelSelection` 扩展 3 个字段；移除旧版的 `addFeatureWarning` 忽略逻辑 |
| `packages/core/src/pipelines/ocr/core.ts`    | 管道新增预处理步骤：文档旋转校正 → 文档展平 → 文本行方向校正 → 检测 → 识别；`OcrResultItem` 新增 `textLineOrientation` 字段；`OcrResult` 新增可选 `preprocessing` 字段                         |
| `packages/core/src/pipelines/ocr/shared.ts`  | `OCR_MODEL_ROLES` 新增 3 个角色（docOri/docUnwarp/textLineOri）；`PP_OCRV6_LANG_VERSION_MODEL_SELECTION` 包含新模型默认值；批处理大小新增 `textLineOri` 维度                                   |
| `packages/core/src/index.ts`                 | 导出新增模型的类型                                                                                                                                                                             |

### 删除文件

无
