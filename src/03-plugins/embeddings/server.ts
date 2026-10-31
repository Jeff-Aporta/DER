/**
 * Plugin de embeddings (server): la caché con huella, la búsqueda con prioridad, las estadísticas y la purga declarativa. El proveedor
 * y el índice se inyectan en `services`; todo lo demás es el JSON de `cfg`, validado con Zod al armar y contra las entidades en `seed()`.
 *
 * ```ts
 * const emb = createServer(embeddingsServer, { db, cfg, services: { ai: workersAi(env.AI) } });
 * const router = createRouter(ctrls, { basePath: "/api", plugins: [auth, permisos, emb] });
 * await router.seed();
 * await emb.embeber({ items: [{ texto: "café", entidad: "productos", id: 7 }] });
 * await emb.purgar({ simular: true });   // en cron: await emb.purgar();
 * ```
 * Docs (punto de entrada para agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/docs/README.md
 * Skill general (agentes): https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/README.md
 * Skill particular: https://cdn.jsdelivr.net/gh/Jeff-Aporta/DER@main/skills/embeddings.md
 */
import type { z } from "zod";
import { Obj, ValidationError } from "@Jeff-Aporta/DER/src/00-common/base.ts";
import { zodMessage } from "@Jeff-Aporta/DER/src/01-objects/zod.ts";
import type { ExtraRouteInput, ServerPlugin, ServerPluginDef } from "@Jeff-Aporta/DER/src/02-controllers/server/schemas.ts";
import { alimentarEntidad, buscarConPrioridad, cfgDe, embeberConCache, estadisticas, indexarDocumentos, olvidarDocumentos, proyeccionesVigentes } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/cache.ts";
import { embeddings } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/index.ts";
import { exigirReglasValidas, explicarReglas, purgar } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/purga.ts";
import { type AlimentarResultado, type BusquedaResultado, type EmbeberResultado, type Estadisticas, type ExplicacionReglas, type InformePurga, type ItemEmbeber, ZAlimentarInput, ZBuscarInput, ZEmbeberInput, ZEmbeddingsConfig } from "@Jeff-Aporta/DER/src/03-plugins/embeddings/schemas.ts";

export * from "@Jeff-Aporta/DER/src/03-plugins/embeddings/index.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/embeddings/proveedores.ts";
export * from "@Jeff-Aporta/DER/src/03-plugins/embeddings/vectores.ts";

/** Valida con un Zod y lanza 400 con el detalle. */
function validado<T>(zod: z.ZodType<T>, v: unknown): T {
  const r = zod.safeParse(v);
  if (!r.success) throw new ValidationError(zodMessage(r.error));
  return r.data;
}

/** JSON del server de embeddings: `embeddings` + particularidades. */
export const embeddingsServer: ServerPluginDef = Obj.insert(embeddings, {
  cfg: ZEmbeddingsConfig,
  entities: {
    cache: {
      hidden: ["vector"],
      indexes: [{ columns: ["huella", "modelo", "dims", "iproyeccion", "tipo", "entidad", "id"], unique: true, name: "ux_embeddings_cache_ref" }, { columns: ["entidad", "tipo", "id"], name: "ix_embeddings_cache_ref" }, { columns: ["fultimohit"], name: "ix_embeddings_cache_hit" }],
    },
  },
  irregularPaths: {
    embeber: {
      handler(this: ServerPlugin, { body }: ExtraRouteInput) {
        return this["embeber"](body);
      },
      ops: {
        /** Embeber con caché: hit incrementa y devuelve sin llamar al modelo. */
        embeber(this: ServerPlugin, input: unknown): Promise<EmbeberResultado> {
          const i = validado(ZEmbeberInput, input);
          return embeberConCache(this, i.items, i.modelo);
        },
        /** Embebe documentos y, si hay índice externo con `subir`, los sube (`metadata` viaja al índice). */
        indexar(this: ServerPlugin, docs: (ItemEmbeber & { metadata?: Record<string, unknown> })[], modelo?: string): Promise<EmbeberResultado> {
          return indexarDocumentos(this, docs, modelo);
        },
        /** Borra las filas de unas referencias (hook `afterDelete`) y las saca del índice externo. */
        olvidar(this: ServerPlugin, entidad: string, ids: (string | number)[]): Promise<number> {
          return olvidarDocumentos(this, entidad, ids);
        },
      },
    },
    buscar: {
      handler(this: ServerPlugin, { body }: ExtraRouteInput) {
        return this["buscar"](body);
      },
      ops: {
        /** Exacta primero, luego contenida y embeddings. `filtros` por entidad acota a un inquilino. */
        buscar(this: ServerPlugin, input: unknown): Promise<BusquedaResultado> {
          return buscarConPrioridad(this, validado(ZBuscarInput, input));
        },
      },
    },
    estadisticas: {
      handler(this: ServerPlugin) {
        return this["estadisticas"]();
      },
      ops: {
        /** Hits, tasa y tamaño por modelo y por referencia. */
        estadisticas(this: ServerPlugin): Promise<Estadisticas> {
          return estadisticas(this);
        },
      },
    },
    purgar: {
      handler(this: ServerPlugin, { body }: ExtraRouteInput) {
        return this["purgar"](body);
      },
      ops: {
        /** Purga por cron o bajo demanda; `{ simular: true }` informa qué borraría. */
        purgar(this: ServerPlugin, input?: unknown): Promise<InformePurga> {
          return purgar(this, input);
        },
      },
    },
    reglas: {
      handler(this: ServerPlugin) {
        return this["reglas"]();
      },
      ops: {
        /** Orden efectivo de los pasos, errores contra las entidades y proyecciones vigentes. */
        reglas(this: ServerPlugin): Promise<ExplicacionReglas> {
          return explicarReglas(this);
        },
      },
    },
    alimentar: {
      handler(this: ServerPlugin, { body }: ExtraRouteInput) {
        return this["alimentar"](body);
      },
      ops: {
        /** Una tanda por entidad desde su cursor (o de una sola): para cron. */
        async alimentar(this: ServerPlugin, input?: unknown): Promise<AlimentarResultado> {
          const i = validado(ZAlimentarInput, input ?? {});
          const entidades = i.entidad ? [i.entidad] : Object.keys(cfgDe(this).alimentacion ?? {});
          const avances = [];
          for (const e of entidades) avances.push(await alimentarEntidad(this, e, i.lote, i.reiniciar));
          return { avances };
        },
      },
    },
  },
  /** Valida las reglas contra las entidades y guarda las proyecciones vigentes. */
  async seed(this: ServerPlugin) {
    exigirReglasValidas(this, cfgDe(this).purga?.reglas ?? []);
    await proyeccionesVigentes(this);
  },
}) as ServerPluginDef;
