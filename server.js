/* =====================================================================
   server.js — Rig Check backend
   ---------------------------------------------------------------------
   Core Responsibilities:
     1. Serve the static frontend (index.html, styles.css, app.js, models.json).
     2. Provide the downloadable deep_scan.py helper script.
     3. Proxy POST /api/chat to Ollama Cloud (or local Ollama, with demo fallback)
        keeping the API key safely server-side.
     4. Health & status API at GET /api/status.
   ===================================================================== */

const fs = require("fs");
const path = require("path");
const express = require("express");
require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT, 10) || 3000;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY ? process.env.OLLAMA_API_KEY.trim() : "";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "https://ollama.com";

// Resolve static directory properly whether files are flat or in public/
const candidateDirs = [
  path.join(__dirname, "public"),
  path.join(__dirname, "..", "public"),
  __dirname
];

const staticDir = candidateDirs.find(dir => fs.existsSync(path.join(dir, "index.html"))) || __dirname;
console.log(`Serving static files from: ${staticDir}`);
app.use(express.static(staticDir));

// Route to download deep_scan.py reliably
app.get("/deep_scan.py", (req, res) => {
  const candidateFiles = [
    path.join(__dirname, "deep_scan.py"),
    path.join(__dirname, "public", "deep_scan.py"),
    path.join(__dirname, "..", "deep-scan", "deep_scan.py")
  ];
  const found = candidateFiles.find(f => fs.existsSync(f));
  if (found) {
    res.download(found, "deep_scan.py");
  } else {
    res.status(404).send("deep_scan.py not found");
  }
});

// Allow-list of supported models from models.json
const ALLOWED_MODELS = new Set([
  "llama3.1:8b",
  "qwen2.5:14b",
  "qwen2.5:32b",
  "deepseek-r1:8b",
  "deepseek-r1:14b",
  "qwq:32b",
  "qwen2.5-coder:7b",
  "qwen2.5-coder:14b",
  "qwen2.5-coder:32b",
  "mistral-small:22b",
]);

// Helper to check if local Ollama is active
async function checkLocalOllama() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (e) {
    return false;
  }
}

// Server health and configuration status
app.get("/api/status", async (req, res) => {
  const hasApiKey = Boolean(OLLAMA_API_KEY && OLLAMA_API_KEY !== "your-key-here");
  const localOllama = await checkLocalOllama();

  let mode = "demo";
  if (hasApiKey) mode = "cloud";
  else if (localOllama) mode = "local";

  res.json({
    status: "online",
    port: PORT,
    hasApiKey,
    localOllama,
    mode,
    timestamp: new Date().toISOString()
  });
});

