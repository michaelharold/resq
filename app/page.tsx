export default function RequesterPage() {
  return (
    <main className="max-w-md mx-auto p-4 flex flex-col gap-4">
      <h1 className="text-3xl font-bold">ResQ</h1>
      <p className="text-base text-neutral-600 dark:text-neutral-300">
        Skilled neighbours, dispatched in seconds.
      </p>
      <textarea
        name="description"
        aria-label="Describe the emergency"
        placeholder="What's happening? Where are you?"
        className="w-full min-h-32 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 dark:placeholder:text-neutral-400 p-4 text-base"
      />
      <button
        type="button"
        className="w-full min-h-14 rounded-xl bg-red-600 text-white text-lg font-semibold hover:bg-red-700 active:bg-red-800"
      >
        Get help
      </button>
    </main>
  );
}
