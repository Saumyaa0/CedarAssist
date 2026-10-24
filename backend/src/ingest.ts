
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Chunk } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pdfDir = path.resolve(here, "../data/pdfs");
const indexPath = path.resolve(here, "../data/index.json");

const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
const embeddingModel = process.env.EMBEDDING_MODEL || "nomic-embed-text";

function chunkPage(text: string, maxChars = 1000, overlap = 160): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf(" ", end);
      if (boundary > start + Math.floor(maxChars * 0.65)) end = boundary;
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

function findSection(text: string): string | undefined {
  const match = text.match(/\b(?:SRM|BYL|PER)\s*\d+(?:\.\d+)?\b/i);
  return match?.[0]?.toUpperCase();
}


async function embedTexts(input: string[]): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing from backend/.env");
  }

  const embeddings: number[][] = [];

  for (const text of input) {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text }] },
        }),
        signal: AbortSignal.timeout(120_000),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Gemini embedding error (${response.status}): ${await response.text()}`
      );
    }

    const data = (await response.json()) as {
      embedding?: { values?: number[] };
    };

    const vector = data.embedding?.values;

    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("Gemini returned no embedding.");
    }

    embeddings.push(vector);
  }

  return embeddings;
}


async function main() {
  const files = (await fs.readdir(pdfDir))
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  if (!files.length) throw new Error(`No PDF files found in ${pdfDir}`);

  const rawChunks: Omit<Chunk, "embedding">[] = [];

  for (const file of files) {
    const bytes = new Uint8Array(await fs.readFile(path.join(pdfDir, file)));
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    console.log(`Reading ${file} (${pdf.numPages} pages)`);

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .join(" ");

      for (const [i, piece] of chunkPage(text).entries()) {
        rawChunks.push({
          id: `${file}:p${pageNumber}:c${i + 1}`,
          text: piece,
          document: file,
          page: pageNumber,
          section: findSection(piece),
        });
      }
    }
  }

  if (!rawChunks.length) {
    throw new Error("No text extracted from the PDFs.");
  }

  const embedded: Chunk[] = [];
  const batchSize = 16;

  for (let i = 0; i < rawChunks.length; i += batchSize) {
    const batch = rawChunks.slice(i, i + batchSize);
    const vectors = await embedTexts(batch.map((item) => item.text));

    for (let j = 0; j < batch.length; j++) {
      embedded.push({ ...batch[j], embedding: vectors[j] });
    }

    console.log(`Embedded ${embedded.length}/${rawChunks.length} chunks`);
  }

  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(embedded), "utf8");
  console.log(`Saved ${embedded.length} chunks to ${indexPath}`);
}

main().catch((error) => {
  console.error("Ingestion failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
