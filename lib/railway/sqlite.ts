import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

type Row = Record<string, unknown>;
type Journal = { entries: Array<{ idx: number; tag: string }> };

function bindValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return Number(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("sqlite_binding_unsupported");
}
function privateDatabaseFile(filename: string) {
  if (!path.isAbsolute(filename) || path.resolve(filename) !== filename) throw new Error("sqlite_path_must_be_absolute");
  const directory = path.dirname(filename);
  if (realpathSync(directory) !== directory || !lstatSync(directory).isDirectory()) throw new Error("sqlite_directory_unsafe");
  if (existsSync(filename)) {
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("sqlite_file_unsafe");
  }
  const fd = openSync(filename, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  closeSync(fd);
  chmodSync(filename, 0o600);
}

/** The D1 subset used by the hiring hub. SQL executes synchronously, never yields inside a transaction. */
export class SQLiteD1Database {
  readonly connection: DatabaseSync;
  private closed = false;
  constructor(readonly filename: string) {
    privateDatabaseFile(filename);
    this.connection = new DatabaseSync(filename, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false });
    try {
      this.connection.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    } catch (error) { this.connection.close(); throw error; }
  }
  prepare(sql: string): SQLiteD1Statement { this.assertOpen(); return new SQLiteD1Statement(this, sql); }
  asD1(): D1Database { return this as unknown as D1Database; }
  assertOpen() { if (this.closed) throw new Error("sqlite_storage_closed"); }
  execute<T>(sql: string, values: readonly SQLInputValue[] = []): D1Result<T> {
    this.assertOpen();
    const began = performance.now(), before = Number(this.connection.prepare("SELECT total_changes() AS n").get()!.n);
    const statement = this.connection.prepare(sql);
    const rows = statement.columns().length ? statement.all(...values) : (statement.run(...values), []);
    const stats = this.connection.prepare("SELECT total_changes() AS n,changes() AS changes,last_insert_rowid() AS id").get()!;
    const written = Number(stats.n) - before;
    return { success: true, results: rows.map(row => ({ ...row }) as T), meta: {
      duration: performance.now() - began, size_after: 0, rows_read: rows.length, rows_written: written,
      last_row_id: Number(stats.id), changed_db: written > 0, changes: written > 0 ? Number(stats.changes) : 0,
    } };
  }
  async batch<T = unknown>(statements: D1PreparedStatement[] | SQLiteD1Statement[]): Promise<D1Result<T>[]> {
    this.assertOpen();
    if (statements.some(statement => !(statement instanceof SQLiteD1Statement) || statement.database !== this)) throw new Error("sqlite_batch_foreign_statement");
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const results = (statements as SQLiteD1Statement[]).map(statement => statement.execute<T>());
      this.connection.exec("COMMIT");
      return results;
    } catch (error) { this.connection.exec("ROLLBACK"); throw error; }
  }
  async exec(sql: string): Promise<D1ExecResult> {
    this.assertOpen(); const began = performance.now(); this.connection.exec(sql);
    return { count: sql.split(";").filter(part => part.trim()).length, duration: performance.now() - began };
  }
  /** Single-primary local storage is sequentially consistent; no remote bookmark is needed. */
  withSession() { return { prepare: this.prepare.bind(this), batch: this.batch.bind(this), getBookmark: () => null }; }
  migrate(directory: string) {
    this.assertOpen();
    const journal = JSON.parse(readFileSync(path.join(directory, "meta", "_journal.json"), "utf8")) as Journal;
    if (!Array.isArray(journal.entries) || !journal.entries.length) throw new Error("migration_journal_invalid");
    const migrations = journal.entries.map((entry, index) => {
      if (entry.idx !== index || !/^\d{4}_[a-zA-Z0-9_-]+$/.test(entry.tag)) throw new Error("migration_journal_invalid");
      const name = entry.tag + ".sql", bytes = readFileSync(path.join(directory, name));
      return { name, position: index, sql: bytes.toString("utf8"), hash: createHash("sha256").update(bytes).digest("hex") };
    });
    const names = new Set(migrations.map(migration => migration.name));
    if (names.size !== migrations.length || readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).some(name => !names.has(name))) throw new Error("migration_journal_incomplete");
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      this.connection.exec("CREATE TABLE IF NOT EXISTS railway_migrations (name TEXT PRIMARY KEY NOT NULL,position INTEGER UNIQUE NOT NULL,sha256 TEXT NOT NULL,applied_at INTEGER NOT NULL)");
      const applied = this.connection.prepare("SELECT name,position,sha256 FROM railway_migrations ORDER BY position").all();
      if (applied.some((entry, index) => entry.name !== migrations[index]?.name || entry.position !== index || entry.sha256 !== migrations[index]?.hash)) throw new Error("migration_hash_drift");
      for (const migration of migrations.slice(applied.length)) {
        this.connection.exec(migration.sql);
        this.connection.prepare("INSERT INTO railway_migrations(name,position,sha256,applied_at) VALUES (?,?,?,?)").run(migration.name, migration.position, migration.hash, Date.now());
      }
      this.connection.exec("COMMIT");
    } catch (error) { this.connection.exec("ROLLBACK"); throw error; }
  }
  close() {
    if (this.closed) return;
    this.connection.exec("PRAGMA wal_checkpoint(TRUNCATE)"); this.connection.close(); this.closed = true;
  }
}

export class SQLiteD1Statement {
  constructor(readonly database: SQLiteD1Database, readonly sql: string, private readonly values: readonly SQLInputValue[] = []) {}
  bind(...values: unknown[]): SQLiteD1Statement { return new SQLiteD1Statement(this.database, this.sql, values.map(bindValue)); }
  execute<T = Row>(): D1Result<T> { return this.database.execute<T>(this.sql, this.values); }
  async all<T = Row>(): Promise<D1Result<T>> { return this.execute<T>(); }
  async run<T = Row>(): Promise<D1Result<T>> { return this.execute<T>(); }
  async first<T = Row>(column?: string): Promise<T | null> {
    const rows = this.execute<Row>().results, first = rows[0];
    if (!first) return null;
    if (column !== undefined) {
      if (!Object.hasOwn(first, column)) throw new Error("sqlite_column_not_found");
      return first[column] as T;
    }
    return first as T;
  }
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const result = this.execute<Row>().results;
    const columns = this.database.connection.prepare(this.sql).columns().map(column => column.name);
    const rows = result.map(row => columns.map(column => row[column]) as T);
    return options?.columnNames ? [columns, ...rows] : rows;
  }
}