// Chat completion endpoint
app.post("/api/chat", async (req, res) => {
  const { model, prompt } = req.body || {};

  if (typeof model !== "string" || !ALLOWED_MODELS.has(model)) {
    return res.status(400).json({ error: `Disallowed or unknown model: "${model}".` });
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Missing prompt." });
  }
  if (prompt.length > 2000) {
    return res.status(400).json({ error: "Prompt exceeds 2000 character limit." });
  }

  const hasApiKey = Boolean(OLLAMA_API_KEY && OLLAMA_API_KEY !== "your-key-here");

  // 1. Try Ollama Cloud if API key is provided
  if (hasApiKey) {
    try {
      const upstream = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OLLAMA_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      });

      if (!upstream.ok) {
        const text = await upstream.text();
        return res.status(upstream.status).json({ error: text || "Ollama Cloud request failed." });
      }

      const data = await upstream.json();
      const reply = data?.message?.content ?? "(empty response)";
      return res.json({ reply, provider: "Ollama Cloud", model });
    } catch (err) {
      return res.status(502).json({ error: "Could not reach Ollama Cloud: " + err.message });
    }
  }

  // 2. Try local Ollama if available
  const localActive = await checkLocalOllama();
  if (localActive) {
    try {
      const localRes = await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      });

      if (localRes.ok) {
        const data = await localRes.json();
        const reply = data?.message?.content ?? "(empty response)";
        return res.json({ reply, provider: "Local Ollama", model });
      }
    } catch (err) {
      console.warn("Local Ollama request error:", err.message);
    }
  }

  // 3. Simulated Demo Response (Frontend-to-backend fully verified)
  const simulatedResponses = {
    "llama3.1:8b": `[Llama 3.1 8B Response]\n\nBased on your prompt: "${prompt}"\n\nLlama 3.1 8B is Meta's lightweight powerhouse, optimized for fast and nuanced general writing, creative brainstorming, and structured summaries. On your hardware, it runs with high token throughput and minimal latency.`,
    "qwen2.5:14b": `[Qwen 2.5 14B Response]\n\nRegarding: "${prompt}"\n\nQwen 2.5 14B delivers near-GPT-4 level general prose and multi-lingual comprehension. It balances memory efficiency with rich contextual vocabulary.`,
    "deepseek-r1:8b": `[DeepSeek-R1 8B Distilled Reasoning]\n\n<thought>\nAnalyzing user question: "${prompt}"\nStep 1: Parse requirements and verify logic.\nStep 2: Formulate direct, deductive answer.\n</thought>\n\nDeepSeek-R1 distilled excels at complex chain-of-thought, mathematical problem-solving, and strict logical deductions.`,
    "deepseek-r1:14b": `[DeepSeek-R1 14B Distilled Reasoning]\n\n<thought>\nEvaluating problem constraints for "${prompt}"\nStructuring multi-tier deductive response.\n</thought>\n\nDeepSeek-R1 14B provides deep step-by-step reasoning for competitive programming, logic puzzles, and architectural planning.`,
    "qwen2.5-coder:7b": `[Qwen 2.5-Coder 7B]\n\n\`\`\`javascript\n// Quick implementation for: ${prompt}\nfunction solution() {\n  console.log("Optimized code output ready");\n  return true;\n}\n\`\`\`\n\nQwen 2.5-Coder is specialized for instant completions, bug hunting, and refactoring.`,
    "qwen2.5-coder:14b": `[Qwen 2.5-Coder 14B]\n\n\`\`\`python\n# Solution for: ${prompt}\ndef execute_task():\n    # Highly reliable code generation across 92 languages\n    return "Ready for production"\n\`\`\`\n\n14B parameter density gives superior syntax compliance and test generation capability.`,
    "mistral-small:22b": `[Mistral Small 22B]\n\nProject Planning Overview:\nTarget: "${prompt}"\n\n1. Scope & Deliverables definition\n2. Resource allocation & Timeline milestones\n3. Risk mitigation & QA criteria\n\nMistral Small 22B excels at synthesizing documents, Jira tickets, and cross-functional specs.`
  };

  const defaultReply = `[${model} Response]\n\nReceived query: "${prompt}"\n\n✓ The Rig Check pipeline is functioning perfectly!\nTo stream live weights from the real model, set your OLLAMA_API_KEY in .env or run Ollama locally ('ollama run ${model}').`;

  const reply = simulatedResponses[model] || defaultReply;

  return res.json({
    reply,
    provider: "Interactive Preview Mode",
    model,
    demoMode: true,
    notice: "To run live model weights via Ollama Cloud, paste your API key in .env and restart."
  });
});

const server = app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Rig Check server running on: http://localhost:${PORT}`);
  console.log(`📁 Static files served from:    ${staticDir}`);
  console.log(`🔑 Ollama Cloud Key:            ${OLLAMA_API_KEY ? "CONFIGURED (Live)" : "NOT SET (Interactive Demo Mode)"}`);
  console.log(`======================================================\n`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is currently in use. Please terminate the process using it or change PORT in .env.`);
  } else {
    console.error("Server error:", err);
  }
});
