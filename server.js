const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3001;

// Simple JSON file database
const DB_FILE = "/tmp/bloodrx.json";
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } 
  catch { return { patients: [] }; }
}
function saveDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } 
  catch(e) { console.log("DB save error:", e.message); }
}

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/analyze", async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8096,
system: "You are a clinical analysis assistant. Return ONLY a valid JSON object. Be concise — keep findings to the 10 most important markers only, antibiotics to maximum 3 recommendations, and keep all text fields under 200 characters each. Never truncate the JSON — always close all brackets properly.",
messages: req.body.messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "Anthropic API error" });
    }

    const text = data.content.map(b => b.text || "").join("");

    try {
      const clean = text.replace(/```json|```/g, "").trim();
      const result = JSON.parse(clean);

      const promptText = req.body.messages
        .map(m => typeof m.content === "string" ? m.content : 
          Array.isArray(m.content) ? m.content.filter(p => p.type === "text").map(p => p.text).join(" ") : "")
        .join(" ");

      const nameMatch      = promptText.match(/Name:\s*(.+)/);
      const phoneMatch     = promptText.match(/Phone:\s*(.+)/);
      const ageMatch       = promptText.match(/Age:\s*(.+)/);
      const genderMatch    = promptText.match(/Gender:\s*(.+)/);
      const complaintMatch = promptText.match(/Chief complaint:\s*(.+)/);
      const notesMatch     = promptText.match(/Clinical notes[^:]*:\s*(.+)/);

      const record = {
        id:        Date.now(),
        name:      nameMatch?.[1]?.trim()      || "Unknown",
        phone:     phoneMatch?.[1]?.trim()     || "",
        age:       ageMatch?.[1]?.trim()       || "",
        gender:    genderMatch?.[1]?.trim()    || "",
        complaint: complaintMatch?.[1]?.trim() || "",
        notes:     notesMatch?.[1]?.trim()     || "",
        severity:  result.severity             || "",
        summary:   result.summary              || "",
        created_at: new Date().toISOString()
      };

      const dbData = loadDB();
      dbData.patients.push(record);
      saveDB(dbData);
    } catch (e) {
      console.log("Could not save to DB:", e.message);
    }

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

app.get("/admin", (req, res) => {
  const dbData = loadDB();
  const patients = [...dbData.patients].reverse();

  const rows = patients.map(p => `
    <tr>
      <td>${p.id}</td>
      <td>${p.name || ""}</td>
      <td>${p.phone || ""}</td>
      <td>${p.age || ""}</td>
      <td>${p.gender || ""}</td>
      <td>${p.complaint || ""}</td>
      <td><span class="sev sev-${p.severity}">${p.severity || ""}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.summary || ""}</td>
      <td>${new Date(p.created_at).toLocaleString()}</td>
    </tr>
  `).join("");

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>BloodRx Admin</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, sans-serif; padding: 2rem; background: #f4f5f7; }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
        .count { font-size: 13px; color: #666; margin-bottom: 1.5rem; margin-top: 4px; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 10px; }
        .btn { padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 13px; text-decoration: none; }
        .table-wrap { overflow-x: auto; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
        table { width: 100%; border-collapse: collapse; background: white; min-width: 900px; }
        th { background: #2563eb; color: white; padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
        td { padding: 11px 16px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: #f8faff; }
        .sev { padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .sev-mild { background: #ecfdf5; color: #059669; }
        .sev-moderate { background: #fffbeb; color: #b45309; }
        .sev-severe, .sev-critical { background: #fef2f2; color: #dc2626; }
        .empty { text-align: center; color: #999; padding: 3rem; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1>🧬 BloodRx Patient Records</h1>
          <p class="count">${patients.length} total record${patients.length !== 1 ? "s" : ""}</p>
        </div>
        <a href="/" class="btn">← Back to analyzer</a>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Name</th><th>Phone</th><th>Age</th><th>Gender</th>
              <th>Complaint</th><th>Severity</th><th>Summary</th><th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="9" class="empty">No records yet</td></tr>'}
          </tbody>
        </table>
      </div>
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
