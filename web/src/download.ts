// A Blob and an anchor: no server round trip, and the file never leaves the browser.
export function downloadText(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // The browser has started reading the Blob by the time a task later; a revoke right away can cancel the save.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
