// backend/deepgram_test.js
const fs = require('fs');
const axios = require('axios');

(async () => {
  const key = process.env.DEEPGRAM_API_KEY || 'YOUR_KEY_HERE';
  const filepath = 'C:/path/to/sample.wav'; // update path
  try {
    const buffer = fs.readFileSync(filepath);
    const res = await axios.post(
      'https://api.deepgram.com/v1/listen?model=general&language=en-US',
      buffer,
      { headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' }, timeout: 120000 }
    );
    console.log('Deepgram response:', res.data);
  } catch (err) {
    console.error('Deepgram error:', err?.response?.data || err.message || err);
  }
})();
