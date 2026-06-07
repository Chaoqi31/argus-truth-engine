import { describe, expect, it } from "vitest";
import { displayableThought, parseSearchHits } from "@/components/trace-stream-view";

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

describe("displayableThought", () => {
  it("suppresses machine JSON fragments from streamed reasoning", () => {
    const raw = `
      },
      "evidence_quality": [
        {
          "evidence_index": 0,
          "authority": 0.9,
          "independence": 0.9,
          "freshness": 0.95,
          "directness": 0.95
        }
      ],
      "coverage": [
        {
          "claim_fragment": "Eiffel Tower was designed by Thomas Edison",
          "relation": "refutes"
        }
      ]
    `;

    expect(displayableThought(raw, "Reasoning checkpoint")).toBeNull();
  });

  it("keeps natural-language reasoning available for expansion", () => {
    const raw = "I searched the official source first, then compared it with secondary references.";

    expect(displayableThought(raw, "Reasoning checkpoint")).toBe(raw);
  });
});
