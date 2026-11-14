// Creator Studio's hub lived here until the Dashboard took its place
// (Jose, 2026-11-14: "yes lets add the sections to the dashboard"). Its
// pieces are on /creator/dashboard now: the shortcuts under Submit a
// title, the drafts with Continue / Discard, what needs the creator, an
// invite to be paid, the titles paid to them.
//
// The address keeps working, with its query: the three steps used to come
// back to /creator?submitted=…, and older notifications and emails point
// at /creator and /creator#get-paid (a browser carries the #… across the
// forward by itself). The Dashboard has its own gate.
export async function getServerSideProps({ req, res, resolvedUrl }) {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  const at = typeof resolvedUrl === 'string' ? resolvedUrl.indexOf('?') : -1;
  const query = at >= 0 ? resolvedUrl.slice(at) : '';
  return { redirect: { destination: `/creator/dashboard${query}`, permanent: false } };
}

export default function CreatorStudioForward() {
  return null;
}
