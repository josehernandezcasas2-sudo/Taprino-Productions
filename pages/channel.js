// The old single channel page. TapaTV now lives at /live with the other
// channels; keep old links and bookmarks working.
export async function getServerSideProps() {
  return { redirect: { destination: '/live', permanent: true } };
}

export default function ChannelRedirect() {
  return null;
}
