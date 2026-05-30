import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "@/lib/url";

describe("safeHttpUrl", () => {
  it("accepts https:// URLs", () => {
    expect(safeHttpUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("accepts http:// URLs", () => {
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com/");
  });

  it("rejects javascript: URLs", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects data: URLs", () => {
    expect(safeHttpUrl("data:text/html,<h1>hi</h1>")).toBeNull();
  });

  it("rejects relative paths", () => {
    expect(safeHttpUrl("/foo/bar")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(safeHttpUrl("")).toBeNull();
  });

  it("rejects null", () => {
    expect(safeHttpUrl(null)).toBeNull();
  });

  it("rejects undefined", () => {
    expect(safeHttpUrl(undefined)).toBeNull();
  });

  it("trims leading/trailing whitespace before parsing", () => {
    expect(safeHttpUrl("  https://example.com  ")).toBe("https://example.com/");
  });
});
