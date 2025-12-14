import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

dotenv.config(); // VERY IMPORTANT

const app = express();
app.use(cors());
app.use(express.json());

// ENV VARIABLES CHECK
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error("❌ Supabase credentials missing in .env");
  process.exit(1);
}

// SUPABASE CLIENT
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// TEST ROUTE
app.get("/", (req, res) => {
  res.send("✅ AI Chatbot Backend Running");
});

// ADD KNOWLEDGE
app.post("/add", async (req, res) => {
  const { content, source } = req.body;

  if (!content || !source) {
    return res.status(400).json({ error: "Missing content or source" });
  }

  const { error } = await supabase
    .from("knowledge_base")
    .insert([{ content, source }]);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true });
});

// ASK QUESTION
app.post("/ask", async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "No question provided" });

  // Fetch knowledge from Supabase
  const { data } = await supabase.from("knowledge_base").select("*");

  const context = data?.map(d => d.content).join("\n") || "";

  const prompt = `
You are an AI assistant for Material & Metallurgical Engineering.
Answer clearly and academically.

Context:
${context}

Question:
${question}
`;

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
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
