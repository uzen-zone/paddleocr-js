# PaddleOCR.js

<p align="center">
    <a href="https://www.npmjs.com/package/@uzen/paddleocr-js"><img alt="NPM" src="https://img.shields.io/npm/v/@uzen%2Fpaddleocr-js"></a>
    <a href="https://www.npmjs.com/package/@uzen/paddleocr-js"><img alt="NPM Downloads" src="https://img.shields.io/npm/dw/@uzen%2Fpaddleocr-js"></a>
    <a href="https://www.jsdelivr.com/package/npm/@uzen/paddleocr-js"><img alt="jsDelivr Hits" src="https://img.shields.io/jsdelivr/npm/hw/@uzen%2Fpaddleocr-js"></a>
    <a href="https://www.npmjs.com/package/@uzen/paddleocr-js"><img alt="License" src="https://img.shields.io/npm/l/@uzen%2Fpaddleocr-js?color=blue"></a>
</p>

English | [简体中文](README_cn.md)

Official browser OCR SDK and demo for PaddleOCR.

## Project structure

| Path             | Role                                                              |
| ---------------- | ----------------------------------------------------------------- |
| `packages/core/` | Browser SDK sources; published to npm as **`@uzen/paddleocr-js`** |
| `demo/`          | Vite demo app that depends on the SDK                             |

## Features

- Text detection + recognition (OCR) pipeline
- Document orientation classification (0°/90°/180°/270°) with auto-rotation
- Document unwarping / flattening preprocessing
- Text line orientation classification (0°/180°) for pre-recognition correction
- Web Worker mode support
- Fully local browser inference — no cloud upload required
- Custom model support (PP-OCRv5, PP-OCRv6)
- YAML pipeline configuration
- Visualization utilities for rendering OCR results
- Multi-language support (Chinese, English, Japanese, etc.)

## Quick start

```ts
import { PaddleOCR } from "@uzen/paddleocr-js";

const ocr = await PaddleOCR.create({
  lang: "ch",
  ocrVersion: "PP-OCRv6"
});

const result = await ocr.predict(blob);
console.log(result.items);
```

## Local development and demo

```bash
npm install
npm run dev:demo
```

Other common commands:

```bash
npm run build
npm run test
npm run typecheck
npm run check
```

## Documentation

| Topic                | Link                                               |
| -------------------- | -------------------------------------------------- |
| Architecture         | [architecture.md](docs/architecture.md)            |
| Development          | [development.md](docs/development.md)              |
| Monorepo conventions | [monorepo.md](docs/monorepo.md)                    |
| SDK package README   | [packages/core/README.md](packages/core/README.md) |

## Acknowledgements

- [PP-OCR](https://github.com/PaddlePaddle/PaddleOCR) for the OCR models
- [ONNX Runtime Web](https://onnxruntime.ai/) for browser-side ONNX inference
- [OpenCV.js](https://opencv.org/) for browser-side image processing
