/**
 * Plugin de embeddings: el JSON TRANSVERSAL. La caché vive en su PROPIA SQLite (`cfg.db`/`cfg.ruta`), no en la base principal;
 * el perfil embebido de cada usuario vive en la base principal. Una fila de caché por referencia y huella del texto, con modelo
 * y dimensiones como columnas, que se depura con los mismos JSON de DER (`query` sobre `embeddings/entradas`):
 *
 *   embeddings_cache (icache, huella, modelo, dims, iproyeccion, tipo, entidad, id, vector, bytes, hits, fultimohit, fcreado)
 *   embeddings_proyecciones (iproyeccion, modelo, dimsorigen, dims, decimales, metodo, semilla, version, fcreado)
 *   embeddings_contadores (modelo, dims, tipo, entidad, hits, misses, purgadas, factualizado)
 *   embeddings_cursores (entidad, cursor, factualizado)
 *   embeddings_usuarios (iusuario, vector, dims, modelo, preferencias, fhactualizado, fhinteraccion)   // base principal
 *
 * Las de la caché son de solo lectura por API (el vector nunca sale por CRUD) y no guardan el texto. Caducidad: embeddings a 180
 * días, caché sin hit a 15 días; el perfil de usuario no caduca, pero a los 720 días sin interacción pierde su vector. Paths
 * irregulares: `POST embeddings/embeber`, `POST embeddings/buscar`, `GET embeddings/estadisticas`, `POST embeddings/purgar`,
 * `GET embeddings/reglas`, `POST embeddings/alimentar`, `POST embeddings/usuarios/perfil`, `POST embeddings/usuarios/similares`.
 *
 * ```ts
 * const emb = createClient(embeddings, { baseUrl: "/api", headers: auth.headers });
 * await emb.buscar({ q: "café molido", entidades: ["productos"] });
 * await emb.purgar({ simular: true });
 * await emb.controllers.cache.query({ where: { entidad: "mensajes", hits: { gt: 3 } }, orderBy: "-hits" });
 * await emb.perfil({ iusuario: "beto", textos: ["compro café"] });
 * await emb.similares({ iusuario: "beto", limite: 5 });
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import type { ClientPlugin, PluginDef } from "@Jeff-Aporta/DER/src/00-common/schemas.ts";
import { type ActualizarPerfilInput, type AlimentarInput, type AlimentarResultado, type BuscarInput, type BusquedaResultado, type EmbeberInput, type EmbeberResultado, type Estadisticas, type ExplicacionReglas, type InformePurga, type PerfilResultado, type PurgarInput, type SimilaresResultado, type SimilaresUsuariosInput, ZActualizarPerfilInput, ZAlimentarInput, ZBuscarInput, ZEmbeberInput, ZPurgarInput, ZSimilaresUsuariosInput } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";

/** JSON transversal de embeddings: cuatro entidades de solo lectura y los paths de operación. */
export const embeddings: PluginDef = {
  name: "embeddings",
  entities: {
    cache: {
      name: "embeddings.cache",
      singular: "embeddings/entrada",
      plural: "embeddings/entradas",
      table: "embeddings_cache",
      exposed: true,
      administrable: false,
      schema: {
        columns: {
          icache: { type: "int", pk: true, autoincrement: true },
          huella: { type: "string", length: 64, nullable: false },
          modelo: { type: "string", length: 120, nullable: false },
          dims: { type: "int", nullable: false },
          iproyeccion: { type: "string", length: 40, nullable: false },
          tipo: { type: "string", length: 20, nullable: false },
          entidad: { type: "string", length: 120, nullable: false },
          id: { type: "string", length: 200, nullable: false },
          vector: { type: "text", nullable: false },
          bytes: { type: "int", nullable: false },
          hits: { type: "int", nullable: false, default: 0 },
          fultimohit: { type: "datetime" },
          fcreado: { type: "datetime", nullable: false },
        },
      },
      security: true,
    },
    proyecciones: {
      name: "embeddings.proyeccion",
      singular: "embeddings/proyeccion",
      plural: "embeddings/proyecciones",
      table: "embeddings_proyecciones",
      exposed: true,
      administrable: false,
      schema: {
        columns: {
          iproyeccion: { type: "string", pk: true, length: 40 },
          modelo: { type: "string", length: 120, nullable: false },
          dimsorigen: { type: "int", nullable: false },
          dims: { type: "int", nullable: false },
          decimales: { type: "int" },
          metodo: { type: "string", length: 20, nullable: false },
          semilla: { type: "bigint", nullable: false },
          version: { type: "int", nullable: false },
          fcreado: { type: "datetime", nullable: false },
        },
      },
      security: true,
    },
    contadores: {
      name: "embeddings.contador",
      singular: "embeddings/contador",
      plural: "embeddings/contadores",
      table: "embeddings_contadores",
      exposed: true,
      administrable: false,
      schema: {
        columns: {
          modelo: { type: "string", pk: true, length: 120 },
          dims: { type: "int", pk: true },
          tipo: { type: "string", pk: true, length: 20 },
          entidad: { type: "string", pk: true, length: 120 },
          hits: { type: "int", nullable: false, default: 0 },
          misses: { type: "int", nullable: false, default: 0 },
          purgadas: { type: "int", nullable: false, default: 0 },
          factualizado: { type: "datetime", nullable: false },
        },
      },
      security: true,
    },
    cursores: {
      name: "embeddings.cursor",
      singular: "embeddings/cursor",
      plural: "embeddings/cursores",
      table: "embeddings_cursores",
      exposed: true,
      administrable: false,
      schema: { columns: { entidad: { type: "string", pk: true, length: 120 }, cursor: { type: "string", length: 200 }, factualizado: { type: "datetime", nullable: false } } },
      security: true,
    },
    usuarios: {
      name: "embeddings.usuario",
      singular: "embeddings/usuario",
      plural: "embeddings/usuarios",
      table: "embeddings_usuarios",
      exposed: true,
      administrable: false,
      schema: { columns: { iusuario: { type: "string", pk: true, length: 120 }, vector: { type: "text" }, dims: { type: "int", nullable: false, default: 0 }, modelo: { type: "string", length: 120 }, preferencias: { type: "json" }, fhactualizado: { type: "datetime" }, fhinteraccion: { type: "datetime" } } },
      security: true,
    },
  },
  irregularPaths: {
    embeber: {
      method: "POST",
      path: "embeddings/embeber",
      security: true,
      zod: ZEmbeberInput,
      ops: {
        /** `POST embeddings/embeber`: vectores (reducidos) con caché por huella. */
        embeber(this: ClientPlugin, input: EmbeberInput): Promise<EmbeberResultado> {
          return this.call<EmbeberResultado>("embeber", input);
        },
      },
    },
    buscar: {
      method: "POST",
      path: "embeddings/buscar",
      security: true,
      zod: ZBuscarInput,
      ops: {
        /** `POST embeddings/buscar`: coincidencia exacta primero, luego embeddings. */
        buscar(this: ClientPlugin, input: BuscarInput): Promise<BusquedaResultado> {
          return this.call<BusquedaResultado>("buscar", input);
        },
      },
    },
    estadisticas: {
      method: "GET",
      path: "embeddings/estadisticas",
      security: true,
      ops: {
        /** `GET embeddings/estadisticas`: hits, tasa y tamaño por modelo y por referencia. */
        estadisticas(this: ClientPlugin): Promise<Estadisticas> {
          return this.call<Estadisticas>("estadisticas");
        },
      },
    },
    purgar: {
      method: "POST",
      path: "embeddings/purgar",
      security: true,
      zod: ZPurgarInput,
      ops: {
        /** `POST embeddings/purgar`: bajo demanda; `{ simular: true }` informa sin borrar. */
        purgar(this: ClientPlugin, input: PurgarInput = {}): Promise<InformePurga> {
          return this.call<InformePurga>("purgar", input);
        },
      },
    },
    reglas: {
      method: "GET",
      path: "embeddings/reglas",
      security: true,
      ops: {
        /** `GET embeddings/reglas`: orden efectivo, errores y proyecciones vigentes. */
        reglas(this: ClientPlugin): Promise<ExplicacionReglas> {
          return this.call<ExplicacionReglas>("reglas");
        },
      },
    },
    alimentar: {
      method: "POST",
      path: "embeddings/alimentar",
      security: true,
      zod: ZAlimentarInput,
      ops: {
        /** `POST embeddings/alimentar`: una tanda por entidad desde su cursor. */
        alimentar(this: ClientPlugin, input: AlimentarInput = {}): Promise<AlimentarResultado> {
          return this.call<AlimentarResultado>("alimentar", input);
        },
      },
    },
    perfil: {
      method: "POST",
      path: "embeddings/usuarios/perfil",
      security: true,
      zod: ZActualizarPerfilInput,
      ops: {
        /** `POST embeddings/usuarios/perfil`: guarda el perfil embebido del usuario (textos o vector) y sus preferencias. */
        perfil(this: ClientPlugin, input: ActualizarPerfilInput): Promise<PerfilResultado> {
          return this.call<PerfilResultado>("perfil", input);
        },
      },
    },
    similares: {
      method: "POST",
      path: "embeddings/usuarios/similares",
      security: true,
      zod: ZSimilaresUsuariosInput,
      ops: {
        /** `POST embeddings/usuarios/similares`: los N usuarios más parecidos por coseno, con sus preferencias. */
        similares(this: ClientPlugin, input: SimilaresUsuariosInput): Promise<SimilaresResultado> {
          return this.call<SimilaresResultado>("similares", input);
        },
      },
    },
  },
};