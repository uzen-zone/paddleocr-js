# Changelog

## 升级版（相对于原始 paddleocr-js）

### 新增文件

| 文件 | 说明 |
|---|---|
| `packages/core/src/models/doc-orientation.ts` | 文档方向分类模型（0°/90°/180°/270°） |
| `packages/core/src/models/doc-unwarping.ts` | 文档去歪曲/展平模型 |
| `packages/core/src/models/textline-orientation.ts` | 文本行方向分类模型（0°/180°） |

### 修改文件

| 文件 | 变更内容 |
|---|---|
| `packages/core/src/resources/model-asset.ts` | `DEFAULT_MODEL_ASSETS` 新增 4 个模型：`PP-LCNet_x1_0_doc_ori`、`PP-LCNet_x0_25_textline_ori`、`PP-LCNet_x1_0_textline_ori`、`UVDoc` |
| `packages/core/src/models/index.ts` | 导出新增的 3 个模型模块及其类型 |
| `packages/core/src/pipelines/ocr/index.ts` | `PaddleOCRCreateOptions` 新增 `docOrientationModelName`、`docUnwarpingModelName`、`textLineOrientationModelName` 及对应 asset/batch 选项 |
| `packages/core/src/pipelines/ocr/config.ts` | `NormalizedPipelineConfig` 新增 `useDocOrientationClassify`、`useDocUnwarping`、`useTextLineOrientation` 标志；`PipelineModelSelection` 扩展 3 个字段；移除旧版的 `addFeatureWarning` 忽略逻辑 |
| `packages/core/src/pipelines/ocr/core.ts` | 管道新增预处理步骤：文档旋转校正 → 文档展平 → 文本行方向校正 → 检测 → 识别；`OcrResultItem` 新增 `textLineOrientation` 字段；`OcrResult` 新增可选 `preprocessing` 字段 |
| `packages/core/src/pipelines/ocr/shared.ts` | `OCR_MODEL_ROLES` 新增 3 个角色（docOri/docUnwarp/textLineOri）；`PP_OCRV6_LANG_VERSION_MODEL_SELECTION` 包含新模型默认值；批处理大小新增 `textLineOri` 维度 |
| `packages/core/src/index.ts` | 导出新增模型的类型 |

### 删除文件

无
