
import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { answerQuestion, loadIndex, retrieve } from "./rag.js";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  })
);
app.use(express.json({ limit: "20kb" }));

const requestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, "Please enter a longer question.")
    .max(1000, "Question must be 1000 characters or fewer."),
});

app.get("/api/health", async (_req, res) => {
  try {
    const chunks = await loadIndex();
    res.json({ status: "ok", indexedChunks: chunks.length });
  } catch {
    res.status(503).json({
      status: "not_ready",
      message: "Document index not found. Run npm run ingest.",
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || "Invalid request.",
    });
  }

  try {
    const chunks = await loadIndex();
    const retrieved = await retrieve(parsed.data.question, chunks);
    const result = await answerQuestion(parsed.data.question, retrieved);
    return res.json(result);
  } catch (error) {
    console.error("/api/chat failed:", error);

    const message =
      error instanceof Error ? error.message : "Unexpected server error.";

    if (/ollama|ECONNREFUSED|fetch failed|model/i.test(message)) {
      return res.status(503).json({
        error:
          "Could not connect to the local AI service. Make sure Ollama is running and the required models are installed.",
      });
    }

    if (/index is missing|index\.json/i.test(message)) {
      return res.status(503).json({
        error: "Document index is not ready. Run npm run ingest in the backend folder.",
      });
    }

    return res.status(502).json({
      error: "The assistant could not complete the request. Please try again.",
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found." });
});


app.listen(port, "0.0.0.0", () => {
  console.log(`CedarAssist API listening on port ${port}`);
});

