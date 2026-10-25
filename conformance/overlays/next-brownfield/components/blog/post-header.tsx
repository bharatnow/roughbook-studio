import type { Post } from "@/lib/posts";

export function PostHeader({ post }: { post: Post }) {
  return (
    <header className="px-6 pt-16">
      <h1 className="text-3xl font-semibold">{post.title}</h1>
      <p className="mt-2 text-sm text-zinc-500">{post.date}</p>
    </header>
  );
}
