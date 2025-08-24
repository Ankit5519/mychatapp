import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const app = express();
app.use(cors());
app.use(express.json());

// serve the static page
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(join(__dirname, "public")));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ======== SIMPLE IN-MEMORY PASSES (resets on deploy/restart) ========
const passes = new Map(); 
// code -> { messagesLeft: number, expiresAt: number, model: "gpt-4o-mini"|"gpt-4o" }

function makeCode(len = 6) {
  return Math.random().toString(36).slice(2, 2+len).toUpperCase();
}

// Admin route: mint a pass (call this yourself after someone pays)
// Example: /admin/make-pass?msgs=10&mins=60&tier=mini
app.get("/admin/make-pass", (req, res) => {
  const msgs = Math.max(1, parseInt(req.query.msgs || "10", 10));
  const mins = Math.max(1, parseInt(req.query.mins || "60", 10));
  const tier = (req.query.tier || "mini").toLowerCase(); // "mini" or "pro"

  const code = makeCode();
  const model = tier === "pro" ? "gpt-4o" : "gpt-4o-mini";
  passes.set(code, { messagesLeft: msgs, expiresAt: Date.now() + mins*60*1000, model });
  res.json({ ok:true, code, messagesLeft: msgs, expiresInMinutes: mins, model });
});

// Redeem route: user enters code, we validate & return a token (use code itself as token)
app.post("/api/redeem", (req, res) => {
  const { code } = req.body || {};
  const pass = passes.get((code || "").toUpperCase());
  if (!pass) return res.status(400).json({ ok:false, error:"Invalid code." });
  if (Date.now() > pass.expiresAt) return res.status(400).json({ ok:false, error:"Code expired." });
  if (pass.messagesLeft <= 0) return res.status(400).json({ ok:false, error:"No messages left." });
  // we use the code itself as the "token" for simplicity
  res.json({ ok:true, token: code.toUpperCase(), messagesLeft: pass.messagesLeft, model: pass.model });
});

// Chat route: requires a valid token (code). Decrements messagesLeft by 1 each call.
app.post("/api/chat", async (req, res) => {
  try {
    const { token, messages = [] } = req.body || {};
    const pass = passes.get((token || "").toUpperCase());
    if (!pass) return res.status(403).json({ ok:false, error:"Redeem a valid code first." });
    if (Date.now() > pass.expiresAt) return res.status(403).json({ ok:false, error:"Pass expired." });
    if (pass.messagesLeft <= 0) return res.status(403).json({ ok:false, error:"No messages left." });

    // call OpenAI Chat Completions
    const chatMessages = [
      { role: "system", content: "You are a helpful, concise assistant." },
      ...messages
    ];
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: pass.model,            // "gpt-4o-mini" (₹10) or "gpt-4o" (₹29)
        messages: chatMessages,
        temperature: 0.3,
        // Safety: cap tokens so costs can’t explode
        max_tokens: 700               // ~ around 500–700 words
      })
    });

    const status = r.status;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("OpenAI error", { status, data });
      const msg = data?.error?.message || `OpenAI error (status ${status})`;
      return res.status(500).json({ ok:false, error: msg });
    }

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.error("No content in OpenAI response", data);
      return res.status(500).json({ ok:false, error:"Empty response from model." });
    }

    // decrement *after* successful call
    pass.messagesLeft -= 1;
    passes.set(token.toUpperCase(), pass);

    res.json({ ok:true, reply: text, messagesLeft: pass.messagesLeft });
  } catch (e) {
    console.error("Server exception", e);
    res.status(500).json({ ok:false, error:"Server error. Check logs." });
  }
});

app.get("/health", (req, res) => res.json({ ok:true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on ${PORT}`));
