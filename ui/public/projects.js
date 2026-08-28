import { call } from "./api.js";
import { clear, el } from "./dom.js";

const app = document.querySelector("#app");

function checksLabel(checks) {
  const failing = [checks?.validate, checks?.links, checks?.continuity].filter((check) => check && !check.ok);
  return failing.length === 0 ? "clean" : `${failing.length} failing`;
}

function row(project, open) {
  return el("tr", { data: { id: project.id }, on: { click: () => open(project) } }, [
    el("td", { text: project.title }),
    el("td", { class: "num", text: String(project.chapters ?? "") }),
    el("td", { class: "num", text: (project.words ?? 0).toLocaleString() }),
    el("td", { text: checksLabel(project.checks) })
  ]);
}

async function open(project) {
  const { openControlRoom } = await import("./control-room.js");
  const next = `chapter-${String((project.chapters ?? 0) + 1).padStart(2, "0")}`;
  // No POV is passed: project.pov is the narrative mode, not a character.
  // The Control Room picks one from the cast.
  openControlRoom(project.id, next, project.characters ?? [], project.harnesses ?? []);
}

export async function render() {
  // This is the app's front door, called bare (see the module-level call
  // below) with no caller of its own left to catch a rejection. An absent
  // or stale token, or any one of the requests below failing, used to reject
  // this promise straight into an unhandled rejection -- the page just
  // stayed blank forever with nothing in it to explain why. Every failure
  // from here on is caught and painted into the page instead.
  try {
    const { projects } = await call("/api/projects");
    const detailed = await Promise.all(projects.map(async (project) => ({
      ...project, ...(await call(`/api/project/${project.id}`))
    })));

    const input = el("input", { name: "path", placeholder: "Paste a project folder path", size: "60" });
    const form = el("form", {
      on: {
        submit: async (event) => {
          event.preventDefault();
          try {
            await call("/api/projects", { method: "POST", body: JSON.stringify({ path: input.value }) });
            render();
          } catch (error) {
            form.append(el("p", { class: "error", text: error.message }));
          }
        }
      }
    }, [input, el("button", { text: "Open" })]);

    clear(app);
    app.append(
      el("h1", { text: "Projects" }),
      form,
      el("table", {}, [
        el("thead", {}, el("tr", {}, ["Novel", "Chapters", "Words", "Checks"].map((label) => el("th", { text: label })))),
        el("tbody", {}, detailed.map((project) => row(project, open)))
      ])
    );
  } catch (error) {
    clear(app);
    app.append(
      el("h1", { text: "Projects" }),
      el("p", { class: "error", text: `Could not load projects: ${error.message}` })
    );
  }
}

render();
