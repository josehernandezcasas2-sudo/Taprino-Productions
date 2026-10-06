// The old day-of-week schedule became TapaTV's default schedule, which the
// scheduler edits.
export async function getServerSideProps() {
  return { redirect: { destination: '/schedule?channel=tapatv&view=default', permanent: false } };
}

export default function WeeklyScheduleMoved() {
  return null;
}
