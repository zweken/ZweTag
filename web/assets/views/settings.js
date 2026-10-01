// Settings: label format, theme, project file and about.

import { h, field, textInput, segmented } from "../ui.js";
import * as model from "../model.js";
import { LINKS } from "../about.js";

function section(title, ...children) {
  return h("section", { class: "card settings-section" }, h("h2", {}, title), children);
}

export function render(app) {
  const p = app.project;
  const desktop = app.storage.mode === "desktop";
  const link = (url, text) => h("a", {
    href: url,
    target: "_blank",
    rel: "noopener",
    onclick: (e) => app.openLink(url, e),
  }, text);
  return h("div", { class: "view settings-view" },
    h("div", { class: "view-head" }, h("h1", {}, "Settings")),
    section("Labels",
      field("Room prefix", segmented([
        { value: "auto", label: "Auto" },
        { value: "always", label: "Always" },
        { value: "never", label: "Never" },
      ], p.settings.roomPrefix, (v) => app.act((proj) => model.updateSettings(proj, { roomPrefix: v })), { label: "Room prefix" })),
      field("Cable code prefix", textInput({
        value: p.settings.cablePrefix,
        id: "cable-prefix",
        maxLength: 8,
        className: "input code-input",
        onCommit: (v) => app.act((proj) => model.updateSettings(proj, { cablePrefix: v })),
      })),
    ),
    section("Theme",
      segmented([
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ], p.settings.theme, (v) => app.prefs((proj) => model.updateSettings(proj, { theme: v })), { label: "Theme" }),
    ),
    section("Project",
      h("div", { class: "button-row" },
        h("button", { class: "btn", onclick: () => app.newProject() }, "New"),
        h("button", { class: "btn", onclick: () => app.openFile() }, "Open file…"),
        h("button", { class: "btn", onclick: () => app.saveCopy() }, "Save a copy…"),
        h("button", { class: "btn", onclick: () => app.loadSample() }, "Load sample"),
      ),
      desktop ? field("File", h("code", { class: "path", id: "project-file" }, app.storage.meta.file)) : null,
    ),
    section("About",
      h("p", {}, `ZweTag ${app.version} · Apache-2.0`),
      h("p", {}, "Built by Zweken Technology, makers of Zwetwin."),
      h("p", { class: "links" }, link(LINKS.repo, "github.com/zweken/ZweTag"), " · ", link(LINKS.site, "www.zweken.com")),
    ),
  );
}
