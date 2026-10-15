import { useEffect, useState } from 'react';

export const shorten = (value: string) => `${value.slice(0, 8)}…${value.slice(-8)}`;

export function TerminalIcon() {
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="18" rx="4" stroke="currentColor" strokeWidth="1.6" /><path d="m6 9 3 3-3 3m6 0h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** Copies `text` to the clipboard; hidden where the page has no clipboard access (plain HTTP). */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  if (!navigator.clipboard) return null;
  return <button type="button" className="copy-button" aria-label={copied ? 'Copied' : label}
    onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => {})}>{copied ? 'Copied' : 'Copy'}</button>;
}
