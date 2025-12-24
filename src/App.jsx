import { useState } from "react";

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();

recognition.continuous = false;
recognition.lang = "en-IN";
recognition.interimResults = false;

function App() {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);

  let mediaSource = null;
  let sourceBuffer = null;
  let audioElement = null;
  let ws = null;

  const startListening = () => {
    recognition.start();

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript.trim();
      if (!text) return;
      setMessage(text);
      sendMessage(text);
    };

    recognition.onerror = (err) => {
      console.log("🎤 Voice Error:", err);
    };
  };

  const sendMessage = async (msg) => {
    try {
      setLoading(true);

      const response = await fetch("http://localhost:4000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg }),
      });

      const data = await response.json();

      if (!data.reply) return;
      setReply(data.reply);

      startStreamingTTS(data.reply);
    } catch (error) {
      console.error("❌ Chat API Error:", error);
    } finally {
      setLoading(false);
    }
  };


  const startStreamingTTS = (text) => {
    if (!text.trim()) return;

    if (ws) ws.close();

    ws = new WebSocket("ws://localhost:4000/api/tts-stream");

    audioElement = new Audio();
    const audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    const mediaSource = new MediaSource();

    mediaSource.addEventListener(
      "sourceopen",
      () => {
        let sourceBuffer;
        try {
          if (MediaSource.isTypeSupported("audio/mpeg")) {
            sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
          } else if (MediaSource.isTypeSupported('audio/webm; codecs="opus"')) {
            sourceBuffer = mediaSource.addSourceBuffer(
              'audio/webm; codecs="opus"'
            );
          } else {
            console.warn(
              "No supported audio codec found, attempting audio/mpeg"
            );
            sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
          }
        } catch (e) {
          console.error("Error creating source buffer:", e);
          mediaSource.endOfStream("decode");
          return;
        }

        ws.onopen = () => {
          ws.send(JSON.stringify({ text }));
        };

        ws.onmessage = async (event) => {
          try {
            if (
              event.data instanceof Blob ||
              event.data instanceof ArrayBuffer
            ) {
              const arrayBuffer =
                event.data instanceof Blob
                  ? await event.data.arrayBuffer()
                  : event.data;

              if (!sourceBuffer.updating) {
                sourceBuffer.appendBuffer(new Uint8Array(arrayBuffer));
              } else {
                sourceBuffer.addEventListener(
                  "updateend",
                  () => {
                    if (!sourceBuffer.updating) {
                      sourceBuffer.appendBuffer(new Uint8Array(arrayBuffer));
                    }
                  },
                  { once: true }
                );
              }
            }
          } catch (err) {
            console.error("Error processing audio chunk:", err);
          }
        };

        ws.onclose = () => {
          console.log("🔊  Streaming ended.");
          try {
            if (mediaSource.readyState === "open") {
              mediaSource.endOfStream();
            }
          } catch (err) {
            console.warn("Error ending stream:", err);
          }
        };

        ws.onerror = (err) => {
          console.error("WS STREAM ERROR:", err);
          if (mediaSource.readyState === "open") {
            mediaSource.endOfStream("network");
          }
        };
      },
      { once: true }
    );

    audioElement.src = URL.createObjectURL(mediaSource);
    audioElement.play().catch((err) => console.error("Audio play error:", err));
  };

  return (
    <div style={{ padding: 30, fontFamily: "Arial" }}>
      <h2>🤖 Voice AI Assistant (Streaming Mode)</h2>

      <div style={{ marginBottom: 10 }}>
        <strong>You said:</strong> {message || "🎤 Waiting..."}
      </div>

      <button onClick={startListening} style={{ padding: 10 }}>
        🎙 Start Speaking
      </button>

      <div style={{ marginTop: 20 }}>
        <strong>AI:</strong> {loading ? "⏳ Thinking..." : reply}
      </div>
    </div>
  );
}

export default App;
