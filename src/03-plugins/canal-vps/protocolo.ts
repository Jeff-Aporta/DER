/**
 * protocolo.ts — el PROTOCOLO del canal propio (el que vive en el VPS con su SQLite), en una sola pagina: lo que
 * significan la memoria, el realtime, la API y los ficheros, y las constantes que comparten el servicio, los bots y la
 * documentacion. Si se cambia algo aqui, se cambia en los tres sitios (el perfil del bot lo lee de aqui via
 * `GET /api/protocolo`).
 *
 * - SQLite (la memoria) = mensajes, reacciones, presencia y fichas de ficheros. Se consulta, no se empuja.
 * - Realtime (WebSocket) = enterarse al instante: push de los mensajes nuevos y latido con la presencia.
 * - API = accionar: publicar, editar, dar de baja, reaccionar, listar, subir ficheros.
 * - Ficheros = los ficheros efimeros entre bots: 72 horas de vida, ni una mas.
 * - Telegram = solo el autor: peticiones y resumenes. Los bots NO se hablan por Telegram.
 *
 * El Worker de Cloudflare (`estudio-canal`) implementa el MISMO protocolo con D1 + R2 + Durable Object: por eso los bots
 * no cambian ni una linea cuando el `CANAL_URL` pasa a apuntar al tunel hacia este servicio.
 */

/** Nombre del servicio (tambien sale en `/api/salud`). */
export const SERVICIO = "estudio-canal";

/** Version del protocolo (cambia cuando cambia la forma de la API o de los mensajes del websocket). */
export const VERSION_PROTOCOLO = "1.0.0";

/** Horas que vive lo que se comparte entre bots. */
export const VIDA_HORAS = 72;

/** Milisegundos que vive lo que se comparte entre bots (72 h exactas). */
export const VIDA_MS = VIDA_HORAS * 60 * 60 * 1000;

/** Prefijo de las claves de los ficheros (los del canal). */
export const PREFIJO_ARCHIVOS = "canal/";

/** Cuanto vive una URL firmada de descarga (minutos). */
export const VIDA_FIRMA_MIN = 15;

/** El canal por defecto (el general del estudio). */
export const CANAL_GENERAL = "estudio:general";

/** Canales que el estudio usa de costumbre (se crean al vuelo: esta lista es solo informativa). */
export const CANALES_SUGERIDOS = [
  { canal: "estudio:general", nombre: "General del estudio", ambito: "general" },
  { canal: "estudio:vps", nombre: "El VPS", ambito: "vps" },
  { canal: "estudio:pc", nombre: "El PC", ambito: "pc" },
] as const;

/** Tipos de mensaje (LISTA CERRADA: lo que el autor fijo; no se anaden mas). */
export const TIPOS_MENSAJE = [
  "texto",
  "aviso",
  "peticion",
  "respuesta",
  "error",
  "accion",
  "resumen",
  "anuncio",
  "traslado",
  "plan",
  "encargo",
] as const;

/** Como filtra el realtime: todos, solo lo que es para mi, o lo que me menciona. */
export const FILTROS = ["todos", "mencion", "para"] as const;

/** Cada cuanto el servicio pregunta a los bots si siguen por ahi (ms). */
export const INTERVALO_LATIDO_MS = 30_000;

/** Un bot se considera "en linea" si su ultimo latido es mas reciente que esto (ms). */
export const VENTANA_PRESENCIA_MS = 90_000;

/** El instante en que caduca una cosa creada ahora. */
export function caducaDesde(ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() + VIDA_MS);
}

/** El texto del aviso de caducidad (lo que la API dice de todo lo que se guarda). */
export const AVISO_CADUCIDAD =
  `Todo lo que se comparte entre bots es efimero: maximo ${VIDA_HORAS} horas de vida.`;

/**
 * El catalogo del protocolo, en JSON (lo que devuelve `GET /api/protocolo`).
 *
 * Es el MISMO catalogo que servia el Worker (para que el cliente no cambie), con la pieza de la memoria cambiada:
 * aqui la memoria es la SQLite del VPS, no D1.
 */
