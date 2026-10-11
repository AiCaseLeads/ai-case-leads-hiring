import assert from "node:assert/strict";
import { test } from "node:test";
import { driveFolderId } from "../../components/hub/drive-folder";

const id = "0AFEhbfGTJcYhUk9PVA";
test("Drive setup accepts a folder ID, folder link and account-specific folder link", () => {
  assert.equal(driveFolderId(` ${id} `), id);
  assert.equal(driveFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`), id);
  assert.equal(driveFolderId(`https://drive.google.com/drive/u/2/folders/${id}/`), id);
  assert.equal(driveFolderId("  "), "");
});
test("Drive setup rejects deceptive hosts, non-folder links and malformed IDs", () => {
  for (const input of [
    `https://drive.google.com.example.com/drive/folders/${id}`,
    `https://drive.google.com@evil.example/drive/folders/${id}`,
    `https://name@drive.google.com/drive/folders/${id}`,
    `http://drive.google.com/drive/folders/${id}`,
    `https://drive.google.com:444/drive/folders/${id}`,
    `https://drive.google.com/file/d/${id}/view`,
    `https://drive.google.com/drive/folders/${id}/unexpected`,
    "javascript:alert(1)", "Folder with spaces", "short", "a".repeat(201),
  ]) assert.equal(driveFolderId(input), null, input);
});
