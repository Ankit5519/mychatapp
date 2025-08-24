import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// serve the frontend (public/index.html) at /
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(join(__dirname, "public")));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// simple chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { messages = [] } = req.body || {};
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: "You are a friendly, concise assistant." },
          ...messages
        ],
        temperature: 0.3
      })
    });
    const data = await r.json();
    const text = data?.output?.[0]?.content?.[0]?.text ?? "Sorry, I couldn't respond.";
    res.json({ ok: true, reply: text });
  } catch (e) {
    res.status(500).json({ ok:false, error:"Server error" });
  }
});

app.listen(3000, () => console.log("Server running on 3000"));
