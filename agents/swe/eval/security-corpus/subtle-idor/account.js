// req.user is the authenticated user (set by auth middleware)
export async function getInvoice(req, res, db) {
  const id = req.params.id;
  // looks up by id only — never checks the invoice belongs to req.user
  const invoice = await db.invoices.findById(id);
  if (!invoice) return res.status(404).end();
  res.json(invoice);
}
