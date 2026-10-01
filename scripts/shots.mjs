#!/usr/bin/env node
// Builds ZweTag, runs it with --server on a temporary project file, plays a short scenario in a real
// browser and saves the README screenshots to docs/screenshots/. Fails when the scenario does not
// behave as expected or when the browser console shows an error.
//
// The page is given stand-ins for the functions the Windows window provides (zwetagWindow and the
// others), so the screenshots show the program as it looks in its own window, and the window
// buttons, the caption drag and the resize handles are checked. A second page without them checks
// that a plain browser shows no window buttons.
//
//   node scripts/shots.mjs
//
// Playwright (with its Chromium) is loaded from the folder named by ZWETAG_PLAYWRIGHT when it is
// set (a folder whose node_modules holds playwright, or the playwright package itself), otherwise
// through the normal module lookup.

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
const VIEWPORT = { width: 1440, height: 900 };

async function loadPlaywright() {
  const dir = process.env.ZWETAG_PLAYWRIGHT;
  if (!dir) return import("playwright");
  const require = createRequire(join(resolve(dir), "package.json"));
  try {
    return require("playwright");
  } catch {
    return require(resolve(dir));
  }
}

function check(condition, message) {
  if (!condition) throw new Error(`scenario: ${message}`);
  console.log(`ok  ${message}`);
}

