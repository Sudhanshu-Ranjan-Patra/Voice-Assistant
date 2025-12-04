import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import fetch from "node-fetch";
import { WebSocket, WebSocketServer } from "ws";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();
const app = express();
app.use(express.json());

app.use(cors({
  origin: "http://localhost:5173",
  methods: ["POST", "GET"]
}));

// Initialize Google Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// AI Chat Route
app.post("/api/chat", async (req, res) => {
  try {
    const { text } = req.body;
    console.log("Incoming /api/chat request:", (text || "").slice(0, 200));

    if (!text) return res.status(400).json({ message: "No text provided" });

      // Try Google Gemini as a fallback 
      if (process.env.GEMINI_API_KEY) {
        try {
          console.log("Attempting Gemini fallback...");
          const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
          const result = await model.generateContent(text);
          const geminiReply = result?.response?.text?.() || result?.response?.text || result?.output || null;
          if (geminiReply) {
            console.log("Gemini Respond Received.")
            return res.json({ reply: geminiReply, source: "gemini" });
          }
        } catch (gErr) {
          console.error("Gemini fallback failed:", gErr?.message || gErr);
        }
      }

      // Fallback: return an echo instead of a 500 so the front-end doesn't display the generic 'Error talking to the AI' message during development.
      const fallbackReply = `Sorry, the AI service is unavailable (code:${err?.response?.status || "unknown"}). Here's an echo: "${text}"`;
      return res.json({ reply: fallbackReply, error: err?.message || "unknown", hint });
    
  } catch (error) {
    console.error("/api/chat handler error:", error);
    res.status(500).json({ message: "Server error", error: error?.message || error });
  }
});


// ---------------- TTS Route (ElevenLabs) ------------------

app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: "No text provided" });

    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    const apiKey = process.env.ELEVENLABS_API_KEY;

    const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

    const elevenWS = new WebSocket(wsUrl, {
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      }
    });

    // Tell browser we are streaming audio
    res.setHeader("Content-Type","audio/mpeg");
    res.setHeader("Transfer-Encoding","chunked");

    elevenWS.on("open", () => {
      elevenWS.send(JSON.stringify({
        text,
        voice_settings: {
          stability: 0.3,
          similarity_boost: 0.85
        },
        optimize_streaming_latency: 2
      }));
    });

    elevenWS.on("message", (chunk) => {
      res.write(chunk); // send audio chunks as they arrive
    });

    elevenWS.on("close", () => res.end());
    elevenWS.on("error", (err) => {
      console.error("ElevenLabs Streaming Error:", err.message);
      res.status(500).json({ error: err.message });
    });

  } catch (err) {
    console.error("Server TTS Error:", err);
    res.status(500).json({ message: "TTS Streaming Failed" });
  }
});


// -------- WebSocket TTS Streaming Endpoint --------
const wss = new WebSocketServer({ noServer: true });

app.get("/api/tts-stream", (req, res) => {
  res.writeHead(200);
  res.end();
});

const server = http.createServer(app);

server.on("upgrade", (request, socket, head) => {
  if (request.url === "/api/tts-stream") {
    wss.handleUpgrade(request, socket, head, async (ws) => {
      try {
        ws.on("message", async (message) => {
          try {
            const { text } = JSON.parse(message);
            if (!text) {
              ws.send(JSON.stringify({ error: "No text provided" }));
              ws.close();
              return;
            }

            const voiceId = process.env.ELEVENLABS_VOICE_ID;
            const apiKey = process.env.ELEVENLABS_API_KEY;

            if (!voiceId || !apiKey) {
              ws.send(JSON.stringify({ error: "ElevenLabs credentials missing" }));
              ws.close();
              return;
            }

            const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

            const elevenWS = new WebSocket(wsUrl, {
              headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json"
              }
            });

            elevenWS.on("open", () => {
              elevenWS.send(JSON.stringify({
                text,
                voice_settings: {
                  stability: 0.3,
                  similarity_boost: 0.85
                },
                optimize_streaming_latency: 2
              }));
            });

            elevenWS.on("message", (chunk) => {
              ws.send(chunk, { binary: true });
            });

            elevenWS.on("close", () => {
              ws.close();
            });

            elevenWS.on("error", (err) => {
              console.error("ElevenLabs Streaming Error:", err.message);
              ws.send(JSON.stringify({ error: err.message }));
              ws.close();
            });

            ws.on("close", () => {
              if (elevenWS.readyState === 1) { // 1 = OPEN state
                elevenWS.close();
              }
            });

          } catch (err) {
            console.error("WebSocket message handler error:", err);
            ws.send(JSON.stringify({ error: err.message }));
            ws.close();
          }
        });

        ws.on("error", (err) => {
          console.error("WebSocket error:", err);
        });

      } catch (err) {
        console.error("WebSocket upgrade error:", err);
        socket.destroy();
      }
    });
  }
});

// ---------------- Server Start ------------------
server.listen(process.env.PORT, () =>
  console.log(`🚀 Server running on port ${process.env.PORT}`)
);