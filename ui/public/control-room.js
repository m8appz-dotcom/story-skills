import { call, stream } from "./api.js";
import { clear, el } from "./dom.js";

const app = document.querySelector("#app");

// Field names verified against a real projection rather than assumed. The
// shape is: { pov, knowledge: { knows, believes, suspects, doubts,
// misbelieves }, excluded: { facts, reason } }, where each knowledge entry is
// { fact, statement, learned-in, confidence?, source? } and excluded.facts is
// a count, not a list -- the redaction is visible as a redaction.
function list(items) {
  return items.length === 0
    ? el("ul", {}, el("li", { class: "empty", text: "nothing recorded" }))
    : el("ul", {}, items.map((item) => el("li", {}, [
      el("span", { text: item.statement }),
      ...(item.confidence ? [el("span", { class: "confidence", text: ` (${item.confidence})` })] : [])
    ])));
}

function grid(projection, povName) {
  const knowledge = projection.knowledge ?? {};
  const held = (knowledge.believes ?? []).concat(knowledge.suspects ?? []);

  return el("aside", { class: "knowledge" }, [
    el("p", {
      class: "withheld",
      text: `${projection.excluded?.facts ?? 0} facts withheld from this POV`
    }),
    el("h3", { text: "Knows" }),
    list(knowledge.knows ?? []),
    el("h3", { text: "Believes / suspects" }),
    list(held),
    // Doubts and misbelieves get their own sections rather than folding into
    // "Believes / suspects": a misbelief is a POV character confidently
    // holding something false, which is exactly the state a writer must not
    // mistake for "believes" while drafting -- it needs to stay legible as
    // its own category, not blended into one that reads as merely uncertain.
    el("h3", { text: "Doubts" }),
    list(knowledge.doubts ?? []),
    el("h3", { text: "Misbelieves" }),
    list(knowledge.misbelieves ?? []),
    el("h3", { text: "Must not happen" }),
    el("p", {
      class: "constraint",
      text: `${povName} must not learn, infer, or be told anything beyond this.`
    })
  ]);
}

export async function openControlRoom(id, chapter, characters, harnesses) {
  // Both lists come from the server: the cast for the POV picker, and the
  // harness names so the table in harness.js stays the only place a provider
  // is named.
  const pov = el("select", {}, characters.map((item) => el("option", { value: item.id, text: item.name })));
  const harness = el("select", {}, harnesses.map((name) => el("option", { text: name })));

  const draft = el("div", { id: "draft" });
  const note = el("span", { id: "note", text: "nothing has changed yet" });
  const accept = el("button", { text: "Accept", disabled: "disabled" });
  const side = el("div", { class: "side" });

  async function showKnowledge() {
    clear(side);
    try {
      const projection = await call(`/api/project/${id}/context?chapter=${chapter}&pov=${pov.value}`);
      side.append(grid(projection, pov.selectedOptions[0]?.textContent ?? pov.value));
    } catch (error) {
      side.append(el("p", { class: "error", text: error.message }));
    }
  }

  // Changing POV changes what may be written, so the grid reloads with it.
  pov.addEventListener("change", showKnowledge);

  const go = el("button", {
    text: "Draft",
    on: {
      click: async () => {
        draft.textContent = "";
        // Draft is disabled for the run's duration: two quick clicks used to
        // fire two concurrent streams sharing this one handler, both
        // appending into `draft` and racing to enable Accept over text that
        // matched neither candidate file on disk. Accept is reset here too,
        // so a previous run's enabled Accept can never sit there enabled
        // while a run it knows nothing about is still in flight.
        go.setAttribute("disabled", "disabled");
        accept.setAttribute("disabled", "disabled");
        try {
          await stream(`/api/project/${id}/draft`,
            { chapter, pov: pov.value, harness: harness.value },
            (event) => {
              if (event.type === "chunk") {
                draft.textContent += event.text;
              }
              if (event.type === "error") {
                note.textContent = event.text;
              }
              if (event.type === "done") {
                accept.removeAttribute("disabled");
                note.textContent = `${event.words} words drafted, nothing accepted yet`;
              }
            });
        } catch (error) {
          // stream() throws on an HTTP-level failure (401 token no longer
          // valid, 404 project no longer registered) that never opens the
          // ndjson stream at all. Without this the failure was swallowed:
          // the button looked dead with no message and Accept never enabled.
          note.textContent = error.message;
        } finally {
          go.removeAttribute("disabled");
        }
      }
    }
  });

  clear(app);
  app.append(el("div", { class: "room" }, [
    el("section", { class: "prose" }, [
      el("h2", { text: chapter }),
      el("p", { class: "actions" }, [el("label", { text: "POV" }), pov]),
      draft,
      el("p", { class: "actions" }, [harness, go, accept, note])
    ]),
    side
  ]));

  await showKnowledge();
}
