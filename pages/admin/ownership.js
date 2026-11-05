// Series ownership moved into Admin → Shows (the series revamp, slice 3a):
// who runs a show is on that show's page, the roster is the Creators tab.
// Kept so old links and bookmarks still land somewhere useful.
export async function getServerSideProps() {
  return { redirect: { destination: '/admin/shows', permanent: false } };
}
export default function Redirect() { return null; }
