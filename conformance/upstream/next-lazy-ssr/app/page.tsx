import { Header } from "./components/header";
import { loaders } from "./registry";

// Loads the module ?m= names through the registry and renders it on the server.
export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const load = m ? loaders[m] : undefined;
  const Module = load ? (await load()).default : null;
  return (
    <main>
      <Header />
      {Module ? <Module /> : <p>no module</p>}
    </main>
  );
}
