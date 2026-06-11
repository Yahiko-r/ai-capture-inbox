import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface OcrExtractionResult {
  text: string;
  provider: "macos-vision";
}

export async function extractImageTextWithLocalOcr(filePath: string): Promise<OcrExtractionResult> {
  const scriptPath = path.join(process.cwd(), "scripts", "macos-ocr.swift");
  const { stdout } = await execFileAsync("swift", [scriptPath, filePath], {
    timeout: 30000,
    maxBuffer: 1024 * 1024
  });

  return {
    text: stdout.trim(),
    provider: "macos-vision"
  };
}

