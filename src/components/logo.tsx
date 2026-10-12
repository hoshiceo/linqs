import Image from "next/image";

export default function Logo({ small = false }: { small?: boolean }) {
  return <span className={`brand${small ? " brand-small" : ""}`} aria-hidden={small || undefined}>
    <Image
      src={small ? "/brand/linqs-symbol.svg" : "/brand/linqs-logo.svg"}
      alt={small ? "" : "Linqs"}
      width={small ? 512 : 1732}
      height={512}
      unoptimized
      loading="eager"
    />
  </span>;
}
