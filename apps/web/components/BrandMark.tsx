/** Small "Carbon vs Silicon" wordmark — the game's identity, shown consistently
 *  on the utility pages (create / host / play / quiz-ready). /screen keeps its
 *  own large hero header. Inherits text alignment from its parent. */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <div className={`leading-none ${className}`}>
      <span className="block text-[0.6rem] font-semibold tracking-[0.25em] text-ably uppercase">
        the Ably Quiz
      </span>
      <span className="mt-1 block text-base font-extrabold tracking-tight text-ink">
        Carbon <span className="font-bold text-neutral-500">vs</span> Silicon
      </span>
    </div>
  );
}
