/** The faceted V uses the same geometry as the application icon. */
export default function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      aria-hidden="true"
    >
      <rect x="18" y="18" width="988" height="988" rx="227" fill="#292724" />
      <path d="M226 274 397 334 474 777 356 556Z" fill="#bb724f" />
      <path d="M397 334 486 535 474 777Z" fill="#80442d" />
      <path d="M486 535 780 252 650 600 474 777Z" fill="#e6b08b" />
      <path d="M780 252 665 298 486 535Z" fill="#c78660" />
      <path d="M226 274 397 334 342 389Z" fill="#f2cfab" />
    </svg>
  );
}
