import { DatabaseSync, backup } from "node:sqlite";
import { chmodSync, closeSync, constants, existsSync, linkSync, lstatSync, mkdirSync, openSync, realpathSync, unlinkSync, fsyncSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Online SQLite backup includes committed WAL pages. Original files require a separate volume/object backup. */
export async function createRailwayBackup({ dataDir, destination }) {
  if (!dataDir || !path.isAbsolute(dataDir) || realpathSync(dataDir) !== path.resolve(dataDir)) throw new Error("backup_data_directory_unsafe");
  const source = path.join(dataDir, "hiring.sqlite");
  if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink() || lstatSync(source).nlink !== 1) throw new Error("backup_source_unsafe");
  if (!destination || !path.isAbsolute(destination) || path.resolve(destination) !== destination) throw new Error("backup_destination_must_be_absolute");
  const directory = path.dirname(destination);
  if (!existsSync(directory)) {
    const parent = path.dirname(directory);
    if (realpathSync(parent) !== parent) throw new Error("backup_destination_unsafe");
    mkdirSync(directory, { mode: 0o700 });
  }
  if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) throw new Error("backup_destination_unsafe");
  chmodSync(directory, 0o700);
  if (existsSync(destination)) throw new Error("backup_destination_exists");
  const temporary = path.join(directory, ".backup-" + randomUUID() + ".sqlite");
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); closeSync(fd);
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout=5000");
    await backup(database, temporary);
    const copy = new DatabaseSync(temporary);
    try {
      if (copy.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("backup_integrity_failed");
      // Make the published snapshot self-contained; no destination WAL/SHM sidecar is needed.
      copy.exec("PRAGMA journal_mode=DELETE");
    } finally { copy.close(); }
    chmodSync(temporary, 0o600);
    const snapshot = openSync(temporary, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(snapshot); } finally { closeSync(snapshot); }
    // Hard-link publication is exclusive. Never overwrite a backup created by another process.
    linkSync(temporary, destination); unlinkSync(temporary);
    const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { fsyncSync(parent); } finally { closeSync(parent); }
    return destination;
  } finally {
    database.close();
    for (const filename of [temporary, temporary + "-wal", temporary + "-shm"]) { try { unlinkSync(filename); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dataDir = process.env.DATA_DIR;
  const destination = process.argv[2];
  if (!dataDir || !destination) throw new Error("Usage: DATA_DIR=/data node scripts/railway-backup.mjs /data/backups/hiring-YYYY-MM-DD.sqlite");
  await createRailwayBackup({ dataDir, destination });
  console.log("Private SQLite snapshot created. Back up the original object directory separately.");
}
