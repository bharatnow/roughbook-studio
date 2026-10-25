import Link from "next/link";
import type { ReactNode } from "react";

export function Button({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center rounded-full bg-emerald-900 px-5 text-sm font-medium text-white"
    >
      {children}
    </Link>
  );
}
