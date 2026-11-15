import Image from "next/image";

export default function Logo({ small = false }: { small?: boolean }) {
  return <span className={`brand${small ? " brand-small" : ""}`} aria-hidden={small || undefined}>
    <Image
      src={small ? "/brand/linqs-symbol.svg" : "/brand/linqs-logo.svg"}
      alt={small ? "" : "LINQS"}
      width={small ? 512 : 2158}
      height={512}
      unoptimized
      loading="eager"
    />
  </span>;
}
