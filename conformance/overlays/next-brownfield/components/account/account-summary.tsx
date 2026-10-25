"use client";

import { useAccount } from "./account-context";

// Reads the signed-in account from the account layout's provider.
export function AccountSummary() {
  const account = useAccount();
  return (
    <section className="px-6 py-16">
      <h1 className="text-3xl font-semibold">Hello, {account.name}</h1>
      <p className="mt-2 text-zinc-600">You are on the {account.plan} plan.</p>
    </section>
  );
}
