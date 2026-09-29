import { describe, expect, it, vi } from "vitest";

// Importing the package root pulls in the OpenCV.js UMD bundle, which does not
// finish evaluating under jsdom. Mock it, the same way public-api.test.ts does.
vi.mock("@techstark/opencv-js", () => ({
  default: {
    Mat() {}
  }
}));

import { INLINED_ORT_VERSION } from "../src/index";
import { INLINED_ORT_VERSION as directImport } from "../src/runtime/ort-version";

describe("runtime/ort-version", () => {
  it("is re-exported from the package root", () => {
    expect(INLINED_ORT_VERSION).toBe(directImport);
  });

  it("is null when the build did not define __INLINED_ORT_VERSION__", () => {
    // Vitest does not apply Vite's `define`, so this is the un-built path --
    // source consumers, unit tests, or any bundler that skipped the define. The
    // contract is `string | null`, never `undefined`, so a consumer can null
    // check it without a typeof/falsy dance.
    expect(INLINED_ORT_VERSION).toBeNull();
  });

  it("is either null or a plain semver string", () => {
    // Guards against the define being wired to the CDN prefix or a path by
    // mistake -- a wrong value here would be silently useless.
    if (INLINED_ORT_VERSION !== null) {
      expect(INLINED_ORT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});
