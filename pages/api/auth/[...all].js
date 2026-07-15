import { toNodeHandler } from 'better-auth/node';
import { auth } from '../../../lib/auth';

// Better Auth reads the raw request body itself, so Next's body parser must be off.
export const config = {
  api: {
    bodyParser: false,
  },
};

export default toNodeHandler(auth.handler);
