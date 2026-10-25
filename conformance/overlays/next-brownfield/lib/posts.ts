export type Post = { slug: string; title: string; date: string; body: string };

const POSTS: Post[] = [
  {
    slug: "hello-world",
    title: "Hello, world",
    date: "2026-10-01",
    body: "Harbor is open.\n\nThis is its first post.",
  },
  {
    slug: "second-post",
    title: "What we learned",
    date: "2026-10-15",
    body: "Plans change.\n\nWrite them down anyway.",
  },
];

export function listPosts(): Post[] {
  return POSTS;
}

export function getPost(slug: string): Post | null {
  return POSTS.find((post) => post.slug === slug) ?? null;
}
