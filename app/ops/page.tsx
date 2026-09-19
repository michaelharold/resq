export default function OpsPage() {
  return (
    <main className="max-w-md mx-auto p-4 flex flex-col gap-4">
      <h1 className="text-3xl font-bold">Coordinator</h1>
      <p className="text-base text-neutral-600 dark:text-neutral-300">
        Enter the ops password.
      </p>
      <input
        type="password"
        name="password"
        aria-label="Ops password"
        autoComplete="current-password"
        placeholder="Password"
        className="w-full min-h-12 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 dark:placeholder:text-neutral-400 px-4 text-base"
      />
      <button
        type="button"
        className="w-full min-h-12 rounded-xl bg-red-600 text-white text-base font-semibold hover:bg-red-700 active:bg-red-800"
      >
        Open dashboard
      </button>
    </main>
  );
}
