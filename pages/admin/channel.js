// The old TapaTV loop editor. Every channel's loop is edited in the
// scheduler now.
export async function getServerSideProps() {
  return { redirect: { destination: '/schedule?channel=tapatv&view=loop', permanent: false } };
}

export default function ChannelLoopMoved() {
  return null;
}
