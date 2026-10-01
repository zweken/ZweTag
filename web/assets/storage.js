// Where the project lives. Desktop mode: the local ZweTag program serves api/ and keeps the
// project in a file. Browser mode (the online version, or any static server): localStorage.
// All addresses are relative, so the page works under any path.

import { parseProject, serializeProject } from "./model.js";
import { downloadText } from "./ui.js";

const KEY = "zwetag.project.v1";
const API_HEADERS = { "X-ZweTag": "1" };
const SAVE_DELAY = 400;

export const STATUS = {
  saved: "Saved",
  saving: "Saving…",
  failed: "Not saved",
  browser: "Stored in this browser",
};

/**
 * Desktop when api/meta answers like the ZweTag program, browser otherwise. The program only
 * listens on the loopback address, so other hosts are not asked at all.
 */
export async function openStorage() {
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) return new BrowserStorage();
  try {
    const res = await fetch("api/meta", { headers: API_HEADERS, cache: "no-store" });
    const type = res.headers.get("Content-Type") || "";
    if (res.ok && type.includes("application/json")) {
      const meta = await res.json();
      if (meta && meta.app === "ZweTag" && meta.mode === "desktop") return new DesktopStorage(meta);
    }
  } catch {
    // No local program: static hosting or offline.
  }
  return new BrowserStorage();
}

class Storage {
  constructor(status) {
    this.status = status;
    this.conflict = false;
    this.listeners = new Set();
    this.timer = 0;
    this.getProject = null;
  }

  onStatus(fn) {
    this.listeners.add(fn);
  }

  setStatus(status, conflict = false) {
    this.status = status;
    this.conflict = conflict;
    for (const fn of this.listeners) fn(status, conflict);
  }

  /** Saves the project returned by getProject after a short pause; later calls reset the pause. */
  schedule(getProject) {
    this.getProject = getProject;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY);
  }
}

export class DesktopStorage extends Storage {
  constructor(meta) {
    super(STATUS.saved);
    this.mode = "desktop";
    this.meta = meta;
    this.etag = null;
    this.saving = false;
    this.again = false;
  }

  /** The project in the file, or null when there is no file yet. Throws on an invalid file. */
  async load() {
    if (this.meta.exists === false) {
      this.meta.exists = true;
      this.etag = null;
      return null;
    }
    const res = await fetch("api/project", { headers: API_HEADERS, cache: "no-store" });
    if (res.status === 404) {
      this.etag = null;
      return null;
    }
    if (!res.ok) throw new Error(`Cannot read ${this.meta.file}`);
    this.etag = res.headers.get("ETag");
    const project = parseProject(await res.text());
    this.setStatus(STATUS.saved);
    return project;
  }

  async flush(force = false) {
    if (!this.getProject) return;
    if (this.saving) {
      this.again = true;
      return;
    }
    if (this.conflict && !force) return;
    this.saving = true;
    this.setStatus(STATUS.saving);
    try {
      const headers = { ...API_HEADERS, "Content-Type": "application/json" };
      if (force) headers["If-Match"] = "*";
      else if (this.etag) headers["If-Match"] = this.etag;
      const res = await fetch("api/project", { method: "PUT", headers, body: serializeProject(this.getProject()) });
      if (res.status === 204) {
        this.etag = res.headers.get("ETag");
        this.setStatus(STATUS.saved);
      } else if (res.status === 409) {
        this.again = false;
        this.setStatus(STATUS.failed, true);
      } else {
        this.setStatus(STATUS.failed);
      }
    } catch {
      this.setStatus(STATUS.failed);
    } finally {
      this.saving = false;
      if (this.again) {
        this.again = false;
        this.flush();
      }
    }
  }

  /** Writes this version over the one on disk ("Overwrite" after a conflict). */
  overwrite() {
    this.conflict = false;
    return this.flush(true);
  }

  async post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { ...API_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        message = (await res.json()).error || message;
      } catch {
        // Keep the generic message.
      }
      throw new Error(message);
    }
    return res.status === 204 ? null : res.json();
  }

  /** Writes a file into the exports folder next to the project; resolves with its path. */
  async exportFile(name, content) {
    const out = await this.post("api/export", { name, content });
    return out.path;
  }

  reveal(path) {
    return this.post("api/reveal", { path });
  }

  openUrl(url) {
    return this.post("api/open", { url });
  }

  /** Lets the program exit a few seconds after the last page closes. */
  keepAlive() {
    this.alive = new EventSource("api/alive");
  }
}

export class BrowserStorage extends Storage {
  constructor() {
    super(STATUS.browser);
    this.mode = "browser";
    this.meta = null;
  }

  async load() {
    let text = null;
    try {
      text = localStorage.getItem(KEY);
    } catch {
      return null;
    }
    if (!text) return null;
    try {
      return parseProject(text);
    } catch (e) {
      try {
        localStorage.setItem(`${KEY}.unreadable`, text);
      } catch {
        // Nothing more can be kept.
      }
      throw e;
    }
  }

  flush() {
    if (!this.getProject) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.getProject()));
      this.setStatus(STATUS.browser);
    } catch {
      this.setStatus(STATUS.failed);
    }
  }

  async exportFile(name, content) {
    const type = name.endsWith(".csv") ? "text/csv" : "application/json";
    downloadText(name, content, type);
    return null;
  }
}
