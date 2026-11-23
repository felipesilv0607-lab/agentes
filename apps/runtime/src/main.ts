/**
 * Ponto de entrada: `node src/main.ts` (Node 24, sem etapa de build).
 * Nunca registra o token nem variáveis de ambiente.
 */

import { startRuntime } from "./app.ts";
import { ConfigError, loadConfig } from "./config.ts";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    console.error(error instanceof ConfigError ? `configuração inválida: ${error.message}` : "configuração inválida");
    process.exitCode = 1;
    return;
  }

  const runtime = await startRuntime(config);
  console.log(`Agente.s runtime em ${runtime.url} | agentes no catálogo: ${runtime.catalog.ids.length} | execução de agentes: desativada | isolamento: desativado`);

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    runtime.close().then(
      () => console.log("runtime encerrado"),
      () => {
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((error: unknown) => {
  console.error(`falha ao iniciar o runtime: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  process.exitCode = 1;
});
