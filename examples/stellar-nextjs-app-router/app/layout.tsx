import type { ReactNode } from 'react';

export const metadata = {
  title: 'Wraith Stellar — Next.js App Router',
  description:
    'Demonstrates @wraith-protocol/sdk-react hooks inside a Next.js Server Component tree.',
};

// This is a Server Component: it renders on the server with no "use client"
// pragma and never touches the DOM. It only ever imports server-safe code.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>{children}</body>
    </html>
  );
}
