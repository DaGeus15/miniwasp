# Resumen de escaneos OWASP ZAP

Generado: 2026-11-19T00:09:26.948Z. Politica: ninguna alerta Low o superior y como maximo un tipo informativo, salvo las justificadas en `scripts/zap/accepted-alerts.json`.

## Baseline: pasivo + spider + AJAX spider (autenticado)

- Objetivo: `https://host.docker.internal:59794`
- Inicio: 2026-11-12T15:33:48.485Z; fin: 2026-11-12T15:36:56.917Z
- ZAP 2.17.0; codigo de salida del script de ZAP: 2
- Comando: `docker run --rm --name miniwasp-zap-baseline-27916 --mount type=bind,source=D:\UTA\8vo_Semestre\Seguridad de Software\miniWasp\scripts\zap,target=/zap/hooks,readonly --mount type=bind,source=D:\UTA\8vo_Semestre\Seguridad de Software\miniWasp\docs\evidence\zap,target=/zap/wrk -e MINIWASP_SESSION_TOKEN -e MINIWASP_TARGET_AUTHORITY -e MINIWASP_AUTH_CHECK_FILE ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://host.docker.internal:59794 -j --ajax-spider -m 2 -r baseline-report.html -J baseline-report.json -w baseline-report.md --hook=/zap/hooks/zap_hooks.py`
- Veredicto: **NO APROBADO** (alertas Low+ pendientes: 1, tipos informativos pendientes: 2, aceptadas: 0)
- Codigo fuente sin cambios durante el escaneo: **NO** (resultado no valido, repetir)
- Sitios ajenos excluidos de la evaluacion: ninguno
- Peticiones a /session, /metrics y /api/v1 registradas por ZAP (con cookie o Bearer: 17):
  - `GET https://host.docker.internal:59794/session -> 200`: 15
  - `GET https://host.docker.internal:59794/metrics -> 200`: 2
  - `DELETE https://host.docker.internal:59794/session -> 204`: 1

| Riesgo | Confianza | Plugin | alertRef | Nombre | Instancias |
|---|---|---|---|---|---|
| Low | High | 10035 | 10035-1 | Strict-Transport-Security Header Not Set | 1 |
| Informational | Medium | 10024 | 10024 | Information Disclosure - Sensitive Information in URL | 2 |
| Informational | Medium | 10049 | 10049-1 | Non-Storable Content | 4 |

### Detalle

#### [Low] 10035 (10035-1) Strict-Transport-Security Header Not Set

- Confianza: High; CWE: 319
- URLs (1): `GET https://host.docker.internal:59794/`
- Parametros: -
- Evidencia: -
- Otra info: -

#### [Informational] 10024 (10024) Information Disclosure - Sensitive Information in URL

- Confianza: Medium; CWE: 598
- URLs (2): `GET https://host.docker.internal:59794/?invite-token=ZAP`, `GET https://host.docker.internal:59794/?invite-token=ZAP&name=ZAP&text=ZAP`
- Parametros: `invite-token`
- Evidencia: `invite-token`
- Otra info: The URL contains potentially sensitive information. The following string was found via the pattern: token invite-token

#### [Informational] 10049 (10049-1) Non-Storable Content

- Confianza: Medium; CWE: 524
- URLs (4): `GET https://host.docker.internal:59794/`, `GET https://host.docker.internal:59794/robots.txt`, `GET https://host.docker.internal:59794/session`, `GET https://host.docker.internal:59794/sitemap.xml`
- Parametros: -
- Evidencia: `no-store`
- Otra info: -

## Baseline de produccion: solo pasivo (sin autenticar)

- Objetivo: `https://miniwasp-production.up.railway.app`
- Inicio: 2026-11-19T00:07:21.923Z; fin: 2026-11-19T00:09:26.927Z
- ZAP 2.17.0; codigo de salida del script de ZAP: 2
- Comando: `docker run --rm --name miniwasp-zap-production-baseline-23456 --mount type=bind,source=D:\UTA\8vo_Semestre\Seguridad de Software\miniWasp\scripts\zap,target=/zap/hooks,readonly --mount type=bind,source=D:\UTA\8vo_Semestre\Seguridad de Software\miniWasp\docs\evidence\zap,target=/zap/wrk ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://miniwasp-production.up.railway.app -m 1 -r production-baseline-report.html -J production-baseline-report.json -w production-baseline-report.md`
- Veredicto: **NO APROBADO** (alertas Low+ pendientes: 0, tipos informativos pendientes: 2, aceptadas: 0)
- Codigo fuente sin cambios durante el escaneo: si
- Sitios ajenos excluidos de la evaluacion: ninguno
- Verificacion de autenticacion: no disponible para esta corrida

| Riesgo | Confianza | Plugin | alertRef | Nombre | Instancias |
|---|---|---|---|---|---|
| Informational | Medium | 10024 | 10024 | Information Disclosure - Sensitive Information in URL | 2 |
| Informational | Medium | 10049 | 10049-1 | Non-Storable Content | 5 |

### Detalle

#### [Informational] 10024 (10024) Information Disclosure - Sensitive Information in URL

- Confianza: Medium; CWE: 598
- URLs (2): `GET https://miniwasp-production.up.railway.app/?invite-token=ZAP`, `GET https://miniwasp-production.up.railway.app/?invite-token=ZAP&name=ZAP&text=ZAP`
- Parametros: `invite-token`
- Evidencia: `invite-token`
- Otra info: The URL contains potentially sensitive information. The following string was found via the pattern: token invite-token

#### [Informational] 10049 (10049-1) Non-Storable Content

- Confianza: Medium; CWE: 524
- URLs (5): `GET https://miniwasp-production.up.railway.app`, `GET https://miniwasp-production.up.railway.app/?invite-token=ZAP`, `GET https://miniwasp-production.up.railway.app/client/styles/icon.svg`, `GET https://miniwasp-production.up.railway.app/robots.txt`, `GET https://miniwasp-production.up.railway.app/sitemap.xml`
- Parametros: -
- Evidencia: `no-store`
- Otra info: -
