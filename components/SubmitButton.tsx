"use client";

import { useFormStatus } from "react-dom";

/** A submit button for server-action forms that shows it's working while the action runs. */
export function SubmitButton({
  children,
  pendingText,
  className,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`${className ?? ""}${pending ? " is-pending" : ""}`} disabled={pending} aria-busy={pending} name={name} value={value}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