function startServer(binary, file) {
  return new Promise((done, failed) => {
    const child = spawn(binary, ["--server", "--addr", "127.0.0.1:0", "--file", file], { stdio: ["ignore", "pipe", "pipe"] });
    let seen = "";
    const timer = setTimeout(() => failed(new Error(`ZweTag did not start:\n${seen}`)), 15000);
    const read = (chunk) => {
      seen += chunk;
      const m = /listening on (http:\/\/\S+)/.exec(seen);
      if (m) {
        clearTimeout(timer);
        done({ child, url: m[1].endsWith("/") ? m[1] : `${m[1]}/` });
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => failed(new Error(`ZweTag exited (${code}):\n${seen}`)));
  });
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "zwetag-shots-"));
  const binary = join(tmp, process.platform === "win32" ? "zwetag.exe" : "zwetag");
  const build = spawnSync("go", ["build", "-o", binary, "./cmd/zwetag"], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) throw new Error("go build failed");
  const projectFile = join(tmp, "zwetag.json");
  const { child, url } = await startServer(binary, projectFile);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, colorScheme: "light" });
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const calls = [];
      let maximized = false;
      window.zwetagCalls = calls;
      window.zwetagWindow = async () => ({ maximized });
      window.zwetagMinimize = async () => { calls.push("minimize"); };
      window.zwetagMaximize = async () => { maximized = !maximized; calls.push("maximize"); return { maximized }; };
      window.zwetagClose = async () => { calls.push("close"); };
      window.zwetagDrag = async () => { calls.push("drag"); };
      window.zwetagResize = async (edge) => { calls.push(`resize:${edge}`); };
    });
    const calls = () => page.evaluate(() => window.zwetagCalls.splice(0));
    const go = async (view) => {
      await page.goto(`${url}#/${view}`);
      await page.waitForSelector(".view");
    };
    const shot = async (name) => {
      await page.evaluate(() => {
        document.querySelectorAll(".toast").forEach((t) => t.remove());
        if (document.activeElement) document.activeElement.blur();
      });
      await page.mouse.move(2, 2);
      await page.waitForTimeout(250);
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: join(OUT, name) });
      console.log(`    saved docs/screenshots/${name}`);
    };
    const count = (selector) => page.locator(selector).count();
    const connect = async (n) => {
      await page.fill("#pending-count", String(n));
      await page.press("#pending-count", "Enter");
      await page.click("#connect-button");
      await page.waitForSelector(".toast-text");
      return page.locator(".toast-text").last().textContent();
    };

    await go("racks");
    check((await page.textContent("#save-status")).trim() !== "", "desktop mode reports the save state");

    // The frameless window: buttons, caption drag, double click, resize handles.
    check(await count(".win-ctl .win-btn") === 3, "window buttons in the top bar");
    await page.click(".win-btn[title=Minimize]");
    await page.click(".win-btn[title=Maximize]");
    await page.waitForSelector(".win-btn[title=Restore]");
    check((await page.getAttribute("html", "data-maximized")) !== null, "maximize turns into restore");
    await page.click(".win-btn[title=Restore]");
    await page.waitForSelector(".win-btn[title=Maximize]");
    const spot = await page.locator(".topbar .spacer").boundingBox();
    await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2);
    await page.waitForTimeout(500);
    await page.click("#project-name");
    await page.mouse.dblclick(spot.x + spot.width / 2, spot.y + spot.height / 2);
    await page.waitForSelector(".win-btn[title=Restore]");
    check(await page.locator(".win-edge:visible").count() === 0, "no resize handles while maximized");
    await page.click(".win-btn[title=Restore]");
    await page.waitForSelector(".win-btn[title=Maximize]");
    const edge = await page.locator(".win-edge[data-edge=bottom-right]").boundingBox();
    await page.mouse.click(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.waitForTimeout(200);
    const seen = (await calls()).join(" ");
    check(seen === "minimize maximize maximize drag drag maximize maximize resize:bottom-right",
      `window calls: ${seen}`);
    await page.click("#load-sample");
    await page.waitForSelector(".rack-card");
    check(await count(".rack-card") === 2, "sample has two racks");

    // Two more racks in the same room.
    await page.locator(".room").first().locator("button:has-text('Rack')").click();
    await page.locator(".room").first().locator("button:has-text('Rack')").click();
    check(await count(".rack-card") === 4, "two racks added");

    // Devices: a patch panel and a switch in A03, a patch panel in A04.
    await go("devices");
    await page.click(".chip:has-text('A03')");
    await page.selectOption("#add-type", "patch-panel");
    await page.click("#add-device");
    await page.selectOption("#add-type", "switch");
    await page.click("#add-device");
    await page.click(".chip:has-text('A04')");
    await page.selectOption("#add-type", "patch-panel");
    await page.click("#add-device");
    check(await count(".rack-dev") === 1, "patch panel added to A04");

    // Bulk connect 24 ports, panel to switch, in one rack.
    await go("connect");
    await page.selectOption("#rack-a", { label: "A03" });
    await page.selectOption("#rack-b", { label: "A03" });
    await page.click(".panel[data-side=b] .rack-dev:has-text('Switch')");
    await page.click(".panel[data-side=a] .port[data-port='1']");
    await page.click(".panel[data-side=b] .port[data-port='1']");
    check((await connect(24)) === "24 cables added", "24 cables added in one rack");
    check(await count("svg.wires path.wire") === 24, "24 lines drawn");

    // Rear of the panel to the rear of the panel in the next rack.
    await page.selectOption("#rack-b", { label: "A04" });
    await page.click(".panel[data-side=a] .seg:has-text('Rear')");
    await page.click(".panel[data-side=b] .seg:has-text('Rear')");
    await page.click(".panel[data-side=a] .port[data-port='1']");
    await page.click(".panel[data-side=b] .port[data-port='1']");
    check((await connect(24)) === "24 cables added", "24 rear cables between two racks");
    await page.hover(".panel[data-side=a] .port[data-port='12']");
    await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(OUT, "connect.png") });
    console.log("    saved docs/screenshots/connect.png");

    // A taken port blocks Connect with its reason.
    await page.click(".panel[data-side=a] .seg:has-text('Front')");
    await page.click(".panel[data-side=a] .port[data-port='3']");
    await page.click(".panel[data-side=b] .seg:has-text('Front')");
    await page.click(".panel[data-side=b] .port[data-port='3']");
    await page.selectOption("#rack-b", { label: "A03" });
    await page.click(".panel[data-side=b] .rack-dev:has-text('Switch')");
    await page.click(".panel[data-side=b] .port[data-port='30']");
    check(await page.isDisabled("#connect-button"), "Connect is off for a taken port");
    check((await page.textContent("#connect-reason")) === "Port 3 on A03-42 is in use", "the reason names the taken port");
    await page.keyboard.press("Escape");

    // Move a device: its labeled cables ask for a new label.
    await go("devices");
    await page.click(".chip:has-text('A01')");
    await page.click(".rack-dev:has-text('U40')");
    await page.fill("#edit-u", "38");
    await page.press("#edit-u", "Enter");
    await page.waitForSelector(".rack-dev:has-text('U38')");
    await go("cables");
    check(await count(".badge.warn") === 6, "6 labeled cables now need a new label");
    await shot("cables.png");

    // Devices page for the README: rack A01 with a unit picked for the next device.
    await go("devices");
    await page.click(".chip:has-text('A01')");
    await page.click(".rack-slot[data-u='30']");
    await page.selectOption("#add-type", "server");
    await shot("devices.png");

    // Print preview of the labels that are needed.
    await go("print");
    const summary = await page.textContent(".print-summary");
    check(/^\d+ labels · \d+ pages?$/.test(summary.trim()), `print preview: ${summary.trim()}`);
    check(await count("#print-preview .sheet-label") > 0, "labels in the preview");
    await shot("print.png");

    // CSV export into exports/ next to the project file.
    await go("cables");
    await page.click("#cables-csv");
    await page.waitForSelector(".toast-text:has-text('Saved to')");
    const csvPath = join(tmp, "exports", "zwetag-cables.csv");
    check(existsSync(csvPath), "Cables CSV written to exports/");
    check(readFileSync(csvPath, "utf8").startsWith(String.fromCharCode(0xfeff) + "code,end_a,end_b"), "CSV has the header");

    // Undo the move: the relabel marks go away again.
    await page.click("button[aria-label=Undo]");
    await page.waitForTimeout(200);
    check(await count(".badge.warn") === 0, "undo restores the labels");

    // Saved to the project file.
    await page.waitForFunction(() => document.querySelector("#save-status").textContent === "Saved");
    const saved = JSON.parse(readFileSync(projectFile, "utf8"));
    check(saved.cables.length === 14 + 48, "project file holds every cable");

    // Dark theme.
    await page.click("button[aria-label=Theme]");
    await page.click("button[aria-label=Theme]");
    check((await page.getAttribute("html", "data-theme")) === "dark", "dark theme");
    await go("connect");
    await page.selectOption("#rack-a", { label: "A01" });
    await page.selectOption("#rack-b", { label: "A01" });
    await page.click(".panel[data-side=b] .rack-dev:has-text('Switch')");
    await page.hover(".panel[data-side=a] .port[data-port='5']");
    await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
    await page.waitForFunction(() => document.querySelector("#save-status").textContent === "Saved");
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(OUT, "connect-dark.png") });
    console.log("    saved docs/screenshots/connect-dark.png");

    // A plain browser has no window functions: no window buttons, no resize handles.
    const plain = await browser.newPage({ viewport: VIEWPORT });
    plain.on("pageerror", (e) => errors.push(e.message));
    await plain.goto(`${url}#/racks`);
    await plain.waitForSelector(".view");
    check(await plain.locator(".win-ctl, .win-edge").count() === 0, "a plain browser shows no window buttons");
    await plain.close();

    check(errors.length === 0, `browser console has no errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  } finally {
    await browser.close();
    const exited = new Promise((done) => child.once("exit", done));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))]);
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
