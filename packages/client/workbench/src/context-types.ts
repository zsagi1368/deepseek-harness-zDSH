/**
 * The slice of the host runtime this package's Node half consumes. Types come
 * from the real `webServer` service owner (@deepseek-ai/dsh-host-webserver), so
 * this package never re-declares the cordis `Context.webServer` augmentation
 * that service itself already carries.
 */
export type { WebRoute, WebRouteKind, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
export type { IncomingMessage as HttpRequest, ServerResponse as HttpResponse } from 'node:http'
