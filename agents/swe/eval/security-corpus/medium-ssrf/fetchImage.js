export async function fetchImage(req, res) {
  const target = req.query.url;            // attacker-controlled
  const r = await fetch(target);           // no allowlist / scheme / IP checks
  res.setHeader("content-type", r.headers.get("content-type") || "");
  res.end(Buffer.from(await r.arrayBuffer()));
}
