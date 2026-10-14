import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeJobDescription,
  serializeDescriptionEditor,
  cleanDescriptionSpacing,
  hasDescriptionText,
} from "../../lib/job-description";

test("formatting survives repeated save and editing, including entities and legacy newlines", () => {
  const value =
    "<h2>R&amp;D</h2><p>Build <strong>great</strong> things &lt; safely</p><ol><li>First</li><li>Second &#38; third</li></ol>\nLegacy\nlines";
  const first = sanitizeJobDescription(value);
  assert.equal(sanitizeJobDescription(first), first);
  assert.equal(
    sanitizeJobDescription(first + "<p>More &nbsp; text</p>"),
    first + "<p>More \u00a0 text</p>",
  );
  assert.ok(first.includes("<ol><li>First</li>"));
  assert.ok(first.endsWith("\nLegacy\nlines"));
});
test("all attributes and executable markup are excluded, including encoded tags", () => {
  const value =
    '<p onclick="evil()">&#60;img src=x onerror=evil()&#62;</p><script>alert(1)</script><svg/onload=evil()><strong style="color:red">Good</strong><a href="javascript:evil()">bad</a>';
  const safe = sanitizeJobDescription(value);
  assert.ok(safe.includes("<p>&lt;img"));
  assert.ok(safe.includes("<strong>Good</strong>"));
  assert.ok(!/<(?:script|svg|img|a)\b/i.test(safe));
  assert.ok(!/<[^>]+(?:onclick|onload|style)=/i.test(safe));
  assert.equal(sanitizeJobDescription(safe), safe);
});
test("browser wrapper serialization keeps content and formatting", () => {
  assert.equal(
    serializeDescriptionEditor(
      '<div>One <span style="color:red"><b>bold</b></span></div><div>Two</div>',
    ),
    "<p>One <b>bold</b></p><p>Two</p>",
  );
});
test("spacing cleanup preserves word separators around inline formatting and list structure", () => {
  assert.equal(
    cleanDescriptionSpacing(
      "<p>  Build   <strong>great</strong>   things </p><p><br></p><ol><li>First  item</li></ol>",
    ),
    "<p>Build <strong>great</strong> things</p><ol><li>First item</li></ol>",
  );
  assert.equal(cleanDescriptionSpacing("One\n\n\n\nTwo"), "One\n\nTwo");
});

test("blank formatted descriptions cannot be published", () => {
  assert.equal(hasDescriptionText("<p><br></p><p>&nbsp; &#32;</p>"), false);
  assert.equal(hasDescriptionText("<h2>Role</h2>"), true);
  assert.equal(hasDescriptionText("&lt;literal&gt;"), true);
});

test("spacing cleanup removes blank formatted list entries and paragraphs", () => {
  const source =
    "<ol><li><b>Clear   responsibilities</b></li><li><b><br></b></li><li><b>Approved   requirements</b></li><li><b><br></b></li><li><b>How   to   apply</b></li></ol>";
  assert.equal(
    cleanDescriptionSpacing(source),
    "<ol><li><b>Clear responsibilities</b></li><li><b>Approved requirements</b></li><li><b>How to apply</b></li></ol>",
  );
  assert.equal(
    cleanDescriptionSpacing(
      "<p><strong><em><br></em></strong></p><h2><i> &nbsp; </i></h2><ul><li><p><strong><br></strong></p></li><li>Keep this</li></ul>",
    ),
    "<ul><li>Keep this</li></ul>",
  );
});
test("spacing cleanup keeps meaningful nested list children and inline separators", () => {
  const source =
    "<ul><li><b><br></b><ol><li><em>Nested requirement</em></li><li><i><br></i></li></ol></li><li>Build <strong>great</strong> things</li></ul>";
  assert.equal(
    cleanDescriptionSpacing(source),
    "<ul><li><b><br></b><ol><li><em>Nested requirement</em></li></ol></li><li>Build <strong>great</strong> things</li></ul>",
  );
});
