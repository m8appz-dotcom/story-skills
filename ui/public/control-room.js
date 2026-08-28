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
  // harness table so the table in harness.js stays the only place a
  // provider is named. Each entry is { name, packetOnly, sees } -- see
  // ui/harness.js's harnessInfo().
  const pov = el("select", {}, characters.map((item) => el("option", { value: item.id, text: item.name })));
  const harness = el("select", {}, harnesses.map((info) => el("option", { value: info.name, text: info.name })));

  // A <select> change event hands back only the chosen value, so the honest
  // phrase for that harness is looked up here rather than carried on the
  // <option> itself. This is the disclosure the whole feature is for: what a
  // harness can see beyond the packet, shown before the writer presses
  // Draft, for whichever harness is currently selected.
  const isolationByHarness = new Map(harnesses.map((info) => [info.name, info.sees]));
  const isolation = el("span", { id: "isolation", text: isolationByHarness.get(harness.value) ?? "" });
  harness.addEventListener("change", () => {
    isolation.textContent = isolationByHarness.get(harness.value) ?? "";
  });

  const draft = el("div", { id: "draft" });
  const note = el("span", { id: "note", text: "nothing has changed yet" });
  const accept = el("button", { text: "Accept", disabled: "disabled" });
  const reject = el("button", { text: "Reject", disabled: "disabled" });
  const side = el("div", { class: "side" });

  // The id of the candidate the most recent completed draft produced. This is
  // the only thing (besides `chapter`, fixed for this room) accept/reject
  // send to the engine. Null whenever there is nothing to decide on: before
  // the first draft, while one is running, and once a decision has gone
  // through -- in every one of those states Accept/Reject are also disabled,
  // so the two stay in lockstep.
  let candidate = null;

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

  // Shared by both buttons: same endpoint shape, same disable/report
  // choreography, differing only in which route and verb apply.
  async function decide(action) {
    // Disabled for the request's duration -- the same reasoning as Draft
    // below. A candidate can only be resolved once, so a second click before
    // the first response lands must never reach the engine as a second
    // accept or reject.
    accept.setAttribute("disabled", "disabled");
    reject.setAttribute("disabled", "disabled");
    try {
      const receipt = await call(`/api/project/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ chapter, candidate })
      });
      // The receipt names how many files the engine actually touched --
      // that says what happened; "done" would not. Both buttons stay
      // disabled: the candidate is now resolved, and there is nothing left
      // to accept or reject a second time.
      note.textContent = `${action === "accept" ? "Accepted" : "Rejected"}: ${receipt.changed.length} file(s) changed`;
    } catch (error) {
      // Both actions validate fully before writing anything (see
      // ui/server.js), so a 409 refusal here has touched nothing -- the
      // candidate is exactly as decidable as it was before this click.
      // Re-enable both rather than stranding the writer with two dead
      // buttons, and never report success for a request that failed.
      note.textContent = error.message;
      accept.removeAttribute("disabled");
      reject.removeAttribute("disabled");
    }
  }

  accept.addEventListener("click", () => decide("accept"));
  reject.addEventListener("click", () => decide("reject"));

  const go = el("button", {
    text: "Draft",
    on: {
      click: async () => {
        draft.textContent = "";
        // Draft is disabled for the run's duration: two quick clicks used to
        // fire two concurrent streams sharing this one handler, both
        // appending into `draft` and racing to enable Accept over text that
        // matched neither candidate file on disk. Accept/Reject are reset
        // here too, along with the candidate id they would act on, so a
        // previous run's enabled buttons -- and the candidate they pointed
        // at -- can never survive into a run they know nothing about.
        candidate = null;
        go.setAttribute("disabled", "disabled");
        accept.setAttribute("disabled", "disabled");
        reject.setAttribute("disabled", "disabled");
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
                candidate = event.candidate;
                accept.removeAttribute("disabled");
                reject.removeAttribute("disabled");
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
      el("p", { class: "actions" }, [harness, isolation, go, accept, reject, note])
    ]),
    side
  ]));

  await showKnowledge();
}
