export function LoginForm() {
  return (
    <section className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input type="email" name="email" className="min-h-11 rounded border px-3 text-base" />
        </label>
        <button type="submit" className="min-h-11 rounded bg-emerald-900 text-white">
          Sign in
        </button>
      </form>
    </section>
  );
}
