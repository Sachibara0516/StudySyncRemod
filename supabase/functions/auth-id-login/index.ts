Deno.serve(() => new Response(JSON.stringify({ error: "Legacy login disabled." }), {
  status: 410,
  headers: { "Content-Type": "application/json" }
}));