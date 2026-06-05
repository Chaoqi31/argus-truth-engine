import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuditPage from "@/app/audit/page";
import { useArgusStore } from "@/lib/store";
import { uploadPdf } from "@/lib/api";
import type { Job } from "@/lib/types";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    uploadPdf: vi.fn(async () => ({ job_id: "job_pdf" })),
    submitText: vi.fn(),
  };
});

function getPdfDropZone() {
  const zone = screen.getByText(/drop a pdf here/i).closest("div");
  if (!zone) throw new Error("PDF drop zone not found");
  return zone;
}

const staleDemoJob: Job = {
  id: "demo_stale",
  pdf_path: "sample.pdf",
  status: "done",
  created_at: "2026-05-20T00:00:00Z",
  completed_at: "2026-05-20T00:10:00Z",
  cost_usd: 0,
  total_tokens: 0,
  claims_total: 0,
  claims_audited: 0,
  audit_report_md: null,
  claims: [],
  findings: [],
  traces: [],
  evidences: [],
};

describe("AuditPage PDF upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    useArgusStore.getState().clear();
  });

  it("starts a PDF audit when a file is dropped on the upload zone", async () => {
    render(<AuditPage />);

    fireEvent.change(screen.getByLabelText(/your miromind api key/i), {
      target: { value: "test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload pdf/i }));

    const file = new File(["%PDF-1.7"], "brief.pdf", { type: "application/pdf" });
    fireEvent.drop(getPdfDropZone(), {
      dataTransfer: { files: [file] },
    });

    await waitFor(() =>
      expect(uploadPdf).toHaveBeenCalledWith(file, "test-key"),
    );
    expect(push).toHaveBeenCalledWith("/audit?id=job_pdf");
  });

  it("does not ask visitors to classify the content domain before upload", () => {
    render(<AuditPage />);

    expect(screen.queryByLabelText(/content domain/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /upload pdf/i }));

    expect(screen.queryByLabelText(/content domain/i)).not.toBeInTheDocument();
  });

  it("offers sample audit navigation from the input page", () => {
    render(<AuditPage />);

    expect(screen.getByRole("link", { name: /see a sample audit/i })).toHaveAttribute(
      "href",
      "/audit?demo=1",
    );

    fireEvent.click(screen.getByRole("button", { name: /see a sample audit/i }));

    expect(push).toHaveBeenCalledWith("/audit?demo=1");
  });

  it("does not upload a dropped PDF before the visitor enters an API key", async () => {
    render(<AuditPage />);

    fireEvent.click(screen.getByRole("button", { name: /upload pdf/i }));

    const file = new File(["%PDF-1.7"], "brief.pdf", { type: "application/pdf" });
    fireEvent.drop(getPdfDropZone(), {
      dataTransfer: { files: [file] },
    });

    expect(uploadPdf).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/paste your miromind api key/i);
  });

  it("rejects non-PDF drops before calling the upload API", async () => {
    render(<AuditPage />);

    fireEvent.change(screen.getByLabelText(/your miromind api key/i), {
      target: { value: "test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload pdf/i }));

    const file = new File(["not a pdf"], "brief.txt", { type: "text/plain" });
    fireEvent.drop(getPdfDropZone(), {
      dataTransfer: { files: [file] },
    });

    expect(uploadPdf).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/only pdf files are supported/i);
  });

  it("opens the fresh input page even if a previous demo job is still in the store", async () => {
    useArgusStore.getState().setJob(staleDemoJob);

    render(<AuditPage />);

    expect(
      screen.getByRole("heading", { name: /audit ai-generated reports before sign-off/i }),
    ).toBeInTheDocument();
    await waitFor(() => expect(useArgusStore.getState().job).toBeNull());
  });
});
