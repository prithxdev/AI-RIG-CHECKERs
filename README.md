# Rig Check ⚡

A hardware-aware open-source AI model advisor. Rig Check inspects a visitor's CPU, RAM, and GPU capabilities (honestly and safely), maps them to hardware capacity tiers, and recommends the best open-source models for **writing**, **thinking/reasoning**, **coding**, and **project management**.

Includes an interactive **"Try it Live"** feature to test recommended models via Ollama Cloud or local Ollama without installing heavy weights.

---

## Architecture & Honesty Layers

Browsers enforce strict privacy sandboxes: no website can read CPU cache, exact RAM frequencies (DDR4 vs DDR5 vs LPDDR5 Unified), or GPU VRAM. Rather than guessing falsely, Rig Check uses two complementary layers:

| Layer | What It Reads | Mechanism |
|---|---|---|
| **Quick Scan** (Instant, in-browser) | Core count, approximate RAM (capped at 8GB by browsers), WebGL GPU name | `navigator.hardwareConcurrency`, `navigator.deviceMemory`, WebGL unmasked renderer |
| **Deep Scan** (Local helper, exact) | Exact CPU model & clock, RAM total + module types/speeds, GPU + VRAM / Unified Memory, disk storage | `deep_scan.py` run locally, communicates only with the current tab over `http://127.0.0.1:8765/scan` |

Recommendations are curated from `models.json` across **Light**, **Mid**, and **High** tiers.

---

## Quick Start (Run Locally)

### 1. Install & Run Backend Server

```bash
# 1. Install dependencies
npm install

# 2. Start the web server (Port 3000)
npm start
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 2. Run Deep Scan Helper (Optional, for exact hardware specs)

In a second terminal window (or run `npm run scan`):

```bash
python3 deep_scan.py
```

Leave the terminal open and click **"Connect Deep Scan"** on the website. It reads your machine's exact hardware specs and recalibrates model recommendations instantly.

---

## Ollama Cloud & Local Model Execution

The backend (`server.js`) acts as a secure reverse proxy:
- **Ollama Cloud**: To run live model generations with Ollama Cloud, obtain a key from [https://ollama.com/settings/keys](https://ollama.com/settings/keys) and paste it into `.env`:
  ```env
  OLLAMA_API_KEY=your_key_here
  ```
- **Local Ollama**: If you have Ollama installed locally (`http://127.0.0.1:11434`), Rig Check automatically detects it and routes model executions locally!
- **Interactive Demo Mode**: If neither is active, Rig Check provides an interactive simulation mode so the full frontend-to-backend interface can be evaluated and tested out-of-the-box.

---

## Project Structure

```
├── index.html       # Modern, responsive frontend with hardware telemetry
├── styles.css       # Dark cyber aesthetic with glassmorphism & fluid typography
├── app.js           # Client-side hardware scanner, category filters & modal controller
├── models.json      # Curated dataset of models, tiers, and categories
├── server.js        # Express server: static assets, deep scan download & Ollama proxy
├── deep_scan.py     # Local hardware detection helper (standard library only)
├── package.json     # Node scripts & dependencies
└── .env             # Environment configuration (API key and port)
```
