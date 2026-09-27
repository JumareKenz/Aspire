/** Calls an admin API and unwraps `{ data }`, turning `{ error }` into a thrown Error with its message. */
export async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: { message?: string } }
    | null;
  if (!response.ok || !payload || payload.data === undefined) {
    throw new Error(payload?.error?.message ?? `The request failed (${response.status}).`);
  }
  return payload.data;
}

/** Saves text as a file in the browser. */
export function saveText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function toCsv(rows: Array<Array<string | number | null>>): string {
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
