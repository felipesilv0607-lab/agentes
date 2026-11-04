import { useState } from "react";
import { activities, metrics, navigation } from "./mocks/dashboard";
import type { PanelId } from "./types/dashboard";

const panelCopy: Record<PanelId, { title: string; description: string }> = {
  monitoring: { title: "Monitoramento", description: "Visão demonstrativa dos agentes e das atividades do sistema." },
  security: { title: "Segurança", description: "Acompanhamento ilustrativo dos controles e das 16 categorias do padrão." },
  workflow: { title: "Fluxo de trabalho", description: "Exemplo de tarefas, delegações, revisões e aprovações." },
  audit: { title: "Logs e evidências", description: "Exemplo de histórico e rastreabilidade. Nenhum evento é real." }
};

function App() {
  const [activePanel, setActivePanel] = useState<PanelId>("monitoring");
  const current = panelCopy[activePanel];

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#inicio" aria-label="Agente.s início">
        <span className="brand-mark">A.</span><span><strong>Agente.s</strong><small>AI SOFTWARE FACTORY</small></span>
      </a>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Navegação principal">
        {navigation.map(item => <button className={`nav-item ${activePanel === item.id ? "active" : ""}`}
          key={item.id} type="button" onClick={() => setActivePanel(item.id)}
          aria-current={activePanel === item.id ? "page" : undefined}>
          <span className="nav-symbol" aria-hidden="true">{item.symbol}</span>{item.label}
        </button>)}
      </nav>
      <div className="sidebar-bottom"><div className="profile-avatar">FL</div>
        <div className="profile-copy"><strong>Administrador</strong><small>Ambiente local</small></div>
        <span className="profile-menu" aria-hidden="true">···</span>
      </div>
    </aside>
    <main className="main-content" id="inicio">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> {current.title}</div>
        <div className="topbar-right"><span className="environment"><i /> Ambiente demonstrativo</span><span className="avatar-small">FL</span></div>
      </header>
      <section className="page-content">
        <div className="page-heading"><div><div className="eyebrow">CENTRAL DE OPERAÇÕES</div>
          <h1>{current.title}</h1><p>{current.description}</p></div><span className="demo-badge"><span /> MODO DEMO</span></div>

        {activePanel === "monitoring" && <>
          <div className="metric-grid">{metrics.map(metric => <article className="metric-card" key={metric.label}>
            <span className="metric-label">{metric.label}</span><strong className="metric-value">{metric.value}</strong>
            <span className="metric-detail">{metric.detail}</span></article>)}</div>
          <section className="content-card"><div className="card-heading"><div><h2>Atividade recente</h2>
            <p>Eventos ilustrativos do ambiente DEMO</p></div><span className="subtle-tag">Últimos eventos</span></div>
            <div className="activity-list">{activities.map(activity => <div className="activity-row" key={activity.title}>
              <span className="activity-dot" /><div className="activity-main"><strong>{activity.title}</strong>
                <span>{activity.description}</span></div>
              <span className={`status status-${activity.status === "Concluído" ? "done" : activity.status === "Em revisão" ? "review" : "waiting"}`}>{activity.status}</span>
              <time>{activity.time}</time></div>)}</div>
          </section>
        </>}
        {activePanel === "security" && <section className="content-card panel-card">
          <div className="panel-icon security-icon">◇</div><div><h2>Baseline de segurança</h2><p>16 categorias definidas no padrão global do Agente.s.</p></div>
          <div className="category-grid">{["Aplicação","Autenticação","Autorização","Dados e privacidade","Segredos","API e comunicação","Infraestrutura","Dependências","Código seguro","Testes de segurança","Logs e monitoramento","Resposta a incidentes","Backup e continuidade","Segurança de IA","CI/CD","Governança"].map((item,index) =>
            <div className="category-item" key={item}><span>{String(index+1).padStart(2,"0")}</span>{item}</div>)}</div>
          <p className="notice">Conteúdo demonstrativo. A presença de uma categoria na interface não comprova a implementação ou aprovação de seus controles.</p>
        </section>}
        {activePanel === "workflow" && <section className="content-card panel-card">
          <div className="panel-icon workflow-icon">⇄</div><div><h2>Esteira de trabalho</h2><p>Fluxo ilustrativo de execução e revisão.</p></div>
          <div className="workflow-steps">{["Analisar","Planejar","Implementar","Testar","Revisar","Apresentar"].map((step,index) =>
            <div className="workflow-step" key={step}><span>{index+1}</span><strong>{step}</strong></div>)}</div>
          <p className="notice">As etapas representam o fluxo documentado do projeto; nenhuma tarefa está sendo executada por agentes nesta versão.</p>
        </section>}
        {activePanel === "audit" && <section className="content-card panel-card">
          <div className="panel-icon audit-icon">≡</div><div><h2>Registro de eventos</h2><p>Exemplo visual de trilha de auditoria.</p></div>
          {[["09:42:00","DEMO.task.completed","Evento fictício · DEMO-024"],["09:35:12","DEMO.review.started","Evento fictício · DEMO-023"],["09:18:44","DEMO.security.pending","Evento fictício · DEMO-022"]].map(event =>
            <div className="audit-event" key={event[1]}><span className="audit-time">{event[0]}</span><strong>{event[1]}</strong><span>{event[2]}</span></div>)}
          <p className="notice">Não há conexão com o Codex App Server nem persistência de eventos nesta etapa.</p>
        </section>}
        <footer className="page-footer"><span>Agente.s <span className="footer-separator">·</span> Fundação do dashboard</span>
          <span>Dados sintéticos — não representam atividade real</span></footer>
      </section>
    </main>
  </div>;
}
export default App;
