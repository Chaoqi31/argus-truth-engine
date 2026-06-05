import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import IncidentsPage from "@/app/incidents/page";
import MiroMindPage from "@/app/miromind/page";
import ForTeamsPage from "@/app/for-teams/page";

beforeAll(() => {
  window.matchMedia ??= (() =>
    ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList);
});

describe("marketing page CTAs", () => {
  it.each([
    ["Incidents", IncidentsPage],
    ["Powered by MiroMind", MiroMindPage],
    ["For teams", ForTeamsPage],
  ])("%s footer offers both start and sample audit paths", (_label, Page) => {
    render(<Page />);

    expect(screen.getByRole("link", { name: /start auditing/i })).toHaveAttribute("href", "/audit");
    expect(screen.getByRole("link", { name: /see a sample audit/i })).toHaveAttribute(
      "href",
      "/audit?demo=1",
    );
  });

  it("labels incident ratio badges so they do not read like scores", () => {
    render(<IncidentsPage />);

    expect(screen.getByText("16/27 citations")).toBeInTheDocument();
    expect(screen.getByText("21/23 quotes")).toBeInTheDocument();
    expect(screen.getByText("10/15 fake books")).toBeInTheDocument();
  });
});
