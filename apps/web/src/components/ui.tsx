// Shared building blocks for the dashboard.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>{children}</section>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" };

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const styles = {
    primary: "bg-brand text-on-brand border-brand",
    secondary: "bg-surface text-foreground border-line",
    danger: "bg-surface text-danger border-line",
  }[variant];
  return (
    <button
      className={`min-h-11 rounded-xl border px-4 text-sm font-bold disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold text-muted">{label}</span>
      <input
        className="min-h-11 rounded-xl border border-line bg-surface px-3 text-base text-foreground outline-none focus:border-brand"
        {...input}
      />
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex min-h-14 items-center gap-4">
      <div className="flex-1">
        <div className="text-sm font-semibold">{label}</div>
        {hint ? <div className="text-xs text-muted">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`flex h-7 w-12 shrink-0 rounded-full p-0.5 transition ${checked ? "justify-end bg-brand" : "justify-start bg-line"}`}>
        <span className="h-6 w-6 rounded-full bg-white shadow" />
      </button>
    </div>
  );
}

export function Badge({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "warning" | "danger" }) {
  const styles = {
    info: "bg-brand-soft text-brand",
    success: "bg-brand-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-warning-soft text-danger",
  }[tone];
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${styles}`}>{children}</span>;
}
