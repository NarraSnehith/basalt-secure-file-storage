import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * The form reads `?next=` with useSearchParams, which opts a route out of static
 * prerendering unless it sits behind a Suspense boundary. Keeping the shell as a
 * server component means the page still ships as static HTML and only the form
 * waits for the URL.
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4" aria-busy>
          <div className="skeleton h-8 w-40 rounded-md" />
          <div className="skeleton h-4 w-56 rounded-md" />
          <div className="skeleton h-[2.375rem] rounded-md" />
          <div className="skeleton h-[2.375rem] rounded-md" />
          <div className="skeleton h-10 rounded-md" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
