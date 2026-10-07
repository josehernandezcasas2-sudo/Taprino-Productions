// Copying a day happens in the scheduler's draft now and lands with the
// rest of the week through /api/schedule/save. This route can be deleted.
export default function handler(req, res) {
  res.setHeader('Allow', '');
  return res.status(410).json({ error: 'Copy a day in the scheduler and save the week instead.' });
}
