import type { ReactNode } from "react";

export function AdminFilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--space-sm)",
        alignItems: "flex-end",
        padding: "var(--space-md) var(--space-lg)",
        background: "var(--color-surface-container-lowest)",
      }}
    >
      {children}
    </div>
  );
}

interface LabeledFieldProps {
  label: string;
  children: ReactNode;
}

export function AdminField({ label, children }: LabeledFieldProps) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "2px",
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: "0.7rem",
        fontWeight: 500,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--color-on-surface-variant)",
      }}
    >
      {label}
      {children}
    </label>
  );
}

interface BaseFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
}

export function AdminTextInput({ value, onChange, placeholder }: BaseFieldProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: "var(--color-surface-container-lowest)",
        border: "none",
        borderBottom: "2px solid var(--color-outline-variant)",
        color: "var(--color-on-surface)",
        fontSize: "0.875rem",
        padding: "0.4rem 0.5rem",
        outline: "none",
        borderRadius: 0,
        fontFamily: "inherit",
        textTransform: "none",
        letterSpacing: "normal",
      }}
    />
  );
}

interface SelectOption {
  value: string;
  label: string;
}

interface AdminSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}

export function AdminSelect({ value, onChange, options }: AdminSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--color-surface-container-lowest)",
        border: "none",
        borderBottom: "2px solid var(--color-outline-variant)",
        color: "var(--color-on-surface)",
        fontSize: "0.875rem",
        padding: "0.4rem 0.5rem",
        outline: "none",
        borderRadius: 0,
        fontFamily: "inherit",
        textTransform: "none",
        letterSpacing: "normal",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
