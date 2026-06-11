import AppKit
import Foundation
import Vision

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

guard CommandLine.arguments.count == 2 else {
  fail("Usage: swift scripts/macos-ocr.swift <image-path>")
}

let imagePath = CommandLine.arguments[1]
let imageUrl = URL(fileURLWithPath: imagePath)

guard let image = NSImage(contentsOf: imageUrl) else {
  fail("Failed to load image: \(imagePath)")
}

guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  fail("Failed to create CGImage: \(imagePath)")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
  try handler.perform([request])
} catch {
  fail("OCR failed: \(error.localizedDescription)")
}

let lines = (request.results ?? [])
  .compactMap { observation in
    observation.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines)
  }
  .filter { !$0.isEmpty }

print(lines.joined(separator: "\n"))

