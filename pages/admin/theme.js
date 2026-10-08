// Folded into Styles & Guides (2026-10-08). Kept so old links and
// bookmarks still land somewhere useful.
export async function getServerSideProps() {
  return { redirect: { destination: '/admin/styles?tab=colors', permanent: false } };
}
export default function Redirect() { return null; }
