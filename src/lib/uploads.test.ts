import { describe, it, expect } from "vitest";
import {
  VIDEO_UPLOAD,
  DOCUMENT_UPLOAD,
  CAPTION_UPLOAD,
  acceptAttribute,
  checkFile,
  formatSize,
  refusalResponse,
  UploadRefusedError,
  typeForName,
  typeOfAddress,
  UPLOAD_FAILED,
} from "./uploads";

const MB = 1024 * 1024;

describe("upload rules", () => {
  it("keep the limits the routes have always enforced", () => {
    expect(VIDEO_UPLOAD.maxBytes).toBe(500 * MB);
    expect(DOCUMENT_UPLOAD.maxBytes).toBe(50 * MB);
    expect(CAPTION_UPLOAD.maxBytes).toBe(2 * MB);
  });

  it("only map extensions to types the route allows", () => {
    for (const rules of [VIDEO_UPLOAD, DOCUMENT_UPLOAD, CAPTION_UPLOAD]) {
      for (const type of Object.values(rules.extensions)) {
        expect(rules.contentTypes).toContain(type);
      }
    }
  });

  it("build the picker's accept list from both types and extensions", () => {
    const accept = acceptAttribute(VIDEO_UPLOAD).split(",");
    expect(accept).toContain("video/mp4");
    expect(accept).toContain(".mov");
  });
});

describe("formatSize", () => {
  it("uses the smallest sensible unit", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(38 * 1024)).toBe("38 KB");
    expect(formatSize(4.24 * MB)).toBe("4.2 MB");
  });

  it("drops a trailing .0 so limits read naturally", () => {
    expect(formatSize(500 * MB)).toBe("500 MB");
    expect(formatSize(612 * MB)).toBe("612 MB");
  });
});

