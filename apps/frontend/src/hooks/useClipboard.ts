import { useCallback, useRef, useState } from "react";

/**
 * Copy text to clipboard with iOS Safari fallback.
 *
 * Primary: navigator.clipboard.writeText (modern browsers).
 * Fallback: hidden textarea + document.execCommand("copy") (iOS Safari, older browsers).
 */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallbackCopyText(text);
  }
}

function fallbackCopyText(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

/**
 * Copy the eventual result of an async operation to the clipboard,
 * safe for iOS Safari.
 *
 * iOS Safari requires navigator.clipboard writes to happen inside the
 * originating user-gesture tick. writeText called after an awaited
 * network fetch silently no-ops — the gesture is gone. The workaround
 * is to hand Safari a ClipboardItem whose payload is a Promise; Safari
 * holds the gesture context for the pending item.
 *
 * Matches the pattern in apps/backend/src/routes/check.ts copy-json-btn.
 */
async function copyToClipboardAsync(getText: () => Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blobPromise = getText().then((t) => new Blob([t], { type: "text/plain" }));
      const item = new ClipboardItem({ "text/plain": blobPromise });
      await navigator.clipboard.write([item]);
      return;
    } catch {
      // Fall through to textarea fallback.
    }
  }
  const text = await getText();
  fallbackCopyText(text);
}

/**
 * Hook for copy-to-clipboard with "Copied!" feedback state.
 *
 * Usage:
 *   const { copy, copyAsync, copied } = useClipboard();
 *
 *   // Sync: text is already in hand.
 *   <button onClick={() => copy(text, "my-label")}>...</button>
 *
 *   // Async: text is fetched after the tap. Use copyAsync so iOS
 *   // Safari keeps the clipboard write inside the user-gesture tick.
 *   <button onClick={() => copyAsync(() => fetchText(), "my-label")}>...</button>
 */
export function useClipboard(timeout = 2000) {
  const [copied, setCopied] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const markCopied = useCallback(
    (label: string) => {
      setCopied(label);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(null), timeout);
    },
    [timeout],
  );

  const copy = useCallback(
    async (text: string, label: string) => {
      await copyToClipboard(text);
      markCopied(label);
    },
    [markCopied],
  );

  const copyAsync = useCallback(
    async (getText: () => Promise<string>, label: string) => {
      await copyToClipboardAsync(getText);
      markCopied(label);
    },
    [markCopied],
  );

  return { copy, copyAsync, copied } as const;
}

export { copyToClipboard, copyToClipboardAsync };
