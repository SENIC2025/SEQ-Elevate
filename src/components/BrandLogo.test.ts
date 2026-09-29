import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { BRAND_ASSETS } from "./BrandLogo";

describe("BRAND_ASSETS", () => {
  it.each(Object.entries(BRAND_ASSETS))(
    "%s matches the pixel size of its file in public/",
    (_, asset) => {
      // PNG header: width and height are big-endian at bytes 16 and 20.
      const png = readFileSync(
        new URL(`../../public${asset.src}`, import.meta.url)
      );
      expect(png.readUInt32BE(16)).toBe(asset.width);
      expect(png.readUInt32BE(20)).toBe(asset.height);
    }
  );
});
