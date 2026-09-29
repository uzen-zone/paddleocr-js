import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { extractTarEntries, pickTarEntry } from "../src/resources/tar";
import { createTar } from "./tar-fixture";

describe("tar helpers", () => {
  it("extracts nested inference files from a tar archive", async () => {
    const tarBuffer = createTar([
      { name: "det/inference.onnx", content: "onnx" },
      { name: "det/inference.yml", content: "yaml" }
    ]);

    const entries = await extractTarEntries(tarBuffer);

    expect(new TextDecoder().decode(pickTarEntry(entries, "inference.onnx"))).toBe("onnx");
    expect(new TextDecoder().decode(pickTarEntry(entries, "inference.yml"))).toBe("yaml");
  });

  it("ignores AppleDouble and PaxHeader metadata entries", async () => {
    const tarBuffer = createTar([
      { name: "._det", content: "metadata" },
      { name: "PaxHeader/det", content: "metadata" },
      { name: "det/._inference.onnx", content: "metadata" },
      { name: "det/PaxHeader/inference.onnx", content: "metadata" },
      { name: "det/inference.onnx", content: "onnx" },
      { name: "det/._inference.yml", content: "metadata" },
      { name: "det/PaxHeader/inference.yml", content: "metadata" },
      { name: "det/inference.yml", content: "yaml" }
    ]);

    const entries = await extractTarEntries(tarBuffer);

    expect([...entries.keys()]).toEqual(["det/inference.onnx", "det/inference.yml"]);
    expect(new TextDecoder().decode(pickTarEntry(entries, "inference.onnx"))).toBe("onnx");
    expect(new TextDecoder().decode(pickTarEntry(entries, "inference.yml"))).toBe("yaml");
  });

  it("decompresses a gzip-compressed archive before parsing", async () => {
    // A .tar.gz used to be parsed as raw tar bytes: the entry names came back
    // as garbage and the caller saw `Entry "inference.onnx" was not found in
    // the tar archive.`, which blames the archive contents instead of the real
    // problem -- that the archive is compressed.
    const tarBuffer = createTar([
      { name: "det/inference.onnx", content: "onnx" },
      { name: "det/inference.yml", content: "yaml" }
    ]);
    const gzipped = gzipSync(new Uint8Array(tarBuffer));

    // Sanity check: the fixture really is gzip, so this test cannot pass by
    // accidentally parsing the tar directly.
    expect(gzipped[0]).toBe(0x1f);
    expect(gzipped[1]).toBe(0x8b);

    const entries = await extractTarEntries(gzipped);

    expect([...entries.keys()]).toEqual(["det/inference.onnx", "det/inference.yml"]);
    expect(new TextDecoder().decode(pickTarEntry(entries, "inference.onnx"))).toBe("onnx");
    expect(new TextDecoder().decode(pickTarEntry(entries, "inference.yml"))).toBe("yaml");
  });

  it("reports a clear error for a truncated gzip stream", async () => {
    const tarBuffer = createTar([{ name: "det/inference.onnx", content: "onnx" }]);
    const gzipped = gzipSync(new Uint8Array(tarBuffer));
    // Keep the gzip magic bytes so the sniff still routes it to the inflater,
    // but drop the payload.
    const truncated = gzipped.slice(0, 12);

    await expect(extractTarEntries(truncated)).rejects.toThrow();
  });
});