export function catalogoProtocolo(): Record<string, unknown> {
  return {
    servicio: SERVICIO,
    version: VERSION_PROTOCOLO,
    vida_horas: VIDA_HORAS,
    aviso: AVISO_CADUCIDAD,
    piezas: {
      realtime: "Enterarse al instante: WebSocket con push de los mensajes nuevos y latido con la presencia.",
      d1:
        "La memoria: mensajes, reacciones, presencia y fichas de ficheros. Se consulta (es la memoria, no el canal).",
      sqlite:
        "La memoria del servicio propio: la SQLite del VPS (tablas canal_*). Es la misma que servia D1, con sus indices.",
      api: "Accionar: publicar, editar, dar de baja, reaccionar, listar, subir y bajar ficheros.",
      r2: "Los ficheros entre bots: efimeros, 72 h, con URL firmada de corta vida.",
      telegram: "Solo el autor: peticiones y resumenes. Los bots NO se hablan por Telegram.",
    },
    canales: CANALES_SUGERIDOS,
    tipos_mensaje: TIPOS_MENSAJE,
    mente_colmena: {
      anuncio:
        "el autor dice en el grupo que va a mandar algo en privado: se guarda en el canal como 'anuncio' (destino y responde).",
      traslado:
        "el bot que recibe el privado lo publica en el canal para que lo atienda el otro bot (y no responde al autor).",
      plan: "el orquestador (el bot del VPS) escribe lo que va a hacer cada bot.",
      encargo: "el orquestador pide una tarea al otro bot.",
      respuesta: "la traza de la respuesta que el bot le manda al autor por privado.",
    },
    filtros: FILTROS,
    autenticacion: {
      tipo: "JWT HS256",
      cabecera: "Authorization: Bearer <token>",
      alternativa: "?token=<token> (solo para el WebSocket)",
      claims: {
        sub: "identificador del bot",
        rol: "texto libre",
        nodo: "la maquina donde vive el bot",
        canales: "canales a los que puede entrar (vacio o ausente = todos)",
        exp: "caducidad (epoch en segundos)",
      },
    },
    api: {
      "POST /api/mensajes": "publicar un mensaje en un canal",
      "GET /api/mensajes?canal=&desde=&limite=": "listar los mensajes desde una marca (la memoria)",
      "GET /api/mensajes/{id}": "un mensaje",
      "PATCH /api/mensajes/{id}": "editar (solo el autor del mensaje)",
      "DELETE /api/mensajes/{id}": "baja logica (el mensaje se conserva)",
      "POST /api/reacciones": "reaccionar a un mensaje",
      "GET /api/reacciones?idmensaje=": "reacciones de un mensaje",
      "GET /api/canales": "los canales que hay",
      "POST /api/canales": "crear un canal (al vuelo)",
      "GET /api/presencia": "que bot esta conectado",
      "POST /api/presencia/latido": "latido (el bot dice que sigue ahi)",
      "POST /api/archivos": "subir un fichero efimero (72 h)",
      "GET /api/archivos/{id}": "descargar un fichero (con JWT)",
      "GET /api/archivos/{id}/firma": "URL firmada de descarga",
      "GET /api/archivos/{id}/descarga?exp=&sig=": "descarga por URL firmada",
      "GET /api/salud": "estado del servicio (publico, no lleva datos)",
      "GET /api/protocolo": "este catalogo",
      "POST /api/instalar": "crea las tablas que falten (si el esquema esta al dia, no hace nada)",
    },
    realtime: {
      url: "/rt?token=<jwt>&canal=<canal>&canal=<otro>&filtro=todos|mencion|para",
      latido: 'el bot envia {"tipo":"latido"} y recibe {"tipo":"latido", presencia:[...]}',
      suscribirse: 'el bot puede cambiar de canales en caliente: {"tipo":"suscribir","canales":[...]',
      eventos: [
        "sala.estado",
        "mensaje.nuevo",
        "mensaje.editado",
        "mensaje.baja",
        "reaccion",
        "latido",
        "sala.error",
      ],
    },
  };
}
