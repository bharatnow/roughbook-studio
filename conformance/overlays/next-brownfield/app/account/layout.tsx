import { AccountProvider } from "@/components/account/account-context";

export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return <AccountProvider>{children}</AccountProvider>;
}
