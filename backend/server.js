// server.js (ES module)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => res.send("backend up"));

app.post("/api/transcribe", (req, res) => {
  console.log("/api/transcribe called", req.body);
  res.json({ transcript: "fake transcript (dev)", raw: req.body });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

import cors from "cors";
import express from "express";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://speech-text-project.vercel.app"
  ],
  credentials: true,
}));
app.use(express.json());
