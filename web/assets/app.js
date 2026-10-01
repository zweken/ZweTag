// ZweTag application shell: top bar, navigation, undo and redo, saving, theme, and the project
// actions shared by the File menu and Settings.

import { h, icon, toast, confirmDialog, pickTextFile } from "./ui.js";
import { openStorage, STATUS } from "./storage.js";
import * as model from "./model.js";
import { sampleProject } from "./sample.js";
import { VERSION } from "./about.js";
import * as racksView from "./views/racks.js";
import * as devicesView from "./views/devices.js";
import * as connectView from "./views/connect.js";
import * as cablesView from "./views/cables.js";
import * as printView from "./views/print.js";
import * as settingsView from "./views/settings.js";

const VIEWS = [
  { key: "racks", name: "Racks", icon: "racks", view: racksView },
  { key: "devices", name: "Devices", icon: "devices", view: devicesView },
  { key: "connect", name: "Connect", icon: "connect", view: connectView },
  { key: "cables", name: "Cables", icon: "cables", view: cablesView },
  { key: "print", name: "Print", icon: "print", view: printView },
];
const SETTINGS = { key: "settings", name: "Settings", icon: "settings", view: settingsView };
const THEME_ICONS = { system: "monitor", light: "sun", dark: "moon" };
const NEXT_THEME = { system: "light", light: "dark", dark: "system" };

class App {
  constructor(root) {
    this.root = root;
    this.state = {};
    this.selection = new Set();
    this.ixCache = null;
  }

  async start() {
    this.storage = await openStorage();
    let project = null;
    let loadError = "";
    try {
      project = await this.storage.load();
    } catch (e) {
      loadError = e.message;
    }
    this.history = new model.History(project || model.newProject());
    this.version = this.storage.meta ? this.storage.meta.version : VERSION;
    this.buildShell();
    this.storage.onStatus(() => this.renderStatus());
    if (this.storage.mode === "desktop") this.storage.keepAlive();
    window.addEventListener("hashchange", () => this.render());
    document.addEventListener("keydown", (e) => this.onKey(e));
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    if (!location.hash) history.replaceState(null, "", "#/" + (this.project.rooms.length ? "connect" : "racks"));
    this.render();
    if (loadError) toast(loadError, { kind: "error" });
  }

  get project() {
    return this.history.project;
  }

  /** Lookup tables for the current project state. */
  index() {
    if (!this.ixCache || this.ixCache.project !== this.project || this.ixCache.stamp !== this.history.index) {
      this.ixCache = { project: this.project, stamp: this.history.index, ix: model.indexProject(this.project) };
    }
    return this.ixCache.ix;
  }

