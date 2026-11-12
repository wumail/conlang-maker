import { describe, expect, test } from "bun:test";
import { fontFeaturesToCss, parseFontFeature, resolveFontFeatures } from "./fontLayout";

describe("language font features", () => {
  test("ss01 modes preserve the normal composition features", () => {
    expect(resolveFontFeatures(["ss01=1"])).toContain("calt=1");
    expect(resolveFontFeatures(["ss01=0", "+ss01"])).toContain("ss01=1");
    expect(fontFeaturesToCss(["-ss01"])).toContain('"ss01" 0');
  });
  test("invalid feature strings are rejected", () => {
    expect(() => parseFontFeature("ss01; background: red")).toThrow();
  });
});
