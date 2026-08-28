// Every string rendered here -- titles, fact statements, drafted prose --
// comes out of project markdown, which this page does not control. The page
// also holds a token that can spawn processes and write files, and it is
// reachable from the tailnet. So nothing is ever assigned to innerHTML:
// injection here would be privilege escalation, not defacement.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (key === "text") {
      node.textContent = value;
    } else if (key === "on") {
      for (const [event, handler] of Object.entries(value)) {
        node.addEventListener(event, handler);
      }
    } else if (key === "data") {
      for (const [name, item] of Object.entries(value)) {
        node.dataset[name] = item;
      }
    } else {
      node.setAttribute(key, value);
    }
  }

  for (const child of [].concat(children)) {
    node.append(child);
  }

  return node;
}

export function clear(node) {
  while (node.firstChild) {
    node.firstChild.remove();
  }
}
