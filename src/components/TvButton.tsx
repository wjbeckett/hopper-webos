import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export function TvButton({
  children,
  className = "",
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      data-tv-focusable="true"
      className={`tv-button ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
