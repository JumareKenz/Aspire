'use client';

import { useSyncExternalStore } from 'react';
import { cn } from '../primitives/cn';

export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'aspire-theme';

/**
 * The script that runs before first paint.
 *
 * Injected into the document head so the stored choice is applied before the
 * browser renders anything. Without it a viewer who chose dark would see a
 * flash of light on every navigation — the reason theme switching so often
 * feels cheap.
 *
 * It deliberately does not consult `prefers-color-scheme`: the product's
 * default experience is light, and dark is an explicit choice.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t)}else{document.documentElement.setAttribute('data-theme','light')}}catch(e){document.documentElement.setAttribute('data-theme','light')}})();`;

/**
 * The current theme lives on the document element, not in React state — the
 * pre-paint script sets it before React exists. It is therefore an external
 * store, and `useSyncExternalStore` is the primitive for reading one: it keeps
 * the component in step without a mount effect that sets state, and it gives
 * a server snapshot so hydration cannot mismatch.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** The server always renders the default experience. */
function getServerSnapshot(): Theme {
  return 'light';
}

/**
 * Switches between the two themes and remembers the choice.
 *
 * A single button rather than a three-way control: with light as the product
 * default there is no "system" state to represent, and one control with a
 * clear current-state icon is quicker to read than a segmented set.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function apply(next: Theme) {
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private browsing can refuse storage; the theme still applies for this
      // session, it simply will not be remembered.
    }
  }

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => apply(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--ink-100)] hover:text-[var(--text-primary)]',
        className,
      )}
    >
      <span>
        {theme === 'dark' ? (
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
            <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M8 1.4v1.7M8 12.9v1.7M14.6 8h-1.7M3.1 8H1.4M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2M12.7 12.7l-1.2-1.2M4.5 4.5 3.3 3.3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
            <path
              d="M13.5 9.7A5.9 5.9 0 0 1 6.3 2.5a5.9 5.9 0 1 0 7.2 7.2Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
    </button>
  );
}
