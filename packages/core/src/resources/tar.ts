/*
 * Copyright (c) 2026 PaddlePaddle Authors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

function readString(bytes: Uint8Array, start: number, length: number): string {
  let output = "";
  for (let index = start; index < start + length; index += 1) {
    const value = bytes[index];
    if (value === 0) break;
    output += String.fromCharCode(value);
  }
  return output.replace(/\0.*$/, "").trim();
}

function readOctal(bytes: Uint8Array, start: number, length: number): number {
  const raw = readString(bytes, start, length).replace(/\0/g, "").trim();
  return raw ? Number.parseInt(raw, 8) : 0;
}

function isEmptyBlock(bytes: Uint8Array, offset: number): boolean {
  for (let index = offset; index < offset + 512; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function normalizeEntryName(name: string): string {
  return name.replace(/^\.?\//, "");
}

function isMetadataEntry(name: string): boolean {
  const segments = normalizeEntryName(name).split("/");
  const baseName = segments[segments.length - 1] || "";
  return (
    baseName.startsWith("._") || segments.includes("PaxHeader") || segments.includes("__MACOSX")
  );
}

const GZIP_MAGIC_FIRST = 0x1f;
const GZIP_MAGIC_SECOND = 0x8b;

function looksLikeGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_FIRST && bytes[1] === GZIP_MAGIC_SECOND;
}

async function inflateGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new Error(
      "This model archive is gzip-compressed (.tar.gz), but DecompressionStream " +
        "is not available in this environment. Serve the uncompressed .tar instead."
    );
  }
  // A hand-rolled ReadableStream rather than `new Blob([bytes]).stream()`:
  // jsdom's Blob does not implement stream(), and this helper has to work both
  // in the browser and under the test environment.
  //
  // The copy matters for types as much as for safety: `new Uint8Array(n)` is
  // backed by a plain ArrayBuffer, which is what DecompressionStream's
  // TransformStream generic expects. The incoming `Uint8Array` is typed as
  // `Uint8Array<ArrayBufferLike>` and does not satisfy it.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(copy);
      controller.close();
    }
  });
  const reader = stream.pipeThrough(new DecompressionStream("gzip")).getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Reads the entries of an uncompressed ustar archive.
 *
 * Gzip-compressed archives (`.tar.gz`) are detected by their magic bytes and
 * decompressed first. Without that sniff a `.tar.gz` is parsed as raw tar
 * bytes, the entry names come back as garbage, and the caller eventually sees
 * `Entry "inference.onnx" was not found in the tar archive.` -- which points at
 * the archive contents rather than the actual problem, that the archive is
 * compressed.
 */
export async function extractTarEntries(
  buffer: ArrayBuffer | Uint8Array
): Promise<Map<string, Uint8Array>> {
  const raw = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const bytes = looksLikeGzip(raw) ? await inflateGzip(raw) : raw;
  const entries = new Map<string, Uint8Array>();
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    if (isEmptyBlock(bytes, offset)) {
      break;
    }

    const name = normalizeEntryName(readString(bytes, offset, 100));
    const size = readOctal(bytes, offset + 124, 12);
    const type = bytes[offset + 156];
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (type !== 53 && type !== 120 && name && !isMetadataEntry(name)) {
      entries.set(name, bytes.slice(dataStart, dataEnd));
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

export function pickTarEntry(entries: Map<string, Uint8Array>, targetName: string): Uint8Array {
  const normalizedTarget = normalizeEntryName(targetName);
  const entry = entries.get(normalizedTarget);
  if (entry) {
    return entry;
  }

  for (const [name, value] of entries) {
    if (name.endsWith(`/${normalizedTarget}`) || name === normalizedTarget) {
      return value;
    }
  }

  throw new Error(`Entry "${targetName}" was not found in the tar archive.`);
}
