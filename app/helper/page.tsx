export default function HelperPage() {
  return (
    <main className="max-w-md mx-auto p-4 flex flex-col gap-4">
      <h1 className="text-3xl font-bold">Helper</h1>
      <p className="text-base text-neutral-600 dark:text-neutral-300">
        Sign in with your phone to go on duty.
      </p>
      <input
        type="tel"
        name="phone"
        aria-label="Phone number"
        autoComplete="tel"
        inputMode="tel"
        placeholder="+91 98765 43210"
        className="w-full min-h-12 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-500 dark:placeholder:text-neutral-400 px-4 text-base"
      />
      <button
        type="button"
        className="w-full min-h-12 rounded-xl bg-red-600 text-white text-base font-semibold hover:bg-red-700 active:bg-red-800"
      >
        Send code
      </button>
    </main>
  );
}
