import React from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  return (
    <main className="flex flex-col items-center justify-center min-h-screen text-center bg-slate-900 text-white px-4">
      <h1 className="text-5xl font-bold mb-4 text-indigo-400">
        Welcome to Speech<span className="text-white">2Text</span>
      </h1>
      <p className="text-lg text-gray-300 max-w-md mb-8">
        Record or upload audio, get instant transcription, and manage everything
        securely. Powered by Deepgram & Supabase.
      </p>

      <div className="flex gap-4">
        <button
          onClick={() => navigate("/auth")}
          className="px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 font-medium"
        >
          Sign In
        </button>

        <button
          onClick={() => navigate("/")}
          className="px-6 py-3 rounded-lg border border-gray-400 text-gray-300 hover:bg-gray-800"
        >
          Learn More
        </button>
      </div>

      <footer className="mt-10 text-sm text-gray-500">
        Built with ❤️ by Priyanshu | Deepgram × Supabase × React
      </footer>
    </main>
  );
}
