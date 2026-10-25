import Link from "next/link";
import { Logo } from "@/components/ui/logo";

const LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  { href: "/account", label: "Account" },
];

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
      <Link href="/" aria-label="Harbor home">
        <Logo />
      </Link>
      <nav className="flex gap-6 text-sm">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
