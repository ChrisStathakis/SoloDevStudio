import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || process.env.FRONTEND_PORT || 3000);
// Also support --port CLI arg (used by some launchers)
const portArg = process.argv.find((a, i) => a === "--port" && process.argv[i + 1]);
const CLI_PORT = portArg ? Number(process.argv[process.argv.indexOf("--port") + 1]) : NaN;
const EFFECTIVE_PORT = Number.isFinite(CLI_PORT) ? CLI_PORT : PORT;

app.use(express.json());

// Quiet favicon 404 log spam and serve 204 if file missing
app.get("/favicon.ico", (_req, res) => {
  const icoPath = path.join(process.cwd(), "public", "favicon.ico");
  const distIco = path.join(process.cwd(), "dist", "favicon.ico");
  const svgPath = path.join(process.cwd(), "public", "favicon.svg");
  // express.static / vite middlewares will serve it if exists; this is fallback
  res.sendFile(icoPath, (err) => {
    if (err) res.sendFile(distIco, (e2) => {
      if (e2) res.sendFile(svgPath, (e3) => {
        if (e3) res.status(204).end();
      });
    });
  });
});

// Helper to get GoogleGenAI client lazily
function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({ 
    status: "ok", 
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) 
  });
});

// Grounded Market & Competitor Research for Idea
app.post("/api/market-research", async (req, res) => {
  try {
    const { title, tagline, problem, solution, category } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Idea title is required" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: "GEMINI_API_KEY is not set. Please add it to your environment or AI Studio Secrets panel.",
      });
    }

    const ai = getGenAIClient();

    const prompt = `You are a startup and product market intelligence specialist for solo developers and indie hackers.
Perform a deep, up-to-date market validation and competitor analysis using Google Search for the following app concept:

Title: ${title}
Tagline: ${tagline || "N/A"}
Category: ${category || "General Software"}
Problem: ${problem || "N/A"}
Solution: ${solution || "N/A"}

Please perform live Google Searches to find current existing tools, competitors, market demand, and trends.
Structure your response in clear, concise JSON with the following schema:
{
  "marketSummary": "2-3 sentences overview of the current market state and opportunity.",
  "competitors": [
    {
      "name": "Competitor Name",
      "description": "What they do",
      "pricing": "e.g. Free, $15/mo, Enterprise",
      "differentiationOpportunity": "How this solo developer can differentiate / win"
    }
  ],
  "targetAudience": "Specific niche user segment to target first",
  "suggestedMvpFeatures": [
    "Feature 1 - High leverage",
    "Feature 2",
    "Feature 3"
  ],
  "monetizationIdeas": [
    "Option 1",
    "Option 2"
  ],
  "feasibilityRating": 4, // integer 1-5 for a solo developer
  "marketDemandRating": 4, // integer 1-5
  "keyRisks": [
    "Risk 1",
    "Risk 2"
  ],
  "actionableNextSteps": [
    "Step 1",
    "Step 2",
    "Step 3"
  ]
}

Return ONLY valid JSON (enclosed in markdown codeblock or raw JSON).`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.7,
      },
    });

    const rawText = response.text || "";
    let parsedData = null;

    try {
      // Extract JSON if wrapped in ```json ... ```
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, rawText];
      parsedData = JSON.parse(jsonMatch[1] || rawText);
    } catch {
      parsedData = {
        marketSummary: rawText,
        competitors: [],
        suggestedMvpFeatures: [],
        monetizationIdeas: [],
        actionableNextSteps: [],
        feasibilityRating: 4,
        marketDemandRating: 4,
      };
    }

    // Extract Google Search grounding metadata
    const candidate = response.candidates?.[0];
    const groundingMetadata = candidate?.groundingMetadata;
    const groundingChunks = groundingMetadata?.groundingChunks || [];
    const webSearchQueries = groundingMetadata?.webSearchQueries || [];

    const sources = groundingChunks
      .filter((chunk: any) => chunk?.web?.uri)
      .map((chunk: any) => ({
        title: chunk.web.title || chunk.web.uri,
        url: chunk.web.uri,
      }));

    return res.json({
      data: parsedData,
      rawAnalysis: rawText,
      sources,
      searchQueries: webSearchQueries,
    });
  } catch (error: any) {
    console.error("Error running market research:", error);
    return res.status(500).json({
      error: error?.message || "Failed to generate market research.",
    });
  }
});

// Grounded Tech Stack & Architecture Advisor
app.post("/api/tech-stack-research", async (req, res) => {
  try {
    const { title, category, description, currentTechStack } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Project or idea title is required" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: "GEMINI_API_KEY is not set. Please add it to your environment or AI Studio Secrets panel.",
      });
    }

    const ai = getGenAIClient();

    const prompt = `You are a principal software architect and tech lead for solo creators and lean teams.
Search the web with Google Search for modern, trending, and battle-tested tech stacks, developer tools, boilerplates, and open-source libraries for:

Project: ${title}
Category: ${category || "Web App"}
Description: ${description || "N/A"}
Current Tech Stack: ${(currentTechStack || []).join(", ") || "None specified"}

Provide recommendations formatted as JSON:
{
  "summary": "Brief architectural guidance for a solo developer.",
  "recommendedStack": [
    {
      "layer": "Frontend / Backend / Database / Auth / Hosting / AI",
      "tool": "Tool name",
      "why": "Why it is optimal for solo dev velocity and low overhead"
    }
  ],
  "trendingLibraries": [
    {
      "name": "Library / Package Name",
      "purpose": "What it accelerates"
    }
  ],
  "potentialPitfalls": [
    "Pitfall 1 to avoid"
  ]
}

Return ONLY valid JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.7,
      },
    });

    const rawText = response.text || "";
    let parsedData = null;

    try {
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, rawText];
      parsedData = JSON.parse(jsonMatch[1] || rawText);
    } catch {
      parsedData = {
        summary: rawText,
        recommendedStack: [],
        trendingLibraries: [],
        potentialPitfalls: [],
      };
    }

    const candidate = response.candidates?.[0];
    const groundingMetadata = candidate?.groundingMetadata;
    const groundingChunks = groundingMetadata?.groundingChunks || [];
    const webSearchQueries = groundingMetadata?.webSearchQueries || [];

    const sources = groundingChunks
      .filter((chunk: any) => chunk?.web?.uri)
      .map((chunk: any) => ({
        title: chunk.web.title || chunk.web.uri,
        url: chunk.web.uri,
      }));

    return res.json({
      data: parsedData,
      sources,
      searchQueries: webSearchQueries,
    });
  } catch (error: any) {
    console.error("Error running tech stack research:", error);
    return res.status(500).json({
      error: error?.message || "Failed to analyze tech stack.",
    });
  }
});

// Vite middleware & Static serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(EFFECTIVE_PORT, "0.0.0.0", () => {
    console.log(`SoloDev Studio server running on http://0.0.0.0:${EFFECTIVE_PORT}`);
  });
}

startServer();
