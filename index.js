const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const pdfParse = require("pdf-parse");
dotenv.config();

const app = express();
app.use(express.json({ limit: "50mb" }));

// --- CORS setup ---
const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(cors({ origin: allowedOrigin }));

// --- Port setup for local + Render ---
const port = process.env.PORT || 4000;

// --- API key setup ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (!GOOGLE_API_KEY) {
  console.warn("⚠️  Missing GOOGLE_API_KEY or GEMINI_API_KEY in environment.");
}

// --- Model to use ---
const GEMINI_MODEL = "gemini-2.5-flash";

// --- Prompt template ---
const aiPrompt = `
You are an AI health assistant. Write **short, clear, professional** output.

RULES
- Keep total length **under ~180–220 words**.
- Use **ONLY** the sections and bullets shown in the TEMPLATE.
- No extra preface, no patient names, no legal/financial advice.
- If a value isn't present in the text, write **"Not found"**.
- Use simple language.

TEMPLATE (Markdown)
### English (3–5 bullets)
- Key findings: [1 short line]
- Abnormal values: [comma-separated; e.g., WBC high] or "Not found"
- What it means (layman): [1 short line]
- Food/lifestyle (2 items): [very short]
- Questions for doctor (2–3): [very short]

### Roman Urdu (3–5 lines)
- Bunyadi nuktay: [1 short line]
- Ghair mamooli qeematain: [comma-separated] ya "Not found"
- Aam alfaaz mein matlab: [1 short line]
- Ghiza/rozmarra (2 items): [bohat mukhtasar]
- Doctor se sawalat (2–3): [bohat mukhtasar]

### Disclaimer
Always consult your doctor… / Roman Urdu version.
`.trim();

// --- Gemini API call ---
async function callGemini(fullPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
    GOOGLE_API_KEY
  )}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: fullPrompt }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 400, 
      temperature: 0.3, 
      topP: 0.8,
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Gemini API error (${resp.status} ${resp.statusText}): ${text}`
    );
  }

  const json = await resp.json();
  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("\n")
      .trim() || "";

  if (!text) throw new Error("Empty response from model.");
  return text;
}

app.post("/api/summarize", async (req, res) => {
  console.log("📥 Received request to /api/summarize");
  try {
    const { fileData, fileType } = req.body;

    if (!fileData || fileType !== "application/pdf") {
      return res.status(400).json({ error: "Please upload a valid PDF file." });
    }
    if (!GOOGLE_API_KEY) {
      return res
        .status(500)
        .json({ error: "Missing GOOGLE_API_KEY in server." });
    }

    const fileBuffer = Buffer.from(fileData, "base64");
    const parsed = await pdfParse(fileBuffer);
    const pdfText = parsed.text?.trim();

    if (!pdfText) {
      return res.status(400).json({
        error:
          "Could not extract text from PDF. It may be a scanned image (try OCR).",
      });
    }

    const fullPrompt = `${aiPrompt}\n\n--- REPORT START ---\n${pdfText}\n--- REPORT END ---`;

    const summary = await callGemini(fullPrompt);

    res.json({ summary });
  } catch (error) {
    console.error("❌ Error in /api/summarize:", error);
    const message =
      typeof error?.message === "string"
        ? error.message
        : "Failed to generate summary.";
    res.status(500).json({ error: message });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(port, () => {
  console.log(`✅ Backend running on port ${port}`);
});
