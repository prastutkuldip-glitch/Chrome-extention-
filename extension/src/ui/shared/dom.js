/**
 * Tiny DOM helpers. No framework: the whole UI is a handful of screens, and a
 * build step would cost more than it saves (and reviewers get readable source).
 */

/**
 * @param {string} tag optionally with classes: `div.card.card-pad`
 * @param {Object} [props] `text`, `html`, `class`, `dataset`, `style`, `on`, or any attribute
 * @param {Array|Node|string} [children]
 */
export function el(tag, props = {}, children = []) {
  const [name, ...classes] = String(tag).split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = [node.className, value].filter(Boolean).join(' ');
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'on') for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
    else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = Boolean(value);
    else node.setAttribute(key, value);
  }

  append(node, children);
  return node;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node?.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

/** Replace a node's children in one go. */
export function render(node, children) {
  if (!node) return node;
  clear(node);
  return append(node, children);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API can refuse without a user gesture; fall back to a textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    area.remove();
    return ok;
  }
}

export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept = '.json') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
    document.body.append(input);
    input.click();
  });
}

let toastTimer = null;

export function toast(message, kind = 'info') {
  let host = qs('#toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host' });
    document.body.append(host);
  }
  render(host, el(`div.toast.toast-${kind}`, { text: message }));
  host.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.classList.remove('show'), 2600);
}

/** Escape-to-close, click-outside-to-close modal. */
export function modal({ title, body, actions = [], onClose }) {
  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    onClose?.();
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };

  const panel = el('div.modal-panel', {}, [
    el('div.modal-head', {}, [
      el('h2', { text: title }),
      el('button.btn.btn-ghost.btn-icon', { text: '\u00d7', title: 'Close', on: { click: close } }),
    ]),
    el('div.modal-body', {}, body),
    actions.length ? el('div.modal-foot', {}, actions) : null,
  ]);

  const backdrop = el('div.modal-backdrop', {
    on: {
      click: (event) => {
        if (event.target === backdrop) close();
      },
    },
  }, panel);

  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  return { close, panel };
}
