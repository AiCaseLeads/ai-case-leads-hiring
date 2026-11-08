import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const fields = [
  { path: "_systemfield_name", title: "First name", type: "String" },
  { path: "portfolio", title: "Portfolio", type: "Url" },
  { path: "brief", title: "Describe your role", type: "String" },
  { path: "experience", title: "Describe your experience", type: "LongText", minWords: 3 },
];

test("public application restricts paste to non-narrative fields", async t => {
  const { outputFiles } = await build({
    stdin: {
      contents: `import React from "react"; import { createRoot } from "react-dom/client";
        import { ApplicationForm } from "./components/careers/form";
        createRoot(document.querySelector("main")).render(<ApplicationForm
          job={{id:"example",title:"Example role"}} fields={${JSON.stringify(fields)}} enabled={true}/>);`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, format: "iife", jsx: "automatic",
  });
  const server = createServer((req, res) => {
    if (req.url === "/form.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(outputFiles[0].text);
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><main></main><script src="/form.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const base = "http://127.0.0.1:" + server.address().port;

  for (const width of [1280, 390]) {
    await t.test(`clipboard and editing at ${width}px`, async () => {
      const context = await browser.newContext({
        viewport: { width, height: 840 }, hasTouch: width < 500, isMobile: width < 500,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      try {
        const page = await context.newPage();
        const submissions=[];
        await page.route("**/api/application-verification",route=>route.fulfill({json:{required:false}}));
        await page.route("**/api/applications",route=>{
          submissions.push(route.request().postDataJSON());
          return route.fulfill({status:202,json:{status:"pending"}});
        });
        await page.goto(base);
        await page.getByText(/record elapsed time, paste attempts/i).waitFor();
        await page.waitForSelector("fieldset:not([disabled])");
        async function paste(field, value) {
          await field.focus();
          await page.evaluate(text => navigator.clipboard.writeText(text), value);
          await page.keyboard.press("ControlOrMeta+v");
        }

        for (const [path, value] of [["_systemfield_name", "Taylor"], ["portfolio", "https://example.org/work"]]) {
          const field = page.locator("#" + path);
          await paste(field, value);
          assert.equal(await field.inputValue(), value, "Native paste works in " + path);
        }

        for (const path of ["brief", "experience"]) {
          const field = page.locator("#" + path);
          await field.pressSequentially("My own answer");
          await field.evaluate(el => el.select());
          await page.evaluate(() => {
            window.pasteObservation = null;
            window.addEventListener("paste", e => {
              window.pasteObservation = { trusted: e.isTrusted, cancelled: e.defaultPrevented };
            }, { once: true });
          });
          await paste(field, "Clipboard replacement");
          assert.deepEqual(await page.evaluate(() => window.pasteObservation), { trusted: true, cancelled: true });
          assert.equal(await field.inputValue(), "My own answer", "Pasting over a selection preserves it");

          for (const inputType of ["insertFromPaste", "insertFromDrop"]) {
            assert.equal(await field.evaluate((el, inputType) => el.dispatchEvent(new InputEvent("beforeinput", {
              inputType, data: "Replacement", bubbles: true, cancelable: true,
            })), inputType), false, "Cancel native beforeinput for " + inputType);
          }
          await field.evaluate(el => {
            // A few editors send only input, after mutating the control.
            const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, "Late pasted replacement");
            el.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", bubbles: true }));
          });
          assert.equal(await field.inputValue(), "My own answer", "Late mobile paste restores the prior answer");
          const notice = field.locator("..").getByRole("status");
          assert.match(await notice.innerText(), /type your response/i);
          if (path === "experience") {
            assert.match(await page.locator("#experience-word-count").innerText(), /Word count: 3\b/);
          }

          assert.equal(await field.evaluate(el => {
            const transfer = new DataTransfer();
            transfer.setData("text/plain", "Dragged replacement");
            return el.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
          }), false, "Text drop is blocked");
          assert.equal(await field.evaluate(el => el.dispatchEvent(new InputEvent("beforeinput", {
            inputType:"insertCompositionText", data:"語", isComposing:true, bubbles:true, cancelable:true,
          }))), true, "Composed typing is allowed");
          await field.press("End");
          await field.pressSequentially(" today");
          assert.equal(await field.inputValue(), "My own answer today");
        }
        // A large single edit is measured by size. Contact/link paste does not enter the summary.
        await page.locator("#experience").fill("A long written response from the mobile keyboard. ".repeat(3));
        await page.locator("button[type=submit]").click();
        await page.getByRole("button",{name:"Check submission status"}).waitFor();
        assert.equal(submissions.length,1);
        const entry=submissions[0].responseEntry;
        assert.ok(entry.formElapsedMs>=entry.firstEditToSubmitMs && entry.firstEditToSubmitMs>0);
        assert.deepEqual(entry.fields.map(row=>row.path).sort(),["brief","experience"]);
        for (const row of entry.fields) assert.ok(row.pasteAttempts>=1);
        assert.ok(entry.fields.find(row=>row.path==="experience").largestInsertionChars>=80);
        await page.reload();
        await Promise.all([page.waitForResponse(response=>response.url().endsWith("/api/applications")), page.getByRole("button",{name:"Check submission status"}).click()]);
        assert.deepEqual(submissions[1].responseEntry,entry,"Recovery sends the original timing and counts");
      } finally {
        await context.close();
      }
    });
  }
});
