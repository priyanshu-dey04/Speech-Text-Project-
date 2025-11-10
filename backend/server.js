import cors from "cors";
app.use(cors()); // allows all origins for now (ok for dev); later restrict to your frontend domain


// backend/server.js (ES module)
import express from "express";
import cors from "cors";
import multer from "multer";
import fetch from "node-fetch"; // node 18+ has global fetch, but importing is safe
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "path";

dotenv.config();

const PORT = process.env.PORT || 5000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BUCKET = process.env.BUCKET_NAME || "uploads";
const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
const SIGNED_EXPIRES = Number(process.env.SIGNED_URL_EXPIRES || 120);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY in env");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(cors());
app.use(express.json());

// multer for multipart uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Basic health
app.get("/", (req, res) => res.send("backend up"));

// Combined transcribe route
// Accepts either multipart upload (file in req.file) OR JSON { storagePath: "..." }
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    console.log("--- /api/transcribe called ---");
    // if multipart file provided
    let audioBuffer;
    let mime = "audio/wav";

    if (req.file && req.file.buffer) {
      console.log("Using direct multipart upload");
      audioBuffer = req.file.buffer;
      mime = req.file.mimetype || mime;
    } else if (req.body && req.body.storagePath) {
      // fetch from supabase via signed URL
      const storagePath = req.body.storagePath;
      console.log("Using storagePath:", storagePath);
      const { data: signedData, error: signedErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, SIGNED_EXPIRES);

      if (signedErr) {
        console.error("createSignedUrl error", signedErr);
        return res.status(500).json({ error: "Failed to create signed URL", detail: signedErr });
      }

      const signedUrl = signedData.signedUrl;
      const r = await fetch(signedUrl);
      audioBuffer = Buffer.from(await r.arrayBuffer());
      mime = r.headers.get("content-type") || mime;
    } else {
      return res.status(400).json({ error: "No audio provided" });
    }

    // Send to Deepgram
    if (!DEEPGRAM_KEY) {
      return res.status(500).json({ error: "Deepgram API key not configured" });
    }

    const dgResp = await fetch("https://api.deepgram.com/v1/listen?model=general", {
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_KEY}`,
        "Content-Type": mime,
      },
      body: audioBuffer,
    });

    if (!dgResp.ok) {
      const text = await dgResp.text();
      console.error("Deepgram error:", dgResp.status, text);
      return res.status(502).json({ error: "Deepgram transcription failed", detail: text });
    }

    const dgJson = await dgResp.json();
    const transcript =
      dgJson?.results?.channels?.[0]?.alternatives?.[0]?.transcript ||
      dgJson?.results?.channels?.[0]?.alternatives?.[0]?.spoken_text ||
      "";

    return res.json({ transcript, raw: dgJson });
  } catch (err) {
    console.error("Transcribe error:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
