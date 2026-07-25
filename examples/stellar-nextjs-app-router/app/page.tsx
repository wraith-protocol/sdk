import StealthDashboard from './components/StealthDashboard';

// This page is a Server Component — it renders on the server and is
// prerendered/statically analyzed at build time. It imports a hook-using
// child (StealthDashboard) without needing "use client" itself, which is
// exactly the composition Next.js App Router expects from a hooks package.
export default function Page() {
  return (
    <main style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
      <h1>Wraith Stellar — Next.js App Router</h1>
      <p>
        This heading and paragraph render on the server with no client JavaScript. The panel below
        is the client boundary that uses <code>@wraith-protocol/sdk-react</code> hooks.
      </p>
      <StealthDashboard />
    </main>
  );
}
