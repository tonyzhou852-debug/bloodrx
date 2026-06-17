const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/analyze", async (req, res) => {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "Server is missing OPENAI_API_KEY." });
  }

  try {
    // Convert Anthropic-style messages to OpenAI format
    const anthropicMessages = req.body.messages || [];
    const openaiMessages = [];

    for (const msg of anthropicMessages) {
      if (typeof msg.content === "string") {
        openaiMessages.push({ role: msg.role, content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const parts = [];
        for (const part of msg.content) {
          if (part.type === "text") {
            parts.push({ type: "text", text: part.text });
          } else if (part.type === "image" && part.source?.data) {
            parts.push({
              type: "image_url",
              image_url: {
                url: `data:${part.source.media_type};base64,${part.source.data}`
              }
            });
          } else if (part.type === "document" && part.source?.data) {
            // OpenAI doesn't support PDFs directly — send as file
            parts.push({
              type: "text",
              text: "[PDF document attached — please analyze the blood report data contained in it]"
            });
            // Also send as image_url using base64
            parts.push({
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${part.source.data}`
              }
            });
          }
        }
        openaiMessages.push({ role: msg.role, content: parts });
      }
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 2000,
        messages: openaiMessages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "OpenAI API error" });
    }

    const content = data.choices?.[0]?.message?.content || "";
    res.json({ content: [{ type: "text", text: content }] });

  } catch (err) {
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`BloodRx server running at http://localhost:${PORT}`);
});
