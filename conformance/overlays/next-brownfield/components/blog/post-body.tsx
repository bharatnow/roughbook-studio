import type { Post } from "@/lib/posts";

export function PostBody({ post }: { post: Post }) {
  return (
    <div className="px-6 py-8 text-zinc-700">
      {post.body.split("\n\n").map((paragraph) => (
        <p key={paragraph} className="mt-4">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
