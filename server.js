import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import multer from "multer";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   ENV CHECK
========================= */
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error("❌ Supabase credentials missing");
  process.exit(1);
}

/* =========================
   SUPABASE CLIENT
========================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/* =========================
   FILE UPLOAD SETUP
========================= */
const upload = multer({ dest: "uploads/" });

/* =========================
   TEST ROUTE
========================= */
app.get("/", (req, res) => {
  res.send("✅ AI Chatbot Backend Running");
});

/* =========================
   ADD MANUAL KNOWLEDGE
========================= */
app.post("/add", async (req, res) => {
  const { content, source } = req.body;

  if (!content || !source) {
    return res.status(400).json({ error: "Missing content or source" });
  }

  const { error } = await supabase.from("knowledge_base").insert([
    {
      content,
      source
    }
  ]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true });
});

/* =========================
   UPLOAD PDF / DOCX
========================= */
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let extractedText = "";

    if (ext === ".pdf") {
      const data = await pdfParse(fs.readFileSync(filePath));
      extractedText = data.text;
    } else if (ext === ".docx") {
      const data = await mammoth.extractRawText({ path: filePath });
      extractedText = data.value;
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: "Unsupported file type" });
    }

    if (!extractedText.trim()) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: "No text extracted from file" });
    }

    const { error } = await supabase.from("knowledge_base").insert([
      {
        content: extractedText,
        source: req.file.originalname
      }
    ]);

    fs.unlinkSync(filePath);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, message: "File uploaded and indexed" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "File upload failed" });
  }
});

/* =========================
   ASK QUESTION (GEMINI)
========================= */
app.post("/ask", async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: "No question provided" });
  }

  const { data } = await supabase.from("knowledge_base").select("content");

  const context = data?.map(d => d.content).join("\n\n") || "";

  const prompt = `
You are an AI assistant for Material and Metallurgical Engineering.
Answer clearly, academically, and concisely.

Context:
${context}

Question:
${question}
`;

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
        process.env.GOOGLE_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const result = await response.json();

    const answer =
      result.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No answer generated.";

    res.json({ answer });

  } catch (err) {
    res.status(500).json({ error: "AI request failed" });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
