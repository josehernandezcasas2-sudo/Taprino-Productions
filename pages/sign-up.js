import Head from 'next/head';
import AuthForm from '../components/AuthForm';
import { getServerSession } from '../lib/get-session';

export async function getServerSideProps({ req }) {
  const session = await getServerSession(req);
  if (session?.user) {
    return { redirect: { destination: '/', permanent: false } };
  }
  return { props: {} };
}

export default function SignUp() {
  return (
    <>
      <Head>
        <title>Create account · Taprino Transmission</title>
      </Head>
      <AuthForm mode="sign-up" />
    </>
  );
}
