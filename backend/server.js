const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const { scriptedEvents } = require("./webhook-events");
const { normalizeEvent, toLegacySsePayload } = require("./services/eventNormalizer");

dotenv.config();
connectDB();

const app = express();
const PORT = process.env.PORT || 3001;

// Open CORS
app.use(cors({ origin: "*" }));

app.use(express.json());

// --- API Routes ---
app.use("/api/auth", authRoutes);
const analyzeRoutes = require("./routes/analyzeRoutes");
app.use("/api/analyze", analyzeRoutes);


// --- SSE client registry ---
let clients = [];

// --- Demo timer handles ---
let demoTimers = [];
let demoStarted = false;

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  clients = clients.filter((res) => {
    try { res.write(payload); return true; }
    catch (_) { return false; } // drop dead connections
  });
  console.log(`[broadcast] ${event.type} → ${event.data?.shipment_id || ""} (${clients.length} clients)`);
}

// --- SSE endpoint ---
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable Nginx/Render proxy buffering
  res.flushHeaders();

  // Confirm connection immediately
  res.write(`data: ${JSON.stringify({ type: "connected", message: "SSE live" })}\n\n`);

  clients.push(res);
  console.log(`[SSE] client connected — total: ${clients.length}`);

  // Heartbeat every 25s — keeps Render + browser connection alive
  const heartbeat = setInterval(() => {
    try { res.write(": ping\n\n"); } catch (_) { clearInterval(heartbeat); }
  }, 25000);

  // Start demo on first ever connection
  if (!demoStarted) {
    demoStarted = true;
    startDemoScript();
  }

  req.on("close", () => {
    clearInterval(heartbeat);
    clients = clients.filter((c) => c !== res);
    console.log(`[SSE] client disconnected — total: ${clients.length}`);
  });
});

// --- Manual webhook endpoint ---
app.post("/webhook", (req, res) => {
  try {
    const rawEvent = req.body;
    // ensure message default exists before normalization
    if (!rawEvent.message) rawEvent.message = "Manual delay reported via webhook";
    
    const normalized = normalizeEvent(rawEvent, { source: "manual", provider: "webhook" });
    const legacyPayload = toLegacySsePayload(normalized);
    broadcast(legacyPayload);
    res.json({ status: "ok", eventId: normalized.eventId, validation: normalized.validation });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// --- Reset endpoint ---
app.post("/reset", (req, res) => {
  demoTimers.forEach((t) => clearTimeout(t));
  demoTimers = [];
  demoStarted = false;
  broadcast({ type: "reset", timestamp: new Date().toISOString() });
  demoStarted = true;
  startDemoScript();
  res.json({ status: "ok", message: "Demo reset and restarted" });
});

// --- Health check (Render uses this to detect the service is up) ---
app.get("/status", (req, res) => {
  res.json({
    status: "running",
    clients_connected: clients.length,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// Root ping so Render health check passes
app.get("/", (req, res) => res.send("BlameChain backend running"));

// --- Scripted demo ---
function startDemoScript() {
  console.log("\\n[demo] Scripted events armed. Starting in 1.5 seconds...\\n");
  scriptedEvents.forEach(({ delay_ms, event }) => {
    const t = setTimeout(() => {
      console.log(`[demo] Firing event at t=${delay_ms / 1000}s`);
      try {
        const normalized = normalizeEvent(event, { source: "scripted", provider: "simulator" });
        const legacyPayload = toLegacySsePayload(normalized);
        broadcast(legacyPayload);
      } catch (err) {
        console.error("[demo] Failed to normalize scripted event:", err.message);
      }
    }, delay_ms);
    demoTimers.push(t);
  });
}

app.listen(PORT, () => {
  console.log(`\n✓ BlameChain backend running on port ${PORT}`);
  console.log(`  SSE stream:   GET  /events`);
  console.log(`  Manual hook:  POST /webhook`);
  console.log(`  Reset demo:   POST /reset`);
  console.log(`  Health check: GET  /status\n`);
});
