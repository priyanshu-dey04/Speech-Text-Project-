import React, { useState, useRef, useEffect } from "react";
import { supabase } from "./supabaseClient";
import axios from "axios";

export default function App() {
  // app state
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState({ type: null, text: "" });
  const [history, setHistory] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  // load session on mount
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user) setUser(data.session.user);
      // listen for changes
      supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });
    })();
  }, []);

  // --- Auth functions ---
  async function signUp() {
    setStatus({ type: "info", text: "Signing up..." });
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setStatus({ type: "error", text: error.message });
    else setStatus({ type: "success", text: "Check your email to confirm." });
  }

  async function signIn() {
    setStatus({ type: "info", text: "Signing in..." });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setStatus({ type: "error", text: error.message });
    else {
      setUser(data.session.user);
      setStatus({ type: "success", text: "Signed in" });
      loadHistory(); // auto-load after sign in
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setHistory([]);
    setStatus({ type: "info", text: "Signed out" });
  }

  // --- Recording handlers ---
  function startRecording() {
    setStatus({ type: "info", text: "Requesting mic..." });
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        const mr = new MediaRecorder(stream);
        mediaRecorderRef.current = mr;
        chunksRef.current = [];
        mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const f = new File([blob], `record-${Date.now()}.webm`, { type: "audio/webm" });
          setFile(f);
          setStatus({ type: "info", text: "Recording saved — uploading..." });
          await uploadFileToServer(f);
        };
        mr.start();
        setIsRecording(true);
        setStatus({ type: "info", text: "Recording..." });
      })
      .catch(err => setStatus({ type: "error", text: "Mic permission denied" }));
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  // --- file input ---
  function handleFileSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
  }

  // --- Upload flow: upload file to Supabase Storage (private), get signed url, send to backend for Deepgram ---
  async function uploadFileToServer(f) {
    try {
      if (!user) return setStatus({ type: "error", text: "Please sign in first." });

      setStatus({ type: "info", text: "Uploading file to storage..." });

      const path = `${user.id}/${Date.now()}_${f.name}`;
      const { error: uploadErr } = await supabase.storage.from("uploads").upload(path, f, {
        cacheControl: "3600",
        upsert: false,
        contentType: f.type
      });

      if (uploadErr) throw uploadErr;

      // create a short-lived signed url to let the backend fetch the file
      const { data: signed, error: signedErr } = await supabase.storage.from("uploads").createSignedUrl(path, 120);
      if (signedErr) throw signedErr;

      setStatus({ type: "info", text: "Sending to transcribe service..." });

      // get JWT to pass to backend if you want backend to verify user (optional)
      const { data: sessData } = await supabase.auth.getSession();
      const token = sessData?.session?.access_token;

      // call backend transcribe route (replace with your backend url)
      const res = await axios.post("http://localhost:5000/api/transcribe", { audioUrl: signed.signedUrl, storagePath: path }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setStatus({ type: "success", text: "Transcribed & saved." });
      // add to history quickly
      loadHistory();

    } catch (err) {
      console.error(err);
      const msg = err?.response?.data?.error || err?.message || JSON.stringify(err);
      setStatus({ type: "error", text: String(msg) });
    }
  }

  // --- load history (server-side) ---
  async function loadHistory() {
    try {
      if (!user) return setStatus({ type: "error", text: "Sign in to load history" });
      setStatus({ type: "info", text: "Loading history..." });
      const { data: sessData } = await supabase.auth.getSession();
      const token = sessData?.session?.access_token;

      const res = await axios.get("http://localhost:5000/api/transcriptions", {
        headers: { Authorization: `Bearer ${token}` }
      });

      setHistory(res.data.data || []);
      setStatus({ type: null, text: "" });
    } catch (err) {
      console.error(err);
      setStatus({ type: "error", text: "Failed to load history." });
    }
  }

  return (
    <div className="min-h-screen flex items-start justify-center py-12 px-6">
      <div className="w-full max-w-5xl">
        {/* header */}
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold kicker">Speech to Text</h1>
            <div className="text-sm text-muted">Device-first • Responsive • Animated</div>
          </div>

          <div className="flex items-center gap-3">
            {!user ? (
              <button className="btn-3d btn-ghost text-sm" onClick={() => setStatus({ type: "info", text: "Use the Sign In panel below." })}>
                Docs
              </button>
            ) : (
              <div className="text-sm text-muted pr-3">Signed in: <span className="font-medium">{user.email}</span></div>
            )}
            <button className="btn-3d btn-primary text-sm" onClick={() => { /* open docs or route */ }}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Action
            </button>
          </div>
        </header>

        {/* main layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* left: hero + actions */}
          <section className="md:col-span-2 card-3d p-6">
            <div className="flex items-start gap-6">
              <div>
                {/* mic circle */}
                <div
                  onClick={() => (isRecording ? stopRecording() : startRecording())}
                  className={`mic-circle ${isRecording ? "recording" : ""}`}
                  aria-label="Record"
                >
                  {/* mic icon */}
                  {!isRecording ? (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" fill="white" /><path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V18h-3a1 1 0 0 0 0 2h10a1 1 0 0 0 0-2h-3v-2.1A5 5 0 0 0 19 11z" fill="white"/></svg>
                  ) : (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill="#ff4d6d" /></svg>
                  )}
                </div>
              </div>

              <div className="flex-1">
                <h2 className="text-2xl font-semibold mb-1">Talk. Transcribe. Save.</h2>
                <p className="text-muted mb-4">Record with your device or upload audio files — transcriptions appear instantly and are stored securely.</p>

                <div className="flex items-center gap-3">
                  <label className="cursor-pointer">
                    <input type="file" accept="audio/*" onChange={handleFileSelect} className="sr-only" />
                    <span className="btn-3d btn-ghost">Choose file</span>
                  </label>

                  <button
                    className="btn-3d btn-primary"
                    onClick={() => file ? uploadFileToServer(file) : setStatus({ type: "error", text: "No file selected" })}
                  >
                    Upload & Transcribe
                  </button>

                  <button className="btn-3d" onClick={() => setStatus({ type: null, text: "" })}>
                    Clear
                  </button>
                </div>

                {/* status card */}
                <div className="mt-4">
                  {status.type === "error" && <div className="p-3 rounded-md bg-rose-900/30 border border-rose-600 text-rose-200"><strong>Error:</strong> {status.text}</div>}
                  {status.type === "info" && <div className="p-3 rounded-md bg-slate-800/50 border border-slate-700 text-slate-200">{status.text}</div>}
                  {status.type === "success" && <div className="p-3 rounded-md bg-emerald-900/30 border border-emerald-600 text-emerald-200">{status.text}</div>}
                </div>
              </div>
            </div>
          </section>

          {/* right: sign-in / history */}
          <aside className="space-y-4">
            {/* Sign In Card */}
            <div className="card-3d p-4">
              <h3 className="text-lg font-semibold mb-2">Sign In</h3>
              {!user ? (
                <>
                  <input className="input-surface w-full mb-2" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
                  <input className="input-surface w-full mb-3" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
                  <div className="flex gap-2">
                    <button className="btn-3d btn-primary w-full" onClick={signIn}>Sign In</button>
                    <button className="btn-3d btn-ghost w-full" onClick={signUp}>Sign Up</button>
                  </div>
                </>
              ) : (
                <div>
                  <div className="text-sm text-muted mb-2">Signed in as</div>
                  <div className="font-medium mb-3">{user.email}</div>
                  <button className="btn-3d w-full btn-ghost" onClick={signOut}>Sign Out</button>
                </div>
              )}
            </div>

            {/* History */}
            <div className="card-3d p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold">History</h3>
                <button className="text-sm text-muted" onClick={loadHistory}>Refresh</button>
              </div>

              <div className="space-y-3">
                {history.length === 0 ? (
                  <div className="text-sm text-muted">No transcriptions yet.</div>
                ) : (
                  history.map(h => (
                    <div key={h.id} className="p-3 card-3d border border-slate-700">
                      <div className="text-sm mb-2">{h.transcription}</div>
                      <div className="text-xs text-muted">{h.filename} • {new Date(h.created_at).toLocaleString()}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Small tips */}
            <div className="card-3d p-3 text-sm text-muted">
              Tip: Click the mic circle to start/stop recording. Sign in to save and view your history.
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

async function uploadDirect(file) {
  if (!file) return alert('No file selected');
  const form = new FormData();
  form.append('audio', file, file.name);

  try {
    const res = await axios.post('http://localhost:5000/api/transcribe', form, {
      // do NOT set Content-Type here
      timeout: 120000
    });
    console.log('Transcribe success:', res.data);
    alert('Transcript: ' + (res.data.transcript || 'none'));
  } catch (err) {
    // verbose debug
    console.error('Upload failed — full error:', err);
    console.error('err.message:', err.message);
    console.error('err.code:', err.code);
    console.error('err.response?.status:', err?.response?.status);
    console.error('err.response?.data:', err?.response?.data);
    console.error('err.request:', err?.request); // if request was sent but no response
    alert('Upload failed — check console for details');
  }
}
