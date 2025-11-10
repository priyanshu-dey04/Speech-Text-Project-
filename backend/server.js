// server.js - accepts multipart OR { storagePath } and returns Deepgram transcript
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer(); // in-memory file handling
const PORT = process.env.PORT || 5000;

// Config from env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const BUCKET_NAME = process.env.BUCKET_NAME || 'uploads';
const SIGNED_URL_EXPIRES = Number(process.env.SIGNED_URL_EXPIRES || 120);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('Warning: SUPABASE_URL or SUPABASE_KEY missing - storagePath fetching will fail.');
}
if (!DEEPGRAM_API_KEY) {
  console.warn('Warning: DEEPGRAM_API_KEY missing - transcription calls will fail.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Middlewares
app.use(cors()); // allow requests from your frontend during dev
app.use(express.json({ limit: '50mb' })); // to accept JSON { storagePath }
app.use(express.urlencoded({ extended: true }));

// Simple health route
app.get('/', (req, res) => res.send('backend up'));

/**
 * POST /api/transcribe
 * Accepts:
 *  - multipart/form-data with field "audio" (file)          OR
 *  - application/json { storagePath: "user-id/filename.webm" }
 *
 * Returns:
 *  { transcript: "...", raw: <deepgram response> }
 */
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    console.log('--- /api/transcribe called ---');
    console.log('has req.file:', !!req.file);
    console.log('body keys:', Object.keys(req.body));
    // prefer file in req.file, else accept storagePath
    let audioBuffer;
    let mime = 'audio/wav';

    // Case 1: direct upload from browser (multipart/form-data)
    if (req.file && req.file.buffer) {
      audioBuffer = req.file.buffer;
      mime = req.file.mimetype || mime;
      console.log('Using direct multipart upload. mime=', mime, 'size=', audioBuffer.length);
    }
    // Case 2: frontend uploaded to Supabase storage and sent storagePath
    else if (req.body && req.body.storagePath) {
      const storagePath = req.body.storagePath;
      console.log('Using storagePath:', storagePath);

      if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({ error: 'Server missing Supabase config (SUPABASE_URL / SUPABASE_KEY)' });
      }

      // create signed url for the object to fetch
      const { data: signedResp, error: signedErr } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(storagePath, SIGNED_URL_EXPIRES);

      if (signedErr) {
        console.error('createSignedUrl error', signedErr);
        return res.status(500).json({ error: 'Failed to create signed URL', detail: signedErr });
      }
      const signedUrl = signedResp.signedUrl;
      if (!signedUrl) {
        console.error('Signed url missing in response', signedResp);
        return res.status(500).json({ error: 'Signed URL not returned by Supabase' });
      }

      // fetch bytes from signed URL
      console.log('Fetching audio from signed URL...');
      const audioResp = await axios.get(signedUrl, { responseType: 'arraybuffer', timeout: 120000 });
      audioBuffer = Buffer.from(audioResp.data);
      mime = audioResp.headers['content-type'] || mime;
      console.log('Fetched bytes:', audioBuffer.length, 'mime:', mime);
    } else {
      return res.status(400).json({ error: 'No audio provided. Send multipart file "audio" or JSON { storagePath }' });
    }

    // ensure Deepgram API key is present
    if (!DEEPGRAM_API_KEY) {
      return res.status(500).json({ error: 'Server missing DEEPGRAM_API_KEY' });
    }

    // Send bytes to Deepgram (listen endpoint). Adjust query params as needed.
    console.log('Sending to Deepgram... (size bytes =', audioBuffer.length, ')');
    const dgResp = await axios.post(
      'https://api.deepgram.com/v1/listen?model=general',
      audioBuffer,
      {
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          'Content-Type': mime
        },
        timeout: 120000
      }
    );

    // Extract transcript (Deepgram response structure)
    const transcript = dgResp?.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';

    // Return transcript and optionally raw deepgram response to frontend
    return res.json({
      transcript,
      raw: dgResp?.data ?? null
    });

  } catch (err) {
    // detailed logging for debugging
    console.error('Transcribe error:', err?.response?.data ?? err.message ?? err);
    // If axios response exists pass it back for debugging (careful in prod)
    const debug = err?.response?.data ?? err?.message ?? String(err);
    return res.status(500).json({ error: 'Transcription failed', detail: debug });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
