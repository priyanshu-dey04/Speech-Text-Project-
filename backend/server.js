// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";
import process from "process";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" })); // allow large audio payloads

const PORT = process.env.PORT || 5000;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || process.env.DEEPGRAM_API_KEY; // tolerate both names

if (!DEEPGRAM_API_KEY) {
  console.error("ERROR: DEEPGRAM_API_KEY not set in environment.");
}

// simple health
app.get("/", (req, res) => res.send("backend up"));

// Combined transcribe endpoint (frontend should POST { audioUrl, storagePath } )
app.post("/api/transcribe", async (req, res) => {
  console.log("--- /api/transcribe called ---");
  console.log("body keys:", Object.keys(req.body));
  const { audioUrl, storagePath } = req.body || {};

  try {
    // Validate input
    if (!audioUrl && !req.file) {
      console.warn("No audioUrl and no multipart file provided");
      return res.status(400).json({ error: "No audioUrl or file provided" });
    }

    // Case A: if frontend has already uploaded to storage and gave us signed url
    let audioBuffer;
    let mime = "audio/webm";

    if (audioUrl) {
      console.log("Fetching audio from audioUrl...");
      // fetch the signed URL bytes
      const fetchRes = await axios.get(audioUrl, { responseType: "arraybuffer", timeout: 120000 });
      audioBuffer = fetchRes.data;
      // try to detect mime from headers if available
      const contentType = fetchRes.headers && fetchRes.headers["content-type"];
      if (contentType) mime = contentType;
      console.log("Fetched audio size (bytes):", audioBuffer.byteLength || audioBuffer.length);
    }

    // If your frontend posted the file directly (multipart), handle req.file.buffer here
    // (this server expects an audioUrl approach; add multer if you want multipart)

    // --- Send bytes to Deepgram ---
    if (!DEEPGRAM_API_KEY) {
      console.warn("No DEEPGRAM_API_KEY -> returning fallback transcript in dev.");
      return res.json({ transcript: "fake transcript (dev)", raw: null });
    }

    console.log("Sending audio to Deepgram for transcription...");
    const deepgramUrl = "https://api.deepgram.com/v1/listen?model=general&language=en-US";

    const dgResp = await axios({
      url: deepgramUrl,
      method: "post",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "Content-Type": mime,
      },
      data: audioBuffer,
      responseType: "json",
      timeout: 120000,
    });

    // Deepgram returns transcript at data.results.channels[0].alternatives[0].transcript
    const transcript =
      dgResp?.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ||
      dgResp?.data?.results?.channels?.[0]?.alternatives?.[0]?.confidence?.toString() ||
      null;

    console.log("Deepgram response shape preview:", !!dgResp?.data, "transcript:", transcript ? "(ok)" : "(none)");

    if (!transcript) {
      console.warn("No transcript returned from Deepgram; returning raw response for debugging.");
      return res.status(500).json({ error: "No transcript returned from provider", raw: dgResp.data ?? null });
    }

    // Success — return transcript
    return res.json({ transcript, raw: dgResp.data ?? null });
  } catch (err) {
    // Log details for debugging
    console.error("Transcribe error:", err?.response?.status, err?.response?.data ?? err.message);

    // If dev, return fallback but include debug info
    if (process.env.NODE_ENV !== "production") {
      return res.status(500).json({
        error: "Transcription failed (dev fallback)",
        detail: err?.response?.data ?? err?.message,
        transcript: "fake transcript (dev)",
      });
    }

    // production -> don't send API internals to user
    return res.status(500).json({ error: "Transcription failed" });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
