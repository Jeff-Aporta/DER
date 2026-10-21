/**
 * Motores sin servidor: el SQL que arma el ServerController para MySQL y MSSQL (compilado con el dialecto de Kysely, sin
 * conectar) y el driver SQLite asíncrono (`sqlite3`-like) envolviendo `node:sqlite`.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { type Database, ServerController } from "@Jeff-Aporta/DER/src/02-controllers/server/index.ts";
import { mysqlDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/mysql.ts";
import { mssqlDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/mssql.ts";
import { type AsyncSqlite, sqliteDatabase } from "@Jeff-Aporta/DER/src/02-controllers/server/sqlite.ts";
import { CategoriaEntity, ProductoEntity } from "@Jeff-Aporta/DER/examples/domain.ts";

/** Pool mysql2 falso: Kysely sólo lo usa al ejecutar. */
const fakeMysql = () => mysqlDatabase({ getConnection: () => { throw new Error("sin conexión en el test"); } } as never);
const fakeMssql = () => mssqlDatabase({ tarn: { Pool: class {}, options: { min: 0, max: 1 } }, tedious: { Connection: class {}, Request: class {}, TYPES: {}, connectionFactory: () => { throw new Error("sin conexión en el test"); } } } as never);

function compiled(db: Database) {
  const productos: ServerController<any> = new ServerController(ProductoEntity, { db, table: "productos", computed: { total: "{precio} * {stock}" }, relations: { categoria: { controller: () => categorias } }, register: false });
  const categorias: ServerController<any> = new ServerController(CategoriaEntity, { db, table: "categorias", register: false, relations: { productos: { controller: () => productos } } });
  const q = productos.buildSelect({ include: { categoria: true }, where: { nombre: { contains: "caf" }, precio: { gt: 1 } }, limit: 10, offset: 20 }).query.compile(db.kysely);
  return { q, productos, categorias };
}

Deno.test("mysql: json_object/json_arrayagg, lower() like sin escape, limit/offset, tipos y relectura (sin RETURNING)", () => {
  const db = fakeMysql();
  const { q, productos } = compiled(db);
  assertStringIncludes(q.sql, "json_object(");
  assertStringIncludes(q.sql, "lower(`t0`.`nombre`) like lower(?)");
  assert(!q.sql.includes("escape"), "MySQL usa el escape por defecto (backslash)");
  assertStringIncludes(q.sql, "limit ? offset ?");
  assertEquals(q.parameters.slice(-2), [10, 20]);
  assertEquals([db.engine.returning, db.engine.columnType({ type: "bool" }), db.engine.columnType({ type: "string", length: 60 }), db.engine.columnType({ type: "json" })], ["none", "tinyint(1)", "varchar(60)", "json"]);
  assertEquals(db.engine.toDb({ type: "datetime" }, new Date(0)), "1970-01-01T00:00:00.000"); // UTC sin zona: el driver no lo corre
  assertStringIncludes(q.sql, "date_format(`t0`.`creado`, '%Y-%m-%dT%H:%i:%s.%fZ')");
  assertEquals(productos.table, "productos");
});

Deno.test("mssql: for json path, json_query en lo anidado, offset/fetch, [corchetes], output y tipos", () => {
  const db = fakeMssql();
  const { q, categorias } = compiled(db);
  assertStringIncludes(q.sql, "for json path, without_array_wrapper");
  assertStringIncludes(q.sql, "offset ");
  assertStringIncludes(q.sql, "fetch next 10 rows only");
  assertStringIncludes(q.sql, "like lower(@1) escape");
  const many = categorias.buildSelect({ include: { productos: true } }).query.compile(db.kysely);
  assertStringIncludes(many.sql, "isnull((select");
  assertStringIncludes(many.sql, "json_query(");
  assertStringIncludes(many.sql, "for json path), '[]')");
  assertEquals([db.engine.returning, db.engine.ifNotExists, db.engine.columnType({ type: "bool" }), db.engine.columnType({ type: "text" }), db.engine.columnType({ type: "datetime" })], ["output", false, "bit", "nvarchar(max)", "datetime2"]);
  assertEquals(db.engine.toDb({ type: "datetime" }, "2024-02-29T05:00:00-05:00"), "2024-02-29T10:00:00.000");
  assertStringIncludes(q.sql, `convert(varchar(23), "t0"."creado", 126) + 'Z'`);
});

/** Envuelve `node:sqlite` con la interfaz asíncrona de `sqlite3` (all/run con callback). */
function asyncOf(db: DatabaseSync): AsyncSqlite {
  return {
    all: (sql, params, cb) => setTimeout(() => {
      try {
        cb(null, db.prepare(sql).all(...(params as never[])));
      } catch (e) {
        cb(e as Error, []);
      }
    }),
    run(sql, params, cb) {
      setTimeout(() => {
        try {
          const r = db.prepare(sql).run(...(params as never[]));
          cb.call({ changes: Number(r.changes), lastID: Number(r.lastInsertRowid) }, null);
        } catch (e) {
          cb.call({}, e as Error);
        }
      });
    },
    close: (cb) => {
      db.close();
      cb?.(null);
    },
  };
}

Deno.test("sqlite asíncrono (sqlite3-like): seed, post con autoincrement, query, transacción y rollback", async () => {
  const db = sqliteDatabase(asyncOf(new DatabaseSync(":memory:")));
  try {
    const categorias = new ServerController(CategoriaEntity, { db, table: "categorias" });
    const productos = new ServerController(ProductoEntity, { db, table: "productos" });
    await db.seed();
    const beb = await categorias.post({ nombre: "Bebidas" });
    const cafe = await productos.post({ nombre: "Café", precio: 3, icategoria: beb.icategoria });
    assertEquals([typeof cafe.iproducto, (await productos.get({ iproducto: cafe.iproducto }))?.categoria?.nombre], ["number", "Bebidas"]);
    assertEquals((await productos.query({ where: { nombre: { contains: "caf" } } })).length, 1);
    await db.transaction(async (tx) => {
      await categorias.post({ nombre: "Temporal" }, tx);
      throw new Error("rollback");
    }).catch(() => undefined);
    assertEquals((await categorias.list()).length, 1);
  } finally {
    await db.destroy();
  }
});
