"use client";

import { createContext, useContext, type ReactNode } from "react";

type Account = { name: string; plan: string };

const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount must be used inside the account layout");
  return account;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  return (
    <AccountContext.Provider value={{ name: "Dana", plan: "Team" }}>{children}</AccountContext.Provider>
  );
}
