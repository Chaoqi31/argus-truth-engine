import { describe, expect, it } from "vitest";
import { parseSearchHits } from "@/components/trace-stream-view";

describe("parseSearchHits", () => {
  it("extracts title/link/snippet from a real google_search result payload", () => {
    const content = {
      result: JSON.stringify({
        searchParameters: { q: "x" },
        organic: [
          { title: "First", link: "https://a.com", snippet: "snip a" },
          { title: "Second", link: "https://b.com" },
        ],
      }),
    };
    const hits = parseSearchHits(content);
    expect(hits).toEqual([
      { title: "First", link: "https://a.com", snippet: "snip a" },
      { title: "Second", link: "https://b.com", snippet: undefined },
    ]);
  });

  it("falls back to the link as title when title is missing/blank", () => {
    const content = {
      result: JSON.stringify({ organic: [{ link: "https://c.com", title: "  " }] }),
    };
    expect(parseSearchHits(content)[0].title).toBe("https://c.com");
  });

  it("returns [] when there is no result payload — never invents links", () => {
    expect(parseSearchHits({ query: "x" })).toEqual([]);
    expect(parseSearchHits({})).toEqual([]);
  });

  it("returns [] for an empty organic array (search found nothing)", () => {
    expect(parseSearchHits({ result: JSON.stringify({ organic: [] }) })).toEqual([]);
  });

  it("returns [] for a malformed result string instead of throwing", () => {
    expect(parseSearchHits({ result: "not json {" })).toEqual([]);
    expect(parseSearchHits({ result: 42 })).toEqual([]);
  });

  it("drops organic entries that lack a usable link", () => {
    const content = {
      result: JSON.stringify({
        organic: [{ title: "no link" }, { title: "ok", link: "https://d.com" }],
      }),
    };
    const hits = parseSearchHits(content);
    expect(hits).toHaveLength(1);
    expect(hits[0].link).toBe("https://d.com");
  });
});
