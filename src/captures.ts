import { createId } from "./utils/id.ts";
import { nowIso } from "./utils/time.ts";
import { CaptureStatus, SourceType } from "./types/schema.ts";
import { normalizeTextInput } from "./extractors/text.ts";
import { extractUrl } from "./extractors/url.ts";
import { copyCaptureFile } from "./extractors/file.ts";
import type { Capture, NewCaptureFields } from "./types/models.ts";
import type { Repositories } from "./storage/repositories.ts";

export async function createTextCapture(repositories: Repositories, text: string): Promise<Capture> {
  const extracted = normalizeTextInput(text);
  return createCapture(repositories, {
    sourceType: SourceType.TEXT,
    title: extracted.title,
    rawText: text,
    normalizedText: extracted.normalizedText
  });
}

export async function createUrlCapture(repositories: Repositories, url: string): Promise<Capture> {
  const capture = await createCapture(repositories, {
    sourceType: SourceType.URL,
    title: url,
    sourceUrl: url,
    normalizedText: url
  });

  try {
    const extracted = await extractUrl(url);
    return repositories.updateCapture(capture.id, {
      title: extracted.title,
      site: extracted.site,
      normalizedText: extracted.normalizedText
    });
  } catch (error) {
    return repositories.updateCapture(capture.id, {
      extractionError: getErrorMessage(error)
    });
  }
}

export async function createFileCapture(repositories: Repositories, filePath: string): Promise<Capture> {
  const extracted = await copyCaptureFile(filePath);
  return createCapture(repositories, {
    sourceType: SourceType.FILE,
    title: extracted.title,
    filePath: extracted.filePath,
    mimeType: extracted.mimeType,
    normalizedText: extracted.normalizedText,
    imageDataUrl: extracted.imageDataUrl,
    ocrText: extracted.ocrText,
    ocrProvider: extracted.ocrProvider,
    ocrError: extracted.ocrError
  });
}

async function createCapture(repositories: Repositories, fields: NewCaptureFields): Promise<Capture> {
  const timestamp = nowIso();
  return repositories.createCapture({
    id: createId("cap"),
    status: CaptureStatus.PENDING,
    reviewStatus: null,
    aiResult: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...fields
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
