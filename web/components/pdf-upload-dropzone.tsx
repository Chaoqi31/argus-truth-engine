"use client";

import { useState } from "react";
import type { DragEvent } from "react";

interface PdfUploadDropzoneProps {
  busy?: boolean;
  disabled?: boolean;
  onPicked: (file: File) => void;
}

export function PdfUploadDropzone({
  busy = false,
  disabled = false,
  onPicked,
}: PdfUploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);

  const pickFile = (file: File | undefined) => {
    if (disabled || !file) return;
    onPicked(file);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!disabled) setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    pickFile(event.dataTransfer.files?.[0]);
  };

  return (
    <div
      role="region"
      aria-label="PDF upload"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`mt-4 flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
        dragging && !disabled
          ? "border-primary bg-primary/5"
          : "border-border bg-background"
      } ${disabled ? "opacity-70" : ""}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`size-10 ${dragging && !disabled ? "text-primary" : "text-muted-foreground/50"}`}
        aria-hidden
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="18" x2="12" y2="12" />
        <line x1="9" y1="15" x2="15" y2="15" />
      </svg>
      <p className="text-sm text-muted-foreground">
        {dragging && !disabled ? "Release to upload the PDF" : "Drop a PDF here or click to browse"}
      </p>
      <label
        className={`rounded-[12px] bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#5741d8] ${
          disabled ? "pointer-events-none opacity-50" : "cursor-pointer"
        }`}
      >
        {busy ? "Uploading..." : "Select PDF"}
        <input
          type="file"
          accept="application/pdf"
          disabled={disabled}
          className="sr-only"
          onChange={(event) => pickFile(event.target.files?.[0])}
        />
      </label>
    </div>
  );
}
