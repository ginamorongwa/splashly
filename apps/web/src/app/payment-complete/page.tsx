// Paystack sends customers here after checkout (PAYSTACK_CALLBACK_URL).
// The booking itself is marked paid by the paystack-webhook function.
export default function PaymentCompletePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <section className="flex max-w-md flex-col gap-3 rounded-2xl border border-line bg-surface p-6 text-center">
        <h1 className="text-2xl font-extrabold">Thanks! Your payment is being confirmed.</h1>
        <p className="text-muted">You can close this page and go back to the Splashly app. Your booking updates there automatically.</p>
      </section>
    </main>
  );
}
