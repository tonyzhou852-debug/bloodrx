const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const os = require("os");

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
    let fileId = null;

    // Extract text prompt and PDF data
    for (const msg of anthropicMessages) {
      if (typeof msg.content === "string") {
        promptText += msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            promptText += part.text;
          } else if (part.type === "document" && part.source?.data) {
            // Upload PDF to OpenAI Files API
            const pdfBuffer = Buffer.from(part.source.data, "base64");
            const tmpPath = path.join(os.tmpdir(), `report-${Date.now()}.pdf`);
            fs.writeFileSync(tmpPath, pdfBuffer);

            const formData = new FormData();
            const blob = new Blob([fs.readFileSync(tmpPath)], { type: "application/pdf" });
            formData.append("file", blob, "report.pdf");
            formData.append("purpose", "assistants");

            const uploadResp = await fetch("https://api.openai.com/v1/files", {
              method: "POST",
              headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
              body: formData,
            });
            const uploadData = await uploadResp.json();
            fs.unlinkSync(tmpPath);

            if (!uploadResp.ok) {
              return res.status(400).json({ error: "File upload failed: " +
