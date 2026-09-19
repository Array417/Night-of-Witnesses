export function announce(message: string): void {
  const liveStatus = document.getElementById('live-status');
  if (liveStatus) {
    liveStatus.textContent = '';
    // Brief timeout ensures screen readers detect text replacement
    setTimeout(() => {
      liveStatus.textContent = message;
    }, 50);
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (val === undefined || val === false) continue;
    if (val === true) {
      element.setAttribute(key, '');
    } else {
      element.setAttribute(key, val);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else if (child) {
      element.appendChild(child);
    }
  }
  return element;
}

export function showInlineAlert(
  container: HTMLElement,
  message: string,
  type: 'danger' | 'warning' | 'success' = 'danger'
): HTMLElement {
  // Clear any existing alert in the container
  const existing = container.querySelector('[role="alert"]');
  if (existing) {
    existing.remove();
  }

  const alertEl = el(
    'div',
    {
      role: 'alert',
      class: `alert alert-${type}`,
      tabindex: '-1',
    },
    [message]
  );

  container.prepend(alertEl);
  alertEl.focus();
  announce(message);
  return alertEl;
}
