import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth';

// Reads the Better Auth session from a Pages Router request (getServerSideProps
// or an API route). Returns the session object or null.
export async function getServerSession(req) {
  try {
    return await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  } catch (err) {
    console.error('getServerSession error:', err.message);
    return null;
  }
}
