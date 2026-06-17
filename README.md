# BloodRx Backend Server

A simple proxy server that keeps your Anthropic API key secret.

## Setup (5 minutes)

### Step 1 — Install Node.js
Download from https://nodejs.org (choose LTS version)

### Step 2 — Set up the server
```bash
cd bloodrx-server
npm install
cp .env.example .env
```

### Step 3 — Add your API key
Open the `.env` file and replace the placeholder:
```
ANTHROPIC_API_KEY=sk-ant-api03-your-real-key-here
```

### Step 4 — Put your HTML file in the public folder
Copy `bloodrx-multilingual.html` into the `public/` folder
and rename it to `index.html`

### Step 5 — Start the server
```bash
npm start
```

Open http://localhost:3001 — the site works, no API key needed in the browser.

## Deploy online (free)

### Option A — Render.com (easiest, free)
1. Push this folder to a GitHub repo
2. Go to render.com → New Web Service → connect your repo
3. Set environment variable: ANTHROPIC_API_KEY = your key
4. Deploy — you get a public URL like https://bloodrx.onrender.com

### Option B — Railway.app (also free)
1. Go to railway.app → New Project → Deploy from GitHub
2. Add environment variable: ANTHROPIC_API_KEY
3. Deploy

### Option C — Your own VPS (DigitalOcean, Linode, etc.)
```bash
npm install -g pm2
pm2 start server.js
pm2 save
```
Use nginx as a reverse proxy on port 80/443.
