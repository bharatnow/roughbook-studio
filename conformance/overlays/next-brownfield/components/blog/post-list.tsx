import Link from "next/link";
import { listPosts } from "@/lib/posts";

export function PostList() {
  return (
    <section className="px-6 py-16">
      <h1 className="text-3xl font-semibold">Blog</h1>
      <ul className="mt-6 space-y-4">
        {listPosts().map((post) => (
          <li key={post.slug}>
            <Link href={`/blog/${post.slug}`}>{post.title}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
