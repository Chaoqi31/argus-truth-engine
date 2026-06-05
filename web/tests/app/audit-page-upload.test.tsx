import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuditPage from "@/app/audit/page";
import { useArgusStore } from "@/lib/store";
import { uploadPdf } from "@/lib/api";

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
      expect(uploadPdf).toHaveBeenCalledWith(file, "test-key", { contentDomain: "general" }),
    );
    expect(push).toHaveBeenCalledWith("/audit?id=job_pdf");
  });

  it("passes the selected content domain for PDF audits", async () => {
    render(<AuditPage />);

    fireEvent.change(screen.getByLabelText(/your miromind api key/i), {
      target: { value: "test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload pdf/i }));
    fireEvent.change(screen.getByRole("combobox", { name: /content domain/i }), {
      target: { value: "finance" },
    });

    const file = new File(["%PDF-1.7"], "brief.pdf", { type: "application/pdf" });
    fireEvent.drop(getPdfDropZone(), {
      dataTransfer: { files: [file] },
    });

    await waitFor(() =>
      expect(uploadPdf).toHaveBeenCalledWith(file, "test-key", { contentDomain: "finance" }),
    );
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
});
