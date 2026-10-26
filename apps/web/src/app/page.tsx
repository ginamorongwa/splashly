import Link from "next/link";

const customerPoints = [
  ["Find washes near you", "See nearby outlets with prices, ratings and distance, then book a free slot."],
  ["At the outlet or at your door", "Book a bay, walk in, or have mobile washers come to your home or office."],
  ["Pay your way", "Card, instant EFT, scan to pay, cash on the day, or a transfer straight to the outlet."],
];

const outletPoints = [
  ["Your own booking page", "List services, prices, photos and opening hours in minutes."],
  ["A calendar that fills itself", "Bookings are placed in a free bay or mobile team automatically, with buffers and travel time."],
  ["Get paid", "Accept online payments or share your bank details for direct transfers."],
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-12 sm:px-8">
      <header className="flex items-center justify-between">
        <span className="text-xl font-extrabold">Splashly</span>
        <Link href="/login" className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-bold">
          Outlet login
        </Link>
      </header>

      <section className="flex flex-col gap-5">
        <h1 className="max-w-2xl text-4xl font-extrabold leading-tight sm:text-5xl">
          Car washes, booked in a tap.
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Splashly connects drivers with car wash outlets and mobile washers across South Africa.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/login?signup=1" className="rounded-xl bg-brand px-5 py-3 font-bold text-on-brand">
            List your car wash
          </Link>
          <span className="rounded-xl border border-line px-5 py-3 font-bold text-muted">Customer app: coming soon</span>
        </div>
      </section>

      <section className="grid gap-10 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-extrabold">For drivers</h2>
          {customerPoints.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-line bg-surface p-5">
              <h3 className="font-bold">{title}</h3>
              <p className="text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-extrabold">For car wash outlets</h2>
          {outletPoints.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-line bg-surface p-5">
              <h3 className="font-bold">{title}</h3>
              <p className="text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="text-sm text-muted">
        © 2026 Splashly, by Morongwa Software Solutions (MSS)
      </footer>
    </main>
  );
}
