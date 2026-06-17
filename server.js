const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3001;

// Init database
const db = new Database("bloodrx.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    age TEXT,
    gender TEXT,
    complaint TEXT,
    notes TEXT,
    severity TEXT,
    summary TEXT,
    result TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

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
            promptText += "\n[A blood report PDF has been uploaded. Please analyze based on patient information and return the required JSON.]";
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

    // Try to parse and save to database
    try {
      const clean = text.replace(/```json|```/g, "").trim();
      const result = JSON.parse(clean);

      // Extract patient info from the prompt
      const nameMatch = promptText.match(/Name:\s*(.+)/);
      const ageMatch = promptText.match(/Age:\s*(.+)/);
      const genderMatch = promptText.match(/Gender:\s*(.+)/);
      const complaintMatch = promptText.match(/Chief complaint:\s*(.+)/);
      const notesMatch = promptText.match(/Clinical notes[^:]*:\s*(.+)/);

      db.prepare(`
        INSERT INTO patients (name, age, gender, complaint, notes, severity, summary, result)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nameMatch?.[1]?.trim() || "Unknown",
        ageMatch?.[1]?.trim() || "",
        genderMatch?.[1]?.trim() || "",
        complaintMatch?.[1]?.trim() || "",
        notesMatch?.[1]?.trim() || "",
        result.severity || "",
        result.summary || "",
        JSON.stringify(result)
      );
    } catch (e) {
      console.log("Could not save to DB:", e.message);
    }

    res.json({ content: [{ type: "text", text }] });

  } catch (err) {
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// Admin page — view all patients
app.get("/admin", (req, res) => {
  const patients = db.prepare("SELECT * FROM patients ORDER BY created_at DESC").all();
  
  const rows = patients.map(p => `
    <tr>
      <td>${p.id}</td>
      <td>${p.name}</td>
      <td>${p.age}</td>
      <td>${p.gender}</td>
      <td>${p.complaint}</td>
      <td><span class="sev sev-${p.severity}">${p.severity}</span></td>
      <td>${p.summary?.slice(0, 100)}...</td>
      <td>${p.created_at}</td>
    </tr>
  `).join("");

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>BloodRx Admin</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 2rem; background: #f5f5f5; }
        h1 { color: #1a1a2e; margin-bottom: 1.5rem; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
        th { background: #2563eb; color: white; padding: 12px 16px; text-align: left; font-size: 13px; }
        td { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: #f8faff; }
        .sev { padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .sev-mild { background: #ecfdf5; color: #059669; }
        .sev-moderate { background: #fffbeb; color: #b45309; }
        .sev-severe, .sev-critical { background: #fef2f2; color: #dc2626; }
        .count { font-size: 14px; color: #666; margin-bottom: 1rem; }
      </style>
    </head>
    <body>
      <h1>🧬 BloodRx — Patient Records</h1>
      <p class="count">${patients.length} total records</p>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Name</th><th>Age</th><th>Gender</th>
            <th>Complaint</th><th>Severity</th><th>Summary</th><th>Date</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#999;padding:2rem">No records yet</td></tr>'}</tbody>
      </table>
    </body>
    </html>
  `);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`BloodRx server running at http://localhost:${PORT}`);
});
