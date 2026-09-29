# 架构说明

[English](architecture.md) | 简体中文

## 项目结构

`paddleocr-js` 目录下主要有两部分：

- `packages/core`：浏览器 PaddleOCR SDK，发布到 npm 时包名为 `@uzen/paddleocr-js`
- `demo`：依赖该 SDK 的 PP-OCR 演示应用

## SDK 包布局（`packages/core`）

```
src/
├── runtime/       — 推理运行时初始化
├── resources/     — 模型与资源管理
├── models/        — 模型接线
├── platform/      — 浏览器 / Worker 输入适配
├── worker/        — Worker 传输层
├── pipelines/     — 产线实现
├── viz/           — 可视化（可选）
├── types/         — 外部库类型声明
└── utils/         — 共享工具
```

当前高层产线入口为 `PaddleOCR.create()`，它负责协调：

1. 运行时初始化（OpenCV.js + ONNX Runtime Web）
2. 执行后端选择（WASM / WebGPU / auto）
3. 模型下载（检测、识别、以及可选的预处理模型）
4. 推理会话创建
5. OCR 产线执行

## OCR 产线

OCR 产线按以下阶段处理图像：

```
输入图像
  │
  ├─ [可选] 文档方向分类
  │    判断文档整体方向（0°/90°/180°/270°）并自动旋转校正
  │
  ├─ [可选] 文档去歪曲 / 展平
  │    使用学习模型校正透视畸变和页面弯曲，输出平整文档图像
  │
  ├─ 文本检测
  │    检测文本区域，输出边界多边形
  │
  ├─ [可选] 文本行方向分类
  │    判断每个裁剪文本行的方向（0°/180°），在识别前将倒置行旋转正
  │
  └─ 文本识别
       对校正后的每个文本行进行字符识别
```

每个可选阶段可独立启用或禁用。启用时，相应模型资源会在初始化阶段下载、校验并加载。

### 结果结构

启用预处理阶段后，OCR 结果会包含额外字段：

- `OcrResultItem.textLineOrientation`：每行文本的方向分类结果（角度 + 置信度）
- `OcrResult.preprocessing.docOrientation`：文档级方向分类结果
- `OcrResult.preprocessing.docUnwarping`：文档展平结果元数据

## Worker 执行模型

`PaddleOCR.create()` 支持两种执行模式：

- 主线程模式：返回 `PaddleOCR`，直接在调用线程上执行 OCR
- Worker 模式：返回 `WorkerBackedPaddleOCR`，将 OCR 生命周期调用转发到独立 Worker

Worker 模式下的运行流程如下：

1. `PaddleOCR.create({ worker: true })` 解析 OCR 选项并创建 `WorkerBackedPaddleOCR`
2. `WorkerBackedPaddleOCR` 通过 `WorkerTransportClient` 发送 `init` / `predict` / `dispose` 请求
3. OCR 产线层持有默认 Worker 工厂，并将其指向 `src/pipelines/ocr/worker-entry.ts`
4. `src/pipelines/ocr/worker-entry.ts` 将 `src/worker/entry.ts` 中的通用 Worker 引导逻辑与 OCR 专用处理逻辑绑定
5. `OcrPipelineRunner` 在 Worker 内运行 OpenCV.js、ONNX Runtime Web、模型加载、检测与识别
6. 结果和错误会被序列化后传回主线程

输入处理按环境拆分：

- 主线程：将浏览器输入标准化为可传输的负载
- Worker：将负载还原为 `cv.Mat` 等运行时输入

Worker 模式使用包内 Worker 路径，并在内部显式关闭 ONNX Runtime Web 的 wasm proxy。这样可以避免双层 Worker 叠加，并让包本身负责并发模型。

ONNX Runtime Web 在运行时需要 WASM 二进制。`ortOptions.wasmPaths` 对两种执行模式统一生效，设置一次即可控制主线程和 Worker 两侧的 WASM 加载位置：

```ts
PaddleOCR.create({
  ortOptions: { wasmPaths: "/assets/" }
});
```

设置了 `wasmPaths` 时，两种模式都会从指定路径拉取 WASM。未设置时，两种模式的回退行为不同：

- 主线程模式：ORT 通过使用方的打包工具解析 WASM（通常由打包工具把 `node_modules/onnxruntime-web/dist/` 下的 `.wasm` 文件拷贝到构建产物并自动改写 URL）
- Worker 模式：SDK 会回退到与构建时安装的 ORT 版本绑定的 CDN，并在控制台提示建议显式设置 `ortOptions.wasmPaths`

因此，在 Worker 模式下建议显式设置 `ortOptions.wasmPaths`，以保证两种模式使用同一套 WASM 版本。

这里有个刻意为之但值得说明的版本差异 —— 两种模式获取 ORT 的方式本就不同：

- 主线程通过 `import("onnxruntime-web")` 加载，该依赖在库构建时被标记为 external，因此使用**使用方安装的版本**
- 包内 worker 以 `inlineDynamicImports: true` 构建，ORT 的 JS glue **在 SDK 构建时就被打包进去**

构建时的版本号以 `INLINED_ORT_VERSION` 导出，同时它也是 CDN 回退地址的版本锚点，因此 worker 加载的 glue 与它拉取的二进制始终来自同一个发布版本。`wasmPaths` 只改变二进制的**获取位置**，不改变**版本** —— 把它指向另一个 ORT 版本的二进制，正是 `INLINED_ORT_VERSION` 能让使用方提前发现的不匹配：

```ts
import { INLINED_ORT_VERSION } from "@uzen/paddleocr-js";

if (INLINED_ORT_VERSION && INLINED_ORT_VERSION !== myInstalledOrtVersion) {
  console.warn(`onnxruntime-web ${myInstalledOrtVersion} != ${INLINED_ORT_VERSION}`);
}
```

## 应用侧职责

SDK 负责 OCR 运行时初始化与推理编排；宿主应用仍需负责：

- 运行环境所需的部署响应头
- 静态资源托管与模型 URL 配置
- `worker: true` 场景下支持产出并加载 Worker 的打包工具或运行时
- 应用界面、状态提示与可视化

这里的 `demo/` 目录就承载了这类宿主应用。
