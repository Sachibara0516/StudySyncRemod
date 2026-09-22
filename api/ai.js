function getBearerToken(header = "") {
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] || "";
}

async function verifySupabaseUser(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !token) return null;

  const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  return response.json();
}

function extractOutputText(payload) {
  const chunks = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content?.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const token = getBearerToken(req.headers.authorization || "");
  const user = await verifySupabaseUser(token);
  if (!user?.id) return res.status(401).json({ error: "Authentication required." });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) return res.status(503).json({ error: "AI assistance is not configured." });

  const prompt = String(req.body?.prompt || "").trim().slice(0, 8000);
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        instructions: "You are StudySync's academic assistant. Be concise, accurate, age-appropriate, and do not invent sources or grades.",
        input: prompt
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("OpenAI request failed:", response.status, payload?.error?.message || payload);
      return res.status(502).json({ error: "AI assistance is temporarily unavailable." });
    }

    const text = extractOutputText(payload);
    return res.status(200).json({ text: text || "No response." });
  } catch (error) {
    console.error("AI proxy error:", error);
    return res.status(502).json({ error: "AI assistance is temporarily unavailable." });
  }
}
