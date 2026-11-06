"use client";

import { useEffect, useState } from "react";

/** The full share URL (built from this site's origin) with a Copy button. */
export function CopyShareLink({ path }: { path: string }) {
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(`${window.location.origin}${path}`), [path]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (non-HTTPS, old browser): select the text instead.
      const el = document.getElementById("share-url") as HTMLInputElement | null;
      el?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="row">
      <input id="share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 220 }} />
      <button type="button" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <a href={path} target="_blank" rel="noreferrer" className="small">
        Open
      </a>
    </div>
  );
}
