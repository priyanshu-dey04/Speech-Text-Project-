// src/App.jsx
import React, { useState, useRef, useEffect } from "react";
import { supabase } from "./supabaseClient"; // <- your supabase client file
import axios from "axios";
import "./index.css"; // ensure Tailwind is imported

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function App() {
  // UI state
  const [user, setUser] = useState(null);
  const [file, setFile] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  // On mount: check Supabase auth session
  useEffect(() => {
    const s = supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) setUser(data.session.user);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    // cleanup subscription
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // --- Auth helpers ---
  async function signInWithEmail(email) {
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      alert("Magic link sent to your email. Check inbox/spam.");
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
  }

  // --- Recording ---
  async function startRecording() {
    setError(null);
    setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      recordedChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        // Create a File so server or Supabase can treat it like an uploaded file
        const recordedFile = new File([blob], `record-${Date.now()}.webm`, { type: blob.type });
        setFile(recordedFile);
        // optionally autoproc: await uploadAndTranscribe(recordedFile);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      setError("Mic permission denied or device not available.");
    }
  }

  function stopRecording() {
    try {
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current?.stream?.getTracks?.().forEach((t) => t.stop());
    } catch (err) {
      // ignore
    } finally {
      setIsRecording(false);
    }
  }

  // --- File input handler ---
  function handleFileSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setTranscript("");
    setError(null);
  }

  // --- Upload & transcribe ---
  // Two modes supported:
  // 1) send file directly to backend (multipart/form-data)
  // 2) if you already uploaded to Supabase storage elsewhere and have storagePath -> send storagePath
  async function uploadAndTranscribe(selectedFile) {
    setError(null);
    setLoading(true);
    setTranscript("");
    try {
      if (!selectedFile) throw new Error("No file selected.");

      // Build form - backend expects 'audio' file (multipart)
      const form = new FormData();
      form.append("audio", selectedFile);

      // If you want to send user id, add it
      if (user?.id) form.append("userId", user.id);

      const res = await axios.post(`${API_BASE}/api/transcribe`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });

      const data = res.data ?? {};
      if (data.error) {
        throw new Error(data.error || "Transcription failed");
      }

      setTranscript(data.transcript ?? data.result ?? "");
      // Optionally show saved history if backend saved to DB
      if (data.history) setHistory(data.history);
    } catch (err) {
      // Show friendly message and console for debugging
      const msg = err?.response?.data?.error || err.message || String(err);
      setError(msg);
      console.error("Upload/transcribe error:", err);
    } finally {
      setLoading(false);
    }
  }

  // --- Fetch history from backend (if server returns list) ---
  async function loadHistory() {
    setError(null);
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/transcriptions`, { timeout: 15000 });
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError("Failed to load history.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Convenience: clear file
  function clearSelected() {
    setFile(null);
    setTranscript("");
    setError(null);
    recordedChunksRef.current = [];
  }

  // --- Minimal UI / layout ---
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-slate-100 antialiased">
      <header className="max-w-5xl mx-auto p-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Speech to Text</h1>
          <p className="text-sm text-slate-400">Device-first • Responsive • Animated</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => alert("Docs: show project docs or link")}
            className="bg-slate-700/40 px-3 py-1 rounded hover:bg-slate-700 transition"
          >
            Docs
          </button>

          {user ? (
            <div className="text-right">
              <div className="text-xs text-slate-300">Signed in:</div>
              <div className="text-sm flex items-center gap-2">
                <span className="font-medium">{user.email ?? user.user_metadata?.email ?? "User"}</span>
                <button
                  onClick={signOut}
                  className="ml-2 bg-rose-600 text-white px-2 py-1 rounded shadow hover:opacity-90"
                >
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm">
              <button
                onClick={() => {
                  const email = prompt("Enter your email for magic-link sign in:");
                  if (email) signInWithEmail(email);
                }}
                className="bg-emerald-600 px-3 py-1 rounded hover:brightness-105"
              >
                Sign In
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 grid gap-8">
        {/* Hero */}
        <section className="flex flex-col md:flex-row items-start gap-6">
          <div className="w-full md:w-1/3 flex flex-col items-center">
            {/* 3D mic button */}
            <div
              onClick={() => (isRecording ? stopRecording() : startRecording())}
              className={`group w-36 h-36 rounded-full flex items-center justify-center cursor-pointer transform transition-all
                ${isRecording ? "scale-95 ring-8 ring-rose-500/20" : "hover:scale-105"}
                bg-gradient-to-br from-slate-800 to-slate-700 shadow-2xl`}
              title={isRecording ? "Stop recording" : "Start recording"}
            >
              <div
                className={`w-24 h-24 rounded-full bg-slate-900 flex items-center justify-center text-white text-2xl shadow-inner transition-transform
                  ${isRecording ? "animate-pulse translate-y-0" : "group-hover:-translate-y-1"}`}
              >
                🎤
              </div>
            </div>

            <div className="mt-4 text-sm text-slate-400 text-center">
              <div className="font-semibold">{isRecording ? "Recording…" : "Tap mic to record"}</div>
              <div className="mt-1">Click the mic to start/stop recording. File will appear below.</div>
            </div>
          </div>

          <div className="w-full md:w-2/3 bg-slate-900/40 p-4 rounded-lg shadow-lg">
            <h2 className="text-xl font-semibold">Talk. Transcribe. Save.</h2>
            <p className="text-sm text-slate-400 mt-1">
              Record with your device or upload audio files — transcriptions appear instantly and are stored
              securely (if backend saves them).
            </p>

            <div className="mt-4 flex gap-3 items-center">
              <label className="bg-slate-700 px-3 py-2 rounded text-sm cursor-pointer hover:bg-slate-600">
                Choose file
                <input onChange={handleFileSelect} type="file" accept="audio/*" className="hidden" />
              </label>

              <button
                disabled={!file || loading}
                onClick={() => uploadAndTranscribe(file)}
                className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 px-3 py-2 rounded text-sm"
              >
                Upload & Transcribe
              </button>

              <button onClick={clearSelected} className="bg-slate-700 px-3 py-2 rounded text-sm hover:bg-slate-600">
                Clear
              </button>

              <div className="ml-auto text-sm text-slate-400">{loading ? "Processing..." : ""}</div>
            </div>

            {file && (
              <div className="mt-3 text-sm text-slate-200 bg-slate-800 p-2 rounded">
                <strong>Selected:</strong> {file.name} • {Math.round((file.size / 1024) * 10) / 10} KB
              </div>
            )}

            {error && (
              <div className="mt-3 text-sm text-rose-300 bg-rose-900/10 p-2 rounded">
                <strong>Error:</strong> {String(error)}
              </div>
            )}

            {transcript && (
              <div className="mt-4 p-3 bg-gradient-to-r from-slate-800/60 to-slate-700/60 rounded border border-slate-700">
                <h3 className="font-semibold">Transcript</h3>
                <p className="mt-2 text-slate-100 whitespace-pre-wrap">{transcript}</p>
              </div>
            )}
          </div>
        </section>

        {/* History */}
        <section className="bg-slate-900/40 p-4 rounded-lg shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">History</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={loadHistory}
                className="bg-slate-700 px-3 py-1 rounded hover:bg-slate-600 text-sm disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-3">
            {history.length === 0 ? (
              <div className="text-slate-400 text-sm">No transcriptions yet. Sign in to save and view your history.</div>
            ) : (
              <div className="grid gap-3">
                {history.map((h, idx) => (
                  <article key={idx} className="p-3 bg-slate-800/60 rounded border border-slate-700">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">{h.title || `Entry ${idx + 1}`}</div>
                        <div className="text-xs text-slate-400 mt-1">{new Date(h.created_at).toLocaleString()}</div>
                      </div>
                      <div className="text-xs text-slate-300">{h.duration ? `${h.duration}s` : ""}</div>
                    </div>
                    <div className="mt-2 text-slate-200 text-sm whitespace-pre-wrap">{h.transcript}</div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="max-w-5xl mx-auto p-6 text-center text-xs text-slate-500">
        Built with ❤️ — Deepgram / Supabase / Your backend
      </footer>
    </div>
  );
}
