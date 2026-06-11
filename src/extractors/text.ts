export interface TextExtractionResult {
  title: string;
  normalizedText: string;
}

export function normalizeTextInput(text: string): TextExtractionResult {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Text capture cannot be empty.");
  }
  return {
    title: trimmed.slice(0, 80),
    normalizedText: trimmed
  };
}
