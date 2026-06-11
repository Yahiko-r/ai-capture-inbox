import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../utils/id.ts";
import { getAttachmentsDir, getMimeType, isImageFile } from "../utils/files.ts";
import { extractImageTextWithLocalOcr } from "./ocr.ts";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".html", ".csv"]);

export interface FileExtractionResult {
  title: string;
  filePath: string;
  mimeType: string;
  normalizedText: string;
  imageDataUrl: string | null;
  ocrText?: string;
  ocrProvider?: "macos-vision";
  ocrError?: string;
}

export async function copyCaptureFile(filePath: string): Promise<FileExtractionResult> {
  const absolutePath = path.resolve(filePath);
  await fs.access(absolutePath);
  await fs.mkdir(getAttachmentsDir(), { recursive: true });

  const ext = path.extname(absolutePath).toLowerCase();
  const fileName = `${createId("file")}${ext}`;
  const storedPath = path.join(getAttachmentsDir(), fileName);
  await fs.copyFile(absolutePath, storedPath);

  const base = path.basename(absolutePath);
  const mimeType = getMimeType(absolutePath);
  let normalizedText = `File: ${base}\nType: ${mimeType}`;
  let imageDataUrl = null;
  let ocrText: string | undefined;
  let ocrProvider: "macos-vision" | undefined;
  let ocrError: string | undefined;

  if (TEXT_EXTENSIONS.has(ext)) {
    const content = await fs.readFile(absolutePath, "utf8");
    normalizedText = `File: ${base}\n\n${content.slice(0, 20000)}`;
  }

  if (isImageFile(absolutePath)) {
    const buffer = await fs.readFile(absolutePath);
    imageDataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    try {
      const ocr = await extractImageTextWithLocalOcr(absolutePath);
      ocrText = ocr.text;
      ocrProvider = ocr.provider;
    } catch (error) {
      ocrError = error instanceof Error ? error.message : String(error);
    }

    normalizedText = [
      `Image file: ${base}`,
      `Type: ${mimeType}`,
      ocrText
        ? `Local OCR (${ocrProvider}) text:\n${ocrText}`
        : "No local OCR text extracted. Use direct vision analysis if the selected model supports image input.",
      ocrError ? `Local OCR error: ${ocrError}` : null
    ].filter(Boolean).join("\n\n");
  }

  return {
    title: base,
    filePath: storedPath,
    mimeType,
    normalizedText,
    imageDataUrl,
    ocrText,
    ocrProvider,
    ocrError
  };
}
