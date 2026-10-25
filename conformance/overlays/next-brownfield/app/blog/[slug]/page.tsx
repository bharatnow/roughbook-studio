import { notFound } from "next/navigation";
import { PostBody } from "@/components/blog/post-body";
import { PostHeader } from "@/components/blog/post-header";
import { getPost } from "@/lib/posts";

export function generateStaticParams() {
  return [{ slug: "hello-world" }, { slug: "second-post" }];
}

export default async function Post({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  return (
    <article>
      <PostHeader post={post} />
      <PostBody post={post} />
    </article>
  );
}
