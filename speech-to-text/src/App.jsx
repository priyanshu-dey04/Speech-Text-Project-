// src/App.jsx
import React, { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import axios from "axios";
import "./index.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

export default function App() {
  // basic UI state
  const [user, setUser] = useState(null);
  const [file, setFile] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  // on mount: listen to supabase auth session
  useEffect(() => {
    // get initial session (supabase v2)
    supabase.auth.getSession().then(({ data }) => {
      setUser(data?.session?.user ?? null);
    });

    const { subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription?.unsubscribe?.();
  }, []);

  // ---------- AUTH ----------
  async function signInWithMagicLink(email) {
    setError(null);
    try {
      if (!email) throw new Error("Please provide email");
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      alert("Magic link sent. Check your inbox / spam.");
    } catch (err) {
      console.error("Sign in error:", err);
      setError(err.message || String(err));
    }
  }

  async function signOut() {
    try {
      await supabase.auth.signOut();
      setUser(null);
    } catch (err) {
      console.error("Sign out error:", err);
    }
  }

  // ---------- RECORDING ----------
  async function startRecording() {
    setError(null);
    setTranscript("");
    recordedChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        const outFile = new File([blob], `record-${Date.now()}.webm`, { type: blob.type });
        setFile(outFile);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Recording error:", err);
      setError("Could not access microphone. Check permissions.");
    }
  }

  function stopRecording() {
    try {
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current?.stream?.getTracks?.forEach((t) => t.stop());
    } catch (err) {
      console.warn("stopRecording error:", err);
    } finally {
      setIsRecording(false);
    }
  }

  // ---------- FILE SELECT ----------
  function handleFileSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setTranscript("");
    setError(null);
  }

  // ---------- UPLOAD & TRANSCRIBE ----------
  // This function sends the file as multipart/form-data to backend.
  // Backend endpoint expected: POST /api/transcribe
  async function uploadAndTranscribe(selectedFile) {
    setError(null);
    setTranscript("");
    if (!selectedFile) {
      setError("No file selected");
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      form.append("audio", selectedFile);
      // optional: include user id if signed in
      if (user?.id) form.append("userId", user.id);

      const res = await axios.post(`${API_BASE}/api/transcribe`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });

      // Expect backend to return { transcript: "...", raw: {...} }
      const data = res?.data ?? {};
      if (data.error) {
        throw new Error(data.error);
      }
      setTranscript(data.transcript ?? JSON.stringify(data.raw ?? data));
      // If backend returns saved history
      if (Array.isArray(data.history)) setHistory(data.history);
    } catch (err) {
      console.error("Transcription upload error:", err);
      const msg = err?.response?.data?.error || err.message || "Network error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // ---------- LOAD HISTORY ----------
  async function loadHistory() {
    setError(null);
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/transcriptions`, { timeout: 15000 });
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Load history error:", err);
      setError("Failed to load history");
    } finally {
      setLoading(false);
    }
  }

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-slate-100">
      <header className="max-w-5xl mx-auto p-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold">Speech to Text</h1>
          <p className="text-sm text-slate-400">Device-first · Responsive · Animated</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.open("/docs", "_blank")}
            className="bg-slate-700 px-3 py-1 rounded hover:bg-slate-600"
          >
            Docs
          </button>
          {user ? (
            <div className="text-right">
              <div className="text-xs text-slate-300">Signed in:</div>
              <div className="text-sm flex items-center gap-2">
                <span>{user.email ?? "User"}</span>
                <button onClick={signOut} className="bg-rose-600 px-2 py-1 rounded text-white">
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                onClick={() => {
                  const email = prompt("Enter email for magic link sign-in:");
                  if (email) signInWithMagicLink(email);
                }}
                className="bg-emerald-600 px-3 py-1 rounded"
              >
                Sign In
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 grid gap-8">
        <section className="flex flex-col md:flex-row gap-6">
          <div className="md:w-1/3 flex flex-col items-center">
            <div
              role="button"
              onClick={() => (isRecording ? stopRecording() : startRecording())}
              className={`w-36 h-36 rounded-full flex items-center justify-center cursor-pointer shadow-2xl transition transform
                ${isRecording ? "scale-95 ring-8 ring-rose-500/30" : "hover:scale-105"} bg-gradient-to-br from-slate-800 to-slate-700`}
            >
              <div className={`w-24 h-24 rounded-full flex items-center justify-center text-2xl ${isRecording ? "animate-pulse" : ""}`}>
                🎤
              </div>
            </div>
            <p className="mt-4 text-slate-400 text-center">Click the mic to start/stop recording.</p>
          </div>

          <div className="md:w-2/3 bg-slate-900/40 p-4 rounded-lg">
            <h2 className="text-xl font-semibold">Talk. Transcribe. Save.</h2>
            <p className="text-slate-400 text-sm mt-1">
              Record or upload audio — backend returns transcription.
            </p>

            <div className="mt-4 flex items-center gap-3">
              <label className="bg-slate-700 px-3 py-2 rounded cursor-pointer">
                Choose file
                <input onChange={handleFileSelect} type="file" accept="audio/*" className="hidden" />
              </label>

              <button
                disabled={!file || loading}
                onClick={() => uploadAndTranscribe(file)}
                className="bg-emerald-500 px-3 py-2 rounded disabled:opacity-50"
              >
                Upload & Transcribe
              </button>

              <button onClick={() => { setFile(null); setTranscript(""); setError(null); }} className="bg-slate-700 px-3 py-2 rounded">
                Clear
              </button>

              <div className="ml-auto text-sm text-slate-400">{loading ? "Processing..." : ""}</div>
            </div>

            {file && (
              <div className="mt-3 p-2 bg-slate-800/50 rounded">
                <strong>Selected:</strong> {file.name} • {Math.round(file.size / 1024)} KB
              </div>
            )}

            {error && (
              <div className="mt-3 p-2 bg-rose-900/20 rounded text-rose-300">
                <strong>Error:</strong> {error}
              </div>
            )}

            {transcript && (
              <div className="mt-4 border border-slate-700 p-3 rounded bg-slate-800">
                <h3 className="font-semibold">Transcript</h3>
                <pre className="whitespace-pre-wrap mt-2 text-sm">{transcript}</pre>
              </div>
            )}
          </div>
        </section>

        <section className="bg-slate-900/40 p-4 rounded">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold text-lg">History</h3>
            <div>
              <button onClick={loadHistory} className="bg-slate-700 px-3 py-1 rounded">Refresh</button>
            </div>
          </div>

          <div className="mt-3">
            {history.length === 0 ? (
              <div className="text-slate-400">No transcriptions yet. Sign in to save and view history.</div>
            ) : (
              <div className="grid gap-3">
                {history.map((h, i) => (
                  <div key={i} className="p-3 rounded bg-slate-800/60 border border-slate-700">
                    <div className="flex justify-between">
                      <div className="font-medium">{h.title || `Transcription ${i + 1}`}</div>
                      <div className="text-xs text-slate-300">{new Date(h.created_at).toLocaleString()}</div>
                    </div>
                    <div className="mt-2 text-sm">{h.transcript}</div>
                  </div>
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
