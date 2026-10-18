import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card card-pad mx-auto max-w-lg text-center">
      <h1 className="text-2xl">We couldn&rsquo;t find that page</h1>
      <p className="mt-2 text-sm text-ink-soft">It may have moved, or the product is no longer in our catalogue.</p>
      <div className="mt-4 flex justify-center gap-3"><Link href="/" className="btn-primary">Home</Link><Link href="/products" className="btn-secondary">Products</Link></div>
    </div>
  );
}
