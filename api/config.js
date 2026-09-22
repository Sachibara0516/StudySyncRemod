export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";
  const allowOfflineDemo = String(process.env.STUDYSYNC_ALLOW_OFFLINE_DEMO || "true").toLowerCase() === "true";

  res.status(200).json({
    configured: Boolean(supabaseUrl && supabasePublishableKey),
    supabaseUrl,
    supabasePublishableKey,
    allowOfflineDemo
  });
}
