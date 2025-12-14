import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import multer from "multer";
import mammoth from "mammoth";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";

dotenv.config();

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");  // ✅ Correct for ESM
const Tesseract = require("tesseract.js"); // OCR


const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   ENV CHECK
========================= */
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY || !process.env.GOOGLE_API_KEY) {
  console.error("❌ Supabase or Google API credentials missing");
  process.exit(1);
}

/* =========================
   SUPABASE CLIENT
========================= */
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

/* =========================
   FILE UPLOAD SETUP
========================= */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

/* =========================
   TEST ROUTE
========================= */
app.get("/", (req, res) => res.send("✅ AI Chatbot Backend Running"));

/* =========================
   ADD MANUAL KNOWLEDGE
========================= */
app.post("/add", async (req, res) => {
  const { content, source } = req.body;
  if (!content || !source) return res.status(400).json({ error: "Missing content or source" });

  try {
    const { error } = await supabase.from("knowledge_base").insert([{ content, source }]);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error("ADD ERROR:", err);
    res.status(500).json({ error: err.message || "Failed to add knowledge" });
  }
});

/* =========================
   UPLOAD PDF / DOCX WITH OCR
========================= */
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: "No file received or empty file" });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let extractedText = "";

    if (ext === ".docx") {
      const data = await mammoth.extractRawText({ buffer: req.file.buffer });
      extractedText = data.value.trim();
      if (!extractedText) return res.status(400).json({ error: "DOCX contains no readable text" });
    } else if (ext === ".pdf") {
      const data = await pdfParse(req.file.buffer);
      extractedText = data.text.trim();

      // Use OCR if PDF has no text
      if (!extractedText) {
        const ocrResult = await Tesseract.recognize(req.file.buffer, "eng", { logger: m => console.log(m) });
        extractedText = ocrResult.data.text.trim();
      }

      if (!extractedText) return res.status(400).json({ error: "PDF contains no readable text even after OCR" });
    } else {
      return res.status(400).json({ error: "Unsupported file type" });
    }

    // Insert into Supabase
    const { error } = await supabase.from("knowledge_base").insert([
      { content: extractedText, source: req.file.originalname }
    ]);
    if (error) throw error;

    res.json({ success: true, message: "File uploaded and indexed successfully" });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message || "File processing failed" });
  }
});

/* =========================
   ASK QUESTION
========================= */
app.post("/ask", async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "No question provided" });

  try {
    const { data, error } = await supabase.from("knowledge_base").select("content");
    if (error) throw error;

    const context = data?.map(d => d.content).filter(Boolean).join("\n\n") || "";

    const prompt = `
You are an AI assistant for Material and Metallurgical Engineering.
Answer clearly, academically, and concisely.

Context:
${context}

Question:
${question}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    const result = await response.json();
    const answer = result.candidates?.[0]?.content?.parts?.[0]?.text || "No answer generated.";
    res.json({ answer });
  } catch (err) {
    console.error("ASK ERROR:", err);
    res.status(500).json({ error: "AI request failed" });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
