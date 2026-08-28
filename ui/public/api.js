// The token arrives once in the URL and lives in sessionStorage from then on,
// so it is never a cookie and never forgeable from another origin.
const fromUrl = new URL(location.href).searchParams.get("t");
if (fromUrl) {
  sessionStorage.setItem("story-token", fromUrl);
  history.replaceState({}, "", location.pathname);
}

const token = () => sessionStorage.getItem("story-token") ?? "";

export async function call(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.headers ?? {}), "X-Story-Token": token(), "content-type": "application/json" }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  return body;
}

export async function stream(path, payload, onEvent) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "X-Story-Token": token(), "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    carry += decoder.decode(value, { stream: true });
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim() !== "") {
        onEvent(JSON.parse(line));
      }
    }
  }
}
