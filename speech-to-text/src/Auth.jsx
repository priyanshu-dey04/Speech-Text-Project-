import React, { useState, useRef } from "react";

export default function Auth({ onSignIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const emailRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault(); // ✅ stops page reload (main cause of cursor bug)
    try {
      console.log("Signing in:", email);
      // your auth logic here (e.g. Supabase signIn)
      onSignIn?.(email);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen text-white bg-slate-900">
      <h1 className="text-3xl font-bold mb-6">Sign In</h1>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 w-full max-w-sm bg-slate-800 p-6 rounded-2xl shadow-lg"
      >
        <label className="flex flex-col">
          <span className="mb-1">Email</span>
          <input
            ref={emailRef}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            className="px-3 py-2 rounded-md text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>

        <label className="flex flex-col">
          <span className="mb-1">Password</span>
          <input
            type="password"
            placeholder="********"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="px-3 py-2 rounded-md text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>

        <button
          type="submit"
          className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-md"
        >
          Sign In
        </button>

        <button
          type="button"
          onClick={() => {
            setEmail("");
            setPassword("");
            emailRef.current?.focus(); // ✅ keeps focus when you clear
          }}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          Clear
        </button>
      </form>
    </main>
  );
}
