export function searchPage(req, res) {
  const q = req.query.q || "";
  // reflects user input directly into HTML
  res.send(`<h1>Results for ${q}</h1>`);
}
