/**
 * Montagem do runtime: catálogo neutro, Permission Engine, Event Store,
 * estado dos agentes e API HTTP.
 *
 * INFRAESTRUTURA FUNCIONAL, NÃO AGENTES AUTÔNOMOS: nesta etapa o runtime não
 * chama modelos, não executa ferramentas, não escreve em disco e não roda
 * tarefas. Ele expõe o catálogo, o estado (todos os agentes em repouso) e os
 * eventos, e decide permissões que ainda nenhum executor consulta.
 */

import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { loadRuntimeCatalog } from "./catalog.ts";
import type { RuntimeCatalog } from "./catalog.ts";
import type { RuntimeConfig } from "./config.ts";
import { createInMemoryEventStore } from "./events/eventStore.ts";
import type { EventStore } from "./events/eventStore.ts";
import { createRuntimeHttpServer } from "./http/server.ts";
import { createPermissionEngine } from "./permissions/engine.ts";
import type { PermissionEngine } from "./permissions/engine.ts";
import { createAgentStateStore } from "./state/agentState.ts";
import type { AgentStateStore } from "./state/agentState.ts";

export interface RunningRuntime {
  url: string;
  port: number;
  catalog: RuntimeCatalog;
  permissions: PermissionEngine;
  events: EventStore;
  state: AgentStateStore;
  /** Streams SSE abertos (observabilidade e testes). */
  activeStreams(): number;
  /** Conexões TCP abertas no servidor (observabilidade e testes). */
  openConnections(): Promise<number>;
  close(): Promise<void>;
}

export async function startRuntime(config: RuntimeConfig): Promise<RunningRuntime> {
  const catalog = loadRuntimeCatalog(config.repoRoot);
  const permissions = createPermissionEngine(catalog.agents, { isolationEnabled: config.isolationEnabled });
  const events = createInMemoryEventStore({ maxEvents: config.maxEvents });
  const state = createAgentStateStore(catalog.ids);
  const http = createRuntimeHttpServer({ config, catalog, events, state });

  http.server.listen({ host: config.host, port: config.port, exclusive: true });
  await once(http.server, "listening");
  const { port } = http.server.address() as AddressInfo;
  const hostForUrl = config.host === "::1" ? "[::1]" : config.host;

  return {
    url: `http://${hostForUrl}:${port}`,
    port,
    catalog,
    permissions,
    events,
    state,
    activeStreams: () => http.activeStreams(),
    openConnections: () =>
      new Promise<number>((resolve, reject) => http.server.getConnections((error, count) => (error ? reject(error) : resolve(count)))),
    async close(): Promise<void> {
      http.closeStreams();
      const closed = once(http.server, "close");
      http.server.close();
      http.server.closeAllConnections();
      await closed;
    },
  };
}
