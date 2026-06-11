export interface UrlExtractionResult {
  title: string;
  site: string;
  normalizedText: string;
}

function stripScripts(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function extractTitle(html: string, url: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    return decodeHtml(titleMatch[1].replace(/\s+/g, " ").trim()).slice(0, 120);
  }
  return new URL(url).hostname;
}

function htmlToText(html: string): string {
  return decodeHtml(
    stripScripts(html)
      .replace(/<\/(p|div|li|h[1-6]|article|section)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export async function extractUrl(url: string): Promise<UrlExtractionResult> {
  const parsed = new URL(url);
  const response = await fetch(parsed.href, {
    headers: {
      "user-agent": "AI Capture Inbox/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: HTTP ${response.status}`);
  }
  const html = await response.text();
  const title = extractTitle(html, parsed.href);
  const text = htmlToText(html).slice(0, 20000);
  return {
    title,
    site: parsed.hostname,
    normalizedText: `${title}\n\nSource: ${parsed.href}\n\n${text}`.trim()
  };
}
