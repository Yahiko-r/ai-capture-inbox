import path from "node:path";

export function getProjectRoot(): string {
  return process.cwd();
}

export function getDataDir(): string {
  return path.join(getProjectRoot(), "data");
}

export function getAttachmentsDir(): string {
  return path.join(getDataDir(), "attachments");
}

export function isImageFile(filePath: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(filePath);
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".html": "text/html"
  };
  return types[ext] ?? "application/octet-stream";
}
