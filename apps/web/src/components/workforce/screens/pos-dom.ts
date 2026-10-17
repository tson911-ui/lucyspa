// After a refused submit (client validation), the first field marked invalid takes focus, in the open dialog when there is one,
// otherwise on the page (wig Forms: "focus first error on submit"). Runs after React has drawn the error messages.
export function focusFirstInvalid(): void {
  requestAnimationFrame(() => {
    const scope: ParentNode = document.querySelector('[aria-modal="true"]') ?? document;
    const first = scope.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
  });
}