describe("checkFile", () => {
  const video = (name: string, size: number, type: string) =>
    checkFile({ name, size, type }, VIDEO_UPLOAD);

  it("accepts an allowed type within the limit", () => {
    expect(video("talk.mp4", 20 * MB, "video/mp4")).toEqual({
      ok: true,
      contentType: "video/mp4",
    });
  });

  it("falls back to the extension when the browser gives no type", () => {
    expect(video("talk.MOV", 20 * MB, "")).toEqual({
      ok: true,
      contentType: "video/quicktime",
    });
  });

  it("refuses an unsupported type, naming what is supported", () => {
    const res = video("talk.mkv", 20 * MB, "video/x-matroska");
    expect(res).toEqual({
      ok: false,
      message: "This file type isn't supported. Use MP4, WebM, OGG or MOV.",
    });
  });

  it("refuses a file over the limit with its size and a tip", () => {
    expect(video("talk.mp4", 612 * MB, "video/mp4")).toEqual({
      ok: false,
      message:
        "This file is 612 MB — the limit is 500 MB. Try exporting at 720p or 1080p.",
    });
  });

  it("accepts a file of exactly the limit", () => {
    expect(video("talk.mp4", 500 * MB, "video/mp4").ok).toBe(true);
  });

  it("refuses an empty file", () => {
    expect(video("talk.mp4", 0, "video/mp4").ok).toBe(false);
  });

  it("checks documents against the document rules", () => {
    expect(
      checkFile(
        { name: "Handout.docx", size: 2 * MB, type: "" },
        DOCUMENT_UPLOAD
      )
    ).toEqual({
      ok: true,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const heic = checkFile(
      { name: "photo.heic", size: MB, type: "image/heic" },
      DOCUMENT_UPLOAD
    );
    expect(heic.ok).toBe(false);
    const big = checkFile(
      { name: "scan.pdf", size: 63.2 * MB, type: "application/pdf" },
      DOCUMENT_UPLOAD
    );
    expect(big).toEqual({
      ok: false,
      message:
        "This file is 63.2 MB — the limit is 50 MB. Try compressing it, or split it into smaller files.",
    });
  });
});

/*
 * D119: a document is stored only as the type its name implies, so the
 * address it is kept under says what it is served as.
 */
describe("a document's type comes from its name", () => {
  const doc = (name: string, type: string) => checkFile({ name, size: MB, type }, DOCUMENT_UPLOAD);

  it("sends the type the extension implies, whatever the browser says", () => {
    expect(doc("Handout.PDF", "image/svg+xml")).toEqual({ ok: true, contentType: "application/pdf" });
    // Windows calls a CSV file an Excel one: it is stored as what its name says.
    expect(doc("marks.csv", "application/vnd.ms-excel")).toEqual({ ok: true, contentType: "text/csv" });
    expect(doc("diagram.svg", "image/svg+xml")).toEqual({ ok: true, contentType: "image/svg+xml" });
  });

  it("refuses a name without one of the listed extensions, even of an allowed type", () => {
    expect(doc("handout", "application/pdf").ok).toBe(false);
    expect(doc("handout.pdf.exe", "application/pdf").ok).toBe(false);
    expect(doc("constructor", "").ok).toBe(false);
  });

  it("leaves videos and captions as they were: the browser's type when allowed", () => {
    expect(checkFile({ name: "talk", size: MB, type: "video/mp4" }, VIDEO_UPLOAD)).toEqual({ ok: true, contentType: "video/mp4" });
    expect(VIDEO_UPLOAD.typeFromName).toBeUndefined();
    expect(CAPTION_UPLOAD.typeFromName).toBeUndefined();
  });

  it("reads the type an address names from its path's last part", () => {
    expect(typeForName("a.b.PDF", DOCUMENT_UPLOAD)).toBe("application/pdf");
    expect(typeForName("toString", DOCUMENT_UPLOAD)).toBeNull();
    expect(typeForName(".__proto__", DOCUMENT_UPLOAD)).toBeNull();
    expect(typeOfAddress("https://store1.public.blob.vercel-storage.com/run/handout-Ab12.pdf", DOCUMENT_UPLOAD)).toBe("application/pdf");
    expect(typeOfAddress("/demo/sample.pdf", DOCUMENT_UPLOAD)).toBe("application/pdf");
    expect(typeOfAddress("https://store1.public.blob.vercel-storage.com/pic.svg?x=.pdf", DOCUMENT_UPLOAD)).toBe("image/svg+xml");
    expect(typeOfAddress("https://store1.public.blob.vercel-storage.com/pic.svg#.pdf", DOCUMENT_UPLOAD)).toBe("image/svg+xml");
    expect(typeOfAddress("https://store1.public.blob.vercel-storage.com/a.pdf/", DOCUMENT_UPLOAD)).toBeNull();
    expect(typeOfAddress("https://store1.public.blob.vercel-storage.com/a%2Epdf", DOCUMENT_UPLOAD)).toBeNull();
    expect(typeOfAddress("https://[::1", DOCUMENT_UPLOAD)).toBeNull();
  });

  it("answers a failed token request in the same words whatever went wrong", () => {
    expect(UPLOAD_FAILED).toEqual({ error: "The upload couldn't be started", code: "failed" });
  });
});

describe("checkFile for captions", () => {
  const vtt = (name: string, size: number, type: string) =>
    checkFile({ name, size, type }, CAPTION_UPLOAD);

  it("sends text/vtt even when the browser gives no type", () => {
    expect(vtt("lesson.en.VTT", 12 * 1024, "")).toEqual({
      ok: true,
      contentType: "text/vtt",
    });
    expect(vtt("lesson.vtt", 12 * 1024, "text/vtt").ok).toBe(true);
  });

  it("only takes WebVTT", () => {
    expect(vtt("lesson.srt", 12 * 1024, "application/x-subrip")).toEqual({
      ok: false,
      message: "This file type isn't supported. Use WebVTT (.vtt).",
    });
    expect(vtt("notes.txt", 12 * 1024, "text/plain").ok).toBe(false);
  });

  it("refuses a caption file over 2 MB", () => {
    expect(vtt("lesson.vtt", 3 * MB, "text/vtt")).toEqual({
      ok: false,
      message:
        "This file is 3 MB — the limit is 2 MB. Caption files are usually far smaller, so check it's a WebVTT file.",
    });
  });

  it("offers .vtt in the picker", () => {
    expect(acceptAttribute(CAPTION_UPLOAD).split(",")).toEqual([
      "text/vtt",
      ".vtt",
    ]);
  });
});

describe("refusals", () => {
  it.each([
    ["storage-missing", 503],
    ["signed-out", 401],
    ["not-editor", 403],
    ["rate-limited", 429],
  ] as const)("answers %s with HTTP %i and a stable code", async (code, status) => {
    const res = refusalResponse(code);
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code).toBe(code);
    expect(typeof body.error).toBe("string");
  });

  it("carries its code on the thrown error", () => {
    const err = new UploadRefusedError("not-editor");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("not-editor");
  });
});