  viewKey() {
    const key = location.hash.replace(/^#\/?/, "");
    return [...VIEWS, SETTINGS].some((v) => v.key === key) ? key : "racks";
  }

  navigate(key) {
    if (this.viewKey() === key) this.render();
    else location.hash = "#/" + key;
  }

  viewState(key, defaults) {
    if (!this.state[key]) this.state[key] = defaults();
    return this.state[key];
  }

  /**
   * Runs a model change: records an undo step, saves and redraws. A rule violation shows its
   * message and leaves the project as it was. Returns fn's result, or undefined on a violation.
   */
  act(fn) {
    let result;
    try {
      result = this.history.apply(fn);
    } catch (e) {
      if (!(e instanceof model.ModelError)) throw e;
      this.ixCache = null;
      toast(e.message, { kind: "error" });
      this.render();
      return undefined;
    }
    this.changed();
    return result;
  }

  /** Changes a preference (theme, label layout) without an undo step. */
  prefs(fn) {
    try {
      this.history.patchPreferences(fn);
    } catch (e) {
      if (!(e instanceof model.ModelError)) throw e;
      toast(e.message, { kind: "error" });
    }
    this.changed();
  }

  changed() {
    this.ixCache = null;
    this.pruneSelection();
    this.storage.schedule(() => this.history.project);
    this.render();
  }

  pruneSelection() {
    if (this.selection.size === 0) return;
    const ids = new Set(this.project.cables.map((c) => c.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
  }

  undo() {
    if (this.history.undo()) this.changed();
  }

  redo() {
    if (this.history.redo()) this.changed();
  }

  // -------------------------------------------------------------------------------------------
  // Project actions

  isEmpty() {
    return this.project.rooms.length === 0;
  }

  async replaceProject(next, { keepLayout = true } = {}) {
    if (!this.isEmpty() && !(await confirmDialog("Replace the current project?", { ok: "Replace", danger: true }))) {
      return;
    }
    next.settings.theme = this.project.settings.theme;
    if (keepLayout) next.settings.label = this.project.settings.label;
    this.history.project = next;
    this.history.commit();
    this.selection.clear();
    this.state = {};
    this.changed();
  }

  newProject() {
    return this.replaceProject(model.newProject());
  }

  loadSample() {
    return this.replaceProject(sampleProject());
  }

  async openFile() {
    const text = await pickTextFile();
    if (text === null) return;
    let next;
    try {
      next = model.parseProject(text);
    } catch (e) {
      if (!(e instanceof model.ModelError)) throw e;
      toast(e.message, { kind: "error" });
      return;
    }
    await this.replaceProject(next, { keepLayout: false });
  }

  saveCopy() {
    const base = this.project.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "zwetag";
    const name = this.storage.mode === "desktop" ? `${base}.json` : "zwetag.json";
    return this.exportText(name, model.serializeProject(this.project));
  }

  /** CSV and copies: a download in the browser, a file in exports/ on the desktop. */
  async exportText(name, content) {
    try {
      const path = await this.storage.exportFile(name, content);
      if (path) {
        toast(`Saved to ${path}`, {
          actions: [{ label: "Show in folder", run: () => this.storage.reveal(path).catch((e) => toast(e.message, { kind: "error" })) }],
        });
      }
    } catch (e) {
      toast(e.message, { kind: "error" });
    }
  }

  openLink(url, event) {
    if (this.storage.mode !== "desktop") return;
    event.preventDefault();
    this.storage.openUrl(url).catch((e) => toast(e.message, { kind: "error" }));
  }

  // -------------------------------------------------------------------------------------------
  // Shell

  buildShell() {
    this.nameInput = h("input", {
      class: "project-name",
      id: "project-name",
      spellcheck: false,
      autocomplete: "off",
      "aria-label": "Project name",
    });
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.nameInput.blur();
      if (e.key === "Escape") {
        this.nameInput.value = this.project.name;
        this.nameInput.blur();
      }
    });
    this.nameInput.addEventListener("change", () => {
      const value = this.nameInput.value;
      if (value.trim() === "") this.nameInput.value = this.project.name;
      else if (value !== this.project.name) this.act((p) => model.setProjectName(p, value));
    });
    this.statusEl = h("span", { class: "save-status", id: "save-status" });
    this.undoBtn = h("button", { class: "icon-btn", title: "Undo (Ctrl+Z)", "aria-label": "Undo", onclick: () => this.undo() }, icon("undo"));
    this.redoBtn = h("button", { class: "icon-btn", title: "Redo (Ctrl+Y)", "aria-label": "Redo", onclick: () => this.redo() }, icon("redo"));
    this.themeBtn = h("button", {
      class: "icon-btn",
      "aria-label": "Theme",
      onclick: () => this.prefs((p) => model.updateSettings(p, { theme: NEXT_THEME[p.settings.theme] })),
    });
    this.fileMenu = this.buildFileMenu();
    this.conflictBar = h("div", { class: "conflict-bar hidden", role: "alert" },
      h("span", {}, "The file changed on disk."),
      h("button", { class: "btn small", onclick: () => this.reloadFromDisk() }, "Reload"),
      h("button", { class: "btn small", onclick: () => this.storage.overwrite() }, "Overwrite"),
    );
    const topbar = h("header", { class: "topbar" },
      h("div", { class: "brand" },
        h("img", { class: "brand-lockup on-light", src: "brand/lockup/lockup.svg", alt: "ZweTag", draggable: false }),
        h("img", { class: "brand-lockup on-dark", src: "brand/lockup/lockup-dark.svg", alt: "ZweTag", draggable: false }),
      ),
      this.nameInput,
      this.statusEl,
      h("div", { class: "spacer" }),
      this.undoBtn,
      this.redoBtn,
      this.themeBtn,
      this.fileMenu,
    );
    this.navLinks = new Map();
    const link = (v) => {
      const a = h("a", { class: "nav-link", href: `#/${v.key}` }, icon(v.icon), h("span", {}, v.name));
      this.navLinks.set(v.key, a);
      return a;
    };
    const nav = h("nav", { class: "sidenav", "aria-label": "Sections" },
      VIEWS.map(link),
      h("div", { class: "spacer" }),
      link(SETTINGS),
    );
    this.main = h("main", { class: "main", id: "main" });
    this.root.replaceChildren(topbar, nav, h("div", { class: "content" }, this.conflictBar, this.main));
    this.setupWindow(topbar);
  }

  /**
   * In the desktop program on Windows the page fills a frameless window and gets the functions
   * zwetagWindow, zwetagMinimize, zwetagMaximize, zwetagClose, zwetagDrag and zwetagResize. The
   * top bar is then the window caption: it moves the window, a double click maximizes it, and it
   * carries the window buttons; thin handles along the border resize the window.
   */
  setupWindow(topbar) {
    if (typeof window.zwetagWindow !== "function") return;
    const root = document.documentElement;
    root.classList.add("app-window");
    const maxButton = h("button", { class: "win-btn", tabIndex: -1 });
    const setState = (state) => {
      const max = Boolean(state && state.maximized);
      root.toggleAttribute("data-maximized", max);
      maxButton.replaceChildren(icon(max ? "win-restore" : "win-max", 15));
      maxButton.title = max ? "Restore" : "Maximize";
      maxButton.setAttribute("aria-label", maxButton.title);
    };
    const toggle = () => window.zwetagMaximize().then(setState);
    maxButton.addEventListener("click", toggle);
    topbar.append(h("div", { class: "win-ctl" },
      h("button", { class: "win-btn", tabIndex: -1, title: "Minimize", "aria-label": "Minimize", onclick: () => window.zwetagMinimize() }, icon("win-min", 15)),
      maxButton,
      h("button", { class: "win-btn close", tabIndex: -1, title: "Close", "aria-label": "Close", onclick: () => window.zwetagClose() }, icon("close", 15)),
    ));
    // The native move loop holds the mouse until the button goes up, so a double click is
    // recognized here from two presses instead of from the dblclick event.
    let last = { t: -1000, x: 0, y: 0 };
    topbar.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest("button, input, select, a, .menu")) return;
      e.preventDefault();
      const now = performance.now();
      if (now - last.t < 450 && Math.abs(e.clientX - last.x) < 5 && Math.abs(e.clientY - last.y) < 5) {
        last = { t: -1000, x: 0, y: 0 };
        toggle();
        return;
      }
      last = { t: now, x: e.clientX, y: e.clientY };
      window.zwetagDrag();
    });
    for (const edge of ["top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"]) {
      const handle = h("div", { class: "win-edge", dataset: { edge } });
      handle.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        window.zwetagResize(edge);
      });
      document.body.append(handle);
    }
    let timer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(timer);
      timer = setTimeout(() => window.zwetagWindow().then(setState), 100);
    });
    window.zwetagWindow().then(setState);
  }

  buildFileMenu() {
    const items = [
      ["New", () => this.newProject()],
      ["Open file…", () => this.openFile()],
      ["Save a copy…", () => this.saveCopy()],
      ["Load sample", () => this.loadSample()],
    ];
    const list = h("div", { class: "menu hidden", role: "menu" },
      items.map(([label, run]) => h("button", { class: "menu-item", role: "menuitem", onclick: () => { close(); run(); } }, label)));
    const button = h("button", { class: "btn ghost", "aria-haspopup": "menu", "aria-expanded": "false" },
      icon("file", 16), h("span", {}, "File"), icon("chevron", 14));
    const wrap = h("div", { class: "menu-wrap" }, button, list);
    const close = () => {
      list.classList.add("hidden");
      button.setAttribute("aria-expanded", "false");
    };
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = list.classList.toggle("hidden") === false;
      button.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
    return wrap;
  }

  async reloadFromDisk() {
    try {
      const project = await this.storage.load();
      this.storage.conflict = false;
      this.history.reset(project || model.newProject());
      this.selection.clear();
      this.changedWithoutSave();
    } catch (e) {
      toast(e.message, { kind: "error" });
    }
  }

  changedWithoutSave() {
    this.ixCache = null;
    this.render();
  }

  applyTheme() {
    const theme = this.project.settings.theme;
    const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    this.themeBtn.replaceChildren(icon(THEME_ICONS[theme]));
    this.themeBtn.title = `Theme: ${theme[0].toUpperCase()}${theme.slice(1)}`;
  }

  renderStatus() {
    this.statusEl.textContent = this.storage.status;
    this.statusEl.className = this.storage.status === STATUS.failed ? "save-status bad" : "save-status";
    this.conflictBar.classList.toggle("hidden", !this.storage.conflict);
  }

  /** Redraws the top bar state and the current view, keeping focus and scroll where they were. */
  render() {
    const key = this.viewKey();
    const entry = [...VIEWS, SETTINGS].find((v) => v.key === key);
    if (document.activeElement !== this.nameInput) this.nameInput.value = this.project.name;
    this.undoBtn.disabled = !this.history.canUndo;
    this.redoBtn.disabled = !this.history.canRedo;
    for (const [k, a] of this.navLinks) {
      a.classList.toggle("active", k === key);
      if (k === key) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    this.applyTheme();
    this.renderStatus();
    document.title = `${this.project.name} - ZweTag`;

    const focus = document.activeElement && document.activeElement.id && this.main.contains(document.activeElement)
      ? { id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
      : null;
    const scroll = this.lastKey === key ? this.main.scrollTop : 0;
    this.lastKey = key;
    const el = entry.view.render(this);
    this.main.replaceChildren(el);
    this.main.scrollTop = scroll;
    if (focus) {
      const again = document.getElementById(focus.id);
      if (again) {
        again.focus();
        try {
          if (focus.start !== null && focus.start !== undefined) again.setSelectionRange(focus.start, focus.end);
        } catch {
          // Inputs without a text selection (number, checkbox).
        }
      }
    }
    if (entry.view.mounted) entry.view.mounted(this, el);
  }

  onKey(e) {
    const target = e.target;
    const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && !typing && e.code === "KeyY") {
      e.preventDefault();
      this.redo();
      return;
    }
    const entry = [...VIEWS, SETTINGS].find((v) => v.key === this.viewKey());
    if (entry.view.keydown) entry.view.keydown(this, e, typing);
  }
}

const app = new App(document.getElementById("app"));
app.start();
