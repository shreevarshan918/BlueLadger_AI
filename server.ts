import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc } from "firebase/firestore";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase config from file if it exists
let firebaseApp: any;
let db: any;

try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
    console.log("Firebase initialized on server for logging.");
  }
} catch (err) {
  console.error("Failed to initialize Firebase on server:", err);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // --- BlueLedgerAI Logic ---
  const calculateScore = (vessel: any) => {
    let score = 0;
    const rules = [];

    // Rule 1: LOCATION CHECK (40 points)
    if (vessel.inProtectedZone) {
      score += 40;
      rules.push("Protected Zone Violation");
    }

    // Rule 2: BEHAVIOR CHECK (30 points)
    if (vessel.signalLostDuringFishing) {
      score += 30;
      rules.push("AIS Signal Loss During Fishing");
    }

    // Rule 3: CATCH CHECK (25 points)
    if (vessel.catchRatio >= 3) {
      score += 25;
      rules.push("Overfishing Detected (3x usual catch)");
    }

    let alertLevel = "Normal";
    if (score >= 70) alertLevel = "ALERT Coast Guard";
    else if (score >= 50) alertLevel = "Monitor Carefully";

    return { score, alertLevel, rules };
  };

  // API Endpoints
  app.get("/api/alerts", async (req, res) => {
    try {
      const apiKey = process.env.GFW_API_KEY;
      let vessels = [];
      
      if (apiKey && apiKey !== "YOUR_GFW_API_KEY") {
        try {
          const response = await axios.get("https://gateway.globalfishingwatch.org/v2/vessels", {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 5000
          });
          vessels = response.data.entries || [];
        } catch (apiErr) {
          console.error("GFW API Error:", apiErr);
          vessels = getMockVessels();
        }
      } else {
        vessels = getMockVessels();
      }

      const alerts = await Promise.all(vessels.map(async (v: any) => {
        const analysis = calculateScore(v);
        const alert = {
          vessel_id: v.id || v.mmsi || "Unknown",
          vessel_name: v.name || "Unknown Vessel",
          anomaly_score: analysis.score,
          alert_level: analysis.alertLevel,
          triggered_rules: analysis.rules,
          timestamp: new Date().toISOString(),
          location: v.lastLocation || { lat: 0, lon: 0 }
        };
        
        // Database logging to Firestore
        if (db) {
          try {
            await addDoc(collection(db, "alerts"), alert);
          } catch (dbErr) {
            console.error("Firestore logging error:", dbErr);
          }
        }
        
        return alert;
      }));

      res.json(alerts);
    } catch (error) {
      console.error("Alerts API Error:", error);
      res.status(500).json({ 
        error: "Internal Server Error", 
        message: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`BlueLedgerAI Server running on http://localhost:${PORT}`);
  });
}

function getMockVessels() {
  return [
    {
      id: "V-101",
      name: "Sea Raider",
      inProtectedZone: true,
      signalLostDuringFishing: true,
      catchRatio: 3.5,
      lastLocation: { lat: -3.45, lon: 120.12 }
    },
    {
      id: "V-102",
      name: "Ocean Queen",
      inProtectedZone: false,
      signalLostDuringFishing: true,
      catchRatio: 1.2,
      lastLocation: { lat: 12.34, lon: -45.67 }
    },
    {
      id: "V-103",
      name: "Green Fin",
      inProtectedZone: true,
      signalLostDuringFishing: false,
      catchRatio: 1.5,
      lastLocation: { lat: 45.67, lon: 12.34 }
    }
  ];
}

startServer();
