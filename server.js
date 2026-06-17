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
    const anthropicMessages = req.body.messages || [];
    let promptText = "";

    for (const msg of anthropicMessages) {
      if (typeof msg.content === "string") {
        promptText += msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            promptText += "\n" + part.text;
          } else if (part.type === "document" && part.source?.data) {
            promptText += "\n[A blood report PDF has been uploaded. Please analyze it based on the patient information provided and generate the required JSON response.]";
          }
        }
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
        messages: [{ role: "user", content: promptText }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "OpenAI error" });
    }

    const text = data.choices?.[0]?.message?.content || "";
    res.json({ content: [{ type: "text", text }] });

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
