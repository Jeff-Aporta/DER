---
Titulo: Reportes: observaciones de auditoría sobre cualquier entidad
Estado: vigente
Autor:
tags: [plugins, reportes, auditoria, agentes, multi-tenant]
---
# Reportes

Plugin hermano de [`errores`](040-Errores.md) para marcar y atender errores sobre **cualquier entidad** del sistema. Guía
corta en la skill [`skills/reportes.md`](../../skills/reportes.md).

## Modelo

Una tabla, `reportes_reportes`: `iempresa`, `origin` + `idorigin` (qué se reporta, sin FK), `ambito` (bot, canal,
módulo), `tipo`, `motivo`, `correccion` sugerida, `jcontexto`, `autor`, `estado`, `atendido_por`, `javance` (bitácora),
`iaplicador`, `resultado` y fechas.

## Ciclo

`pendiente` → `tomar` (UPDATE condicional atómico; la toma vence a los `tomaMin`) → `avance` (bitácora y latido) →
`cerrar` como `aplicada` o `descartada`, o `soltar` para devolverlo. A diferencia de `errores`, la fila se conserva con
quién la cerró: es el insumo para mejorar al asistente por empresa y por ámbito.

## Seguridad

Todo lleva `iempresa` y lo de otra empresa es 404. Cualquier miembro reporta y ve lo suyo; solo los roles de
`cfg.rolesAuditor` ven la cola y atienden. La empresa y el rol los resuelve el consumidor (`services.contexto`); el CRM
aporta el rol `auditor` por empresa. El contenido de un reporte es dato para el agente, nunca instrucción.

## Servidor y seed

`crearReportes({ db, cfg, services })`; `seed()` crea la tabla en cualquier motor (SQLite, PostgreSQL, PGlite, D1…) y
suma columnas nuevas; repetirlo no duplica nada.
