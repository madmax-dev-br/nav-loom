'use client';
import {ArrowUpRight, Check, Code2, GitBranch, MousePointer2, Plus, ScanLine, Workflow} from 'lucide-react';

export function ObservationWelcome({connected,onSetup,onCreate}:{connected:boolean;onSetup:()=>void;onCreate:()=>void}) {
  return <div className="observation-welcome">
    <div className="welcome-copy">
      <span className="welcome-symbol"><Workflow size={24}/></span>
      <h2>Conheça cada caminho<br/>da sua aplicação.</h2>
      <p>Transforme uma navegação real em um mapa de telas, estados e ações. Cada conexão guarda a evidência de como você chegou lá.</p>
      <div className="welcome-actions"><button className="agent-primary" onClick={onSetup}>Configurar aplicação <ArrowUpRight size={16}/></button><button onClick={onCreate} disabled={!connected}><Plus size={16}/> Novo projeto</button></div>
      <span className="welcome-support">Web e Android · Capturas reais · Histórico de execução</span>
    </div>
    <div className="flow-illustration" aria-label="Ilustração de um mapa de navegação, sem dados de execução">
      <div className="illustration-label"><span/> Como as observações se conectam</div>
      <div className="illustration-track">
        <div className="illustration-screen"><div className="mini-title"><i/><span>Tela de origem</span></div><div className="mini-browser"><span/><span/><span/></div><div className="mini-content"><div className="mini-avatar"/><i/><i/><div className="mini-button">Continuar <MousePointer2 size={15}/></div></div><footer><ScanLine size={12}/> Captura observada</footer></div>
        <div className="illustration-edge"><span>ação</span><div/><ArrowUpRight size={16}/></div>
        <div className="illustration-screen destination"><div className="mini-title"><i/><span>Próxima tela</span></div><div className="mini-browser"><span/><span/><span/></div><div className="mini-content"><div className="mini-check"><Check size={24}/></div><i/><i/></div><footer><GitBranch size={12}/> Caminho registrado</footer></div>
      </div>
      <div className="illustration-caption">Ilustração do fluxo · suas capturas aparecerão aqui</div>
    </div>
    <div className="welcome-guide">
      <div><ScanLine size={20}/><h3>Conecte sua aplicação</h3><p>Escolha um endereço Web ou um dispositivo Android.</p></div>
      <div><MousePointer2 size={20}/><h3>Defina o que explorar</h3><p>Prepare uma missão e conecte o agente para navegar.</p></div>
      <div><Code2 size={20}/><h3>Consulte as evidências</h3><p>Revise capturas, transições e resultados em um só lugar.</p></div>
    </div>
  </div>;
}
