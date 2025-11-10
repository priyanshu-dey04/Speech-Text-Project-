import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { supabase } from "./supabaseClient"; // <-- your existing file that creates supabase client

// NOTE: backend base (set in Vite env or fallback)
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";
const BUCKET = import.meta.env.VITE_BUCKET_NAME || "uploads"; // or 'uploads' as default

export default function App() {
  // auth + user
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // UI state
  const [isRecording, setIsRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [history, setHistory] = useState([]); // client-side history
  const [error, setError] = useState(null);

  // auth forms
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState("signIn"); // signIn | signUp

  // recorder refs
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  useEffect(() => {
    // check initial session
    let mounted = true;
    async function getSession() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setUser(data?.session?.user ?? null);
        setAuthLoading(false);
      } catch (err) {
        console.error("getSession err", err);
        setAuthLoading(false);
      }
    }
    getSession();

    // subscribe to auth state changes
    const { data: subs } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      if (subs?.subscription) subs.subscription.unsubscribe();
    };
  }, []);

  // ---------- AUTH ----------
  async function handleSignUp(e) {
    e.preventDefault();
    setError(null);
    try {
      const res = await supabase.auth.signUp({
        email: authEmail,
        password: authPassword,
      });
      if (res.error) throw res.error;
      alert("Sign-up successful. Check your email to confirm (if required).");
    } catch (err) {
      console.error(err);
      setError(err.message || "Sign-up failed");
    }
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setError(null);
    try {
      const res = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      if (res.error) throw res.error;
      setUser(res.data.user);
    } catch (err) {
      console.error(err);
      setError(err.message || "Sign-in failed");
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUser(null);
  }

  // ---------- RECORDING ----------
  async function startRecording() {
    setError(null);
    setTranscript("");
    recordedChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        // create file blob
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `record_${Date.now()}.webm`, { type: "audio/webm" });
        setSelectedFile(file);
        // auto-send
        await handleUploadAndTranscribe(file);
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("startRecording err", err);
      setError("Microphone access denied or not available.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      // stop tracks
      mediaRecorderRef.current.stream?.getTracks?.().forEach((t) => t.stop());
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
  }

  // ---------- FILE INPUT ----------
  function handleFileSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setSelectedFile(f);
  }

  // ---------- UPLOAD to Supabase + Transcribe ----------
  async function uploadFileToSupabase(file) {
    if (!file) throw new Error("No file");
    // unique name to avoid collisions
    const uniqueName = `${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
    const { data: upData, error: upErr } = await supabase.storage.from(BUCKET).upload(uniqueName, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (upErr) {
      console.error("upload err", upErr);
      throw upErr;
    }
    const { data: signed, error: signedErr } = await supabase.storage.from(BUCKET).createSignedUrl(uniqueName, 120);
    if (signedErr) {
      console.error("signedErr", signedErr);
      throw signedErr;
    }
    return { storagePath: uniqueName, signedUrl: signed.signedUrl };
  }

  async function handleUploadAndTranscribe(file) {
    setError(null);
    setProcessing(true);
    setTranscript("");
    try {
      if (!file) throw new Error("No file chosen");
      // 1) upload to storage
      const { storagePath, signedUrl } = await uploadFileToSupabase(file);
      // 2) send to backend for transcription (we send JSON with signed url)
      const res = await axios.post(
        `${API_BASE}/api/transcribe`,
        { audioUrl: signedUrl, storagePath },
        { timeout: 2 * 60 * 1000 } // 2min timeout
      );
      // expecting { transcript, raw? }
      const t = res?.data?.transcript ?? null;
      setTranscript(t || JSON.stringify(res?.data || "No transcript"));
      // add to history
      setHistory((h) => [
        {
          id: Date.now(),
          created_at: new Date().toISOString(),
          filename: file.name,
          transcript: t || "(no transcript)",
          storagePath,
        },
        ...h,
      ]);
    } catch (err) {
      console.error("Upload/transcribe err", err?.response?.data ?? err.message ?? err);
      setError(err?.response?.data?.error ?? err?.message ?? "Upload/transcribe failed");
    } finally {
      setProcessing(false);
    }
  }

  // ---------- small helpers ----------
  function humanTime(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  // ---------- UI fragments ----------
  function AuthBox() {
    return (
      <div className="auth-box">
        <h2>{authMode === "signIn" ? "Sign In" : "Create account"}</h2>
        <form
          onSubmit={(e) => {
            if (authMode === "signIn") handleSignIn(e);
            else handleSignUp(e);
          }}
        >
          <label>
            <div className="label">Email</div>
            <input
              className="input"
              type="email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              required
            />
          </label>
          <label>
            <div className="label">Password</div>
            <input
              className="input"
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              required
            />
          </label>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="submit" className="btn">
              {authMode === "signIn" ? "Sign In" : "Sign Up"}
            </button>
            <button
              type="button"
              className="btn-alt"
              onClick={() => setAuthMode((m) => (m === "signIn" ? "signUp" : "signIn"))}
            >
              {authMode === "signIn" ? "Create account" : "Already have account?"}
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    );
  }

  function Header() {
    return (
      <header className="header">
        <div className="brand">
          <h1>Speech to Text</h1>
          <div className="subtitle">Device-first • Responsive • Animated</div>
        </div>

        <div className="auth-area">
          {user ? (
            <>
              <div className="signed">Signed in: {user.email}</div>
              <button className="btn small" onClick={handleSignOut}>
                Sign Out
              </button>
            </>
          ) : (
            <div className="signed">Not signed</div>
          )}
        </div>
      </header>
    );
  }

  function MicButton({ onStart, onStop, recording }) {
    return (
      <div className="mic-wrap">
        <button
          className={`mic-btn ${recording ? "recording" : ""}`}
          onClick={() => {
            if (recording) onStop();
            else onStart();
          }}
          aria-pressed={recording}
          title={recording ? "Stop recording" : "Start recording"}
        >
          <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden>
            <path
              d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z"
              fill="currentColor"
            ></path>
            <path
              d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 0 0 2 0v-3.08A7 7 0 0 0 19 11z"
              fill="currentColor"
            ></path>
          </svg>
        </button>
        <div className="mic-hint">{recording ? "Recording..." : "Tap mic to record"}</div>
      </div>
    );
  }

  // ---------- Rendering ----------

  return (
    <div className="page">
      {/* inline styles to avoid postcss/tailwind issues */}
      <style>{`
        :root{
          --bg:#071022;
          --card:#0f1724;
          --muted:#97a0b3;
          --accent:#7c3aed;
          --white:#e6eef8;
          --glass: rgba(255,255,255,0.03);
        }
        *{box-sizing:border-box}
        body, html, #root { height:100%; margin:0; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;}
        .page {
          min-height:100vh;
          background: linear-gradient(180deg, rgba(8,13,23,1) 0%, rgba(4,12,17,1) 100%);
          color:var(--white);
          padding:18px;
          display:flex;
          justify-content:center;
          align-items:flex-start;
        }
        .container {
          width:100%;
          max-width:980px;
          margin: 18px;
          background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
          border-radius:14px;
          padding:20px;
          box-shadow: 0 6px 30px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.02);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(255,255,255,0.03);
        }
        .header {
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
        }
        .brand h1{ margin:0; font-size:28px; letter-spacing:-0.5px;}
        .subtitle{ color:var(--muted); font-size:12px; margin-top:6px;}
        .auth-area{ display:flex; gap:10px; align-items:center;}
        .signed{ color:var(--muted); font-size:13px;}
        .mic-wrap{ display:flex; align-items:center; gap:12px; }
        .mic-btn{
          width:72px; height:72px; border-radius:50%;
          background: linear-gradient(145deg, rgba(124,58,237,0.14), rgba(29,78,216,0.06));
          border:none; color:var(--white); display:flex; align-items:center; justify-content:center;
          box-shadow: 0 8px 20px rgba(0,0,0,0.6);
          transform: perspective(600px) translateZ(0);
          transition: transform 200ms cubic-bezier(.2,.9,.3,1), box-shadow 200ms;
        }
        .mic-btn:hover{ transform: translateY(-4px) scale(1.02); box-shadow: 0 14px 30px rgba(0,0,0,0.6); }
        .mic-btn.recording{ background: linear-gradient(135deg, #ff4d6d, #ff7a7a); box-shadow: 0 10px 40px rgba(255,77,109,0.18); transform: translateY(-2px) rotateX(10deg);}
        .mic-hint{ color:var(--muted); font-size:13px; }

        .controls { display:flex; gap:8px; align-items:center; margin-top:14px; flex-wrap:wrap; }
        .btn{ background: linear-gradient(90deg,var(--accent), #5bc0eb); border: none; color:white; padding:8px 12px; border-radius:8px; cursor:pointer; font-weight:600;}
        .btn.small{ padding:6px 10px; font-size:13px;}
        .btn-alt{ background:transparent; border:1px solid rgba(255,255,255,0.06); color:var(--white); padding:8px 10px; border-radius:8px; cursor:pointer}
        .file-info{ color:var(--muted); font-size:13px; margin-top:8px;}

        .panel{ margin-top:18px; padding:12px; border-radius:10px; background:var(--glass); border:1px solid rgba(255,255,255,0.02); }
        .label{ color:var(--muted); font-size:13px; margin-bottom:6px;}
        .input{ width:100%; padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.04); background:transparent; color:var(--white);}

        .transcript-box{ min-height:80px; border-radius:8px; padding:12px; border:1px solid rgba(255,255,255,0.03); background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.00)); color:#e6eef8; }

        .history-item{ padding:10px; border-radius:8px; background: rgba(255,255,255,0.02); margin-bottom:8px; border:1px solid rgba(255,255,255,0.02);}
        .muted{ color:var(--muted); font-size:13px; }

        .error{ margin-top:8px; color:#ff7a7a; background: rgba(255,0,0,0.03); padding:8px; border-radius:6px; font-weight:600;}

        @media (max-width:720px){
          .container{ margin:10px; padding:14px; }
          .brand h1{ font-size:20px }
          .mic-btn{ width:64px; height:64px; }
        }
      `}</style>

      <div className="container" role="main">
        <Header />

        {/* INTRO / MIC */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 18, flexWrap: "wrap" }}>
          <MicButton
            recording={isRecording}
            onStart={startRecording}
            onStop={stopRecording}
          />

          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Talk. Transcribe. Save.</div>
            <div className="muted" style={{ marginBottom: 8 }}>
              Record or upload audio — backend returns transcription (demo). Sign in to save history.
            </div>

            <div className="controls">
              <label className="btn-alt" style={{ padding: "8px 10px", display: "inline-flex", alignItems: "center", gap: 8 }}>
                Choose file
                <input type="file" accept="audio/*" onChange={handleFileSelect} style={{ display: "none" }} />
              </label>

              <button
                className="btn"
                onClick={() => {
                  if (!selectedFile) return setError("No file selected");
                  handleUploadAndTranscribe(selectedFile);
                }}
                disabled={processing}
              >
                Upload & Transcribe
              </button>

              <button
                className="btn-alt"
                onClick={() => {
                  setSelectedFile(null);
                  setTranscript("");
                }}
              >
                Clear
              </button>
            </div>

            <div className="file-info">
              {selectedFile ? (
                <>
                  Selected: <strong>{selectedFile.name}</strong> • {(selectedFile.size / 1024).toFixed(1)} KB
                </>
              ) : (
                <span className="muted">No file selected</span>
              )}
            </div>
          </div>
        </div>

        {/* PROCESSING / TRANSCRIPT */}
        <div className="panel" style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>Transcript</div>
            <div className="muted">{processing ? "Processing audio..." : "Status: idle"}</div>
          </div>

          <div className="transcript-box" style={{ marginTop: 12 }}>
            {processing ? (
              <div style={{ opacity: 0.9 }}>Transcribing... please wait. (this may take up to 1-2 minutes)</div>
            ) : transcript ? (
              <div>{transcript}</div>
            ) : (
              <div className="muted">No transcript yet</div>
            )}
          </div>

          {error && <div className="error">{error}</div>}
        </div>

        {/* AUTH / HISTORY */}
        <div style={{ display: "flex", gap: 18, marginTop: 18, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Sign In</div>
            {user ? (
              <div className="panel">
                <div>Signed in as <strong>{user.email}</strong></div>
                <div className="muted" style={{ marginTop: 6 }}>You can save and view history when signed in.</div>
                <div style={{ marginTop: 8 }}>
                  <button className="btn small" onClick={handleSignOut}>Sign Out</button>
                </div>
              </div>
            ) : (
              <div className="panel">
                <AuthBox />
              </div>
            )}
          </div>

          <div style={{ flex: 2, minWidth: 320 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>History</div>
            <div className="panel">
              {history.length === 0 ? (
                <div className="muted">No transcriptions yet. Sign in to save and view your history.</div>
              ) : (
                history.map((h) => (
                  <div className="history-item" key={h.id}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={{ fontWeight: 700 }}>{h.filename}</div>
                      <div className="muted">{humanTime(h.created_at)}</div>
                    </div>
                    <div style={{ marginTop: 6 }}>{h.transcript}</div>
                    <div className="muted" style={{ marginTop: 8 }}>{h.storagePath}</div>
                  </div>
                ))
              )}

              <div style={{ marginTop: 10 }}>
                <button
                  className="btn-alt"
                  onClick={() => {
                    // just clear client history (server DB not used in this version)
                    setHistory([]);
                  }}
                >
                  Clear History
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* footer */}
        <footer style={{ marginTop: 18, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          Built with ❤️ — Deepgram + Supabase + Your backend
        </footer>
      </div>
    </div>
  );
}
