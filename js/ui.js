// Small helpers shared by the views.

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const announcerEl = typeof document !== 'undefined' ? document.getElementById('announcer') : null;

/** Polite screen-reader announcement. */
export function announce(message) {
  if (!announcerEl) return;
  announcerEl.textContent = '';
  setTimeout(() => { announcerEl.textContent = message; }, 50);
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Only http(s) links become clickable; anything else is shown as plain text. */
export function linkHtml(url, label) {
  const text = esc(label ?? url);
  if (!/^https?:\/\//i.test(String(url ?? '').trim())) return text;
  return `<a href="${esc(String(url).trim())}" target="_blank" rel="noopener noreferrer">${text}<span class="visually-hidden"> (opens in a new tab)</span></a>`;
}

/** Saves text as a file on this device (nothing is uploaded). */
export function downloadFile(fileName, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Today's date on this device, as YYYY-MM-DD in the device's own time zone. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One-shot request for where focus should land after the next page change. */
export const nav = { focus: null };
