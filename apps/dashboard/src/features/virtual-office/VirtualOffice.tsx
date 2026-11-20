import { lazy, Suspense, useState } from "react";
import { DemoAgentProvider } from "../../services/agents/DemoAgentProvider";
import {
  agentStatusClassNames as statusClasses,
  agentStatusLabels as statusLabels,
} from "../../data/agentStatus";
import "./VirtualOffice.css";

const VirtualOfficeScene = lazy(() =>
  import("./VirtualOfficeScene").then((module) => ({
    default: module.VirtualOfficeScene,
  })),
);

const provider = new DemoAgentProvider();
const snapshot = provider.getSnapshot();

export function VirtualOffice() {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    snapshot.agents[0]?.id ?? "",
  );
  const selectedAgent =
    snapshot.agents.find((agent) => agent.id === selectedAgentId) ??
    snapshot.agents[0];

  return (
    <section className="virtual-office" aria-label="Escritório virtual dos agentes">
      <div className="office-heading">
        <div>
          <span className="office-eyebrow">AMBIENTE DE OPERAÇÕES</span>
          <h2>Escritório virtual</h2>
          <p>Visão demonstrativa da equipe de agentes do Agente.s.</p>
        </div>
        <span className="office-demo-label">SIMULAÇÃO DEMO</span>
      </div>

      <div className="office-layout">
        <div className="office-floor" role="group" aria-label="Estações de trabalho dos agentes">
          <Suspense
        fallback={
       <div className="office-scene" role="status">
      Carregando ambiente 3D...
      </div>
       }
  >
  <VirtualOfficeScene
    agents={snapshot.agents}
    selectedAgentId={selectedAgent?.id ?? ""}
    onSelect={setSelectedAgentId}
  />
</Suspense>
          <div
            className="office-agent-picker"
            role="group"
            aria-label="Selecionar agente (alternativa acessível ao escritório 3D)"
          >
            {snapshot.agents.map((agent) => {
              const isSelected = agent.id === selectedAgent?.id;
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`office-agent-option${isSelected ? " is-selected" : ""}`}
                  // Seleção única: indica o agente atual (aria-pressed sugeriria
                  // um botão liga/desliga, mas clicar no selecionado não o desmarca).
                  aria-current={isSelected ? "true" : undefined}
                  aria-label={`${agent.name}, ${agent.role}, estado: ${statusLabels[agent.status]}`}
                  onClick={() => setSelectedAgentId(agent.id)}
                >
                  <strong>{agent.name}</strong>
                  <span className={`agent-status status-${statusClasses[agent.status]}`}>
                    <i aria-hidden="true" />
                    {statusLabels[agent.status]}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="office-floor-note">
          Ambiente 3D demonstrativo. Os agentes e suas atividades utilizam dados simulados.
        </div>
        </div>

        <aside className="agent-inspector" aria-live="polite">
          {selectedAgent ? (
            <>
              <span className="inspector-label">AGENTE SELECIONADO</span>
              <div className={`inspector-avatar avatar-${selectedAgent.id}`}>
                {selectedAgent.name.slice(0, 1)}
              </div>
              <h3>{selectedAgent.name}</h3>
              <p className="inspector-role">{selectedAgent.role}</p>
              <div className={`inspector-status status-${statusClasses[selectedAgent.status]}`}>
                <i />
                {statusLabels[selectedAgent.status]}
              </div>
              <div className="inspector-divider" />
              <span className="inspector-label">TAREFA ATUAL</span>
              <p className="inspector-task">
                {selectedAgent.currentTask ?? "Nenhuma tarefa atribuída"}
              </p>
              <span className="inspector-label">ÚLTIMA ATIVIDADE</span>
              <p className="inspector-time">{selectedAgent.lastActivity}</p>
            </>
          ) : (
            <p>Nenhum agente disponível.</p>
          )}
          <span className="inspector-source">Fonte dos dados: {snapshot.source.toUpperCase()}</span>
        </aside>
      </div>

      <div className="office-summary">
        <span>{snapshot.agents.length} agentes cadastrados</span>
        <span>Dados sintéticos — nenhuma execução real está conectada.</span>
      </div>
    </section>
  );
}
