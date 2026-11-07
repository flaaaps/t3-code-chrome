/**
 * Keep key presses inside the extension's UI away from GitHub's keyboard shortcuts (`?`, `t`, `.`,
 * …). Events leaving a shadow root are retargeted to the host, so GitHub's "is the user typing in
 * a field?" check sees a plain `<div>` instead of our `<textarea>` and runs its shortcuts. Stopping
 * the events at the host keeps them from reaching GitHub's listeners on `document`. The extension's
 * own handlers sit inside the shadow tree or in the capture phase on `document`, so they still run.
 */
export function isolateKeyboard(host: HTMLElement): void {
  const stop = (event: Event) => event.stopPropagation();
  for (const type of ["keydown", "keypress", "keyup"]) host.addEventListener(type, stop);
}
