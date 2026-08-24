import type { UserRow } from '../db/types.js';

export interface AuthContext {
  user: UserRow;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      /** Present once requireAuth / optionalAuth has run and a session resolved. */
      auth?: AuthContext;
    }
    interface Locals {
      requestId?: string;
    }
  }
}
