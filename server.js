const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/analyze", async (req, res) => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "Server is missing GEMINI_API_KEY." });
  }

  try {
    const anthropicMessages = req.body.messages || [];
    const geminiParts = [];

    for (const msg of anthropicMessages) {
      if (typeof msg.content === "string") {
        geminiParts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            geminiParts.push({ text: part.text });
          } else if (part.type === "document" && part.source?.data) {
            geminiParts.push({
              inline_data: {
                mime_type: "application/pdf",
                data: part.source.data
              }
            });
          } else if (part.type === "image" && part.source?.data) {
            geminiParts.push({
              inline_data: {
                mime_type: part.source.media_type,
                data: part.source.data
              }
            });
          }
        }
      }
    }

    // Try multiple model names in order
    const models = [
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-pro"
    ];

    let lastError = null;
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: geminiParts }],
          generationConfig: { maxOutputTokens: 1000 }
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return res.json({ content: [{ type: "text", text }] });
      }

      console.error(`Model ${model} failed:`, data.error?.message);
      lastError = data.error?.message || `Error with ${model}`;

      if (response.status !== 404) {
        return res.status(response.status).json({ error: lastError });
      }
    }

    res.status(404).json({ error: `All models failed. Last error: ${lastError}` });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`BloodRx server running at http://localhost:${PORT}`);
});
