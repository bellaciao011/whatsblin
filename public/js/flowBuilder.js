// WhatsHub Pro - Visual Flow Builder Engine (Estilo n8n / Typebot)
const FlowBuilder = {
  currentFlow: null,
  isDraggingNode: false,
  draggedNode: null,
  hasDraggedNode: false,
  dragStartMouse: { x: 0, y: 0 },
  dragStartNodePos: { x: 0, y: 0 },
  
  // Pan e Zoom do Canvas
  panX: 0,
  panY: 0,
  canvasScale: 1,
  isPanning: false,
  panStart: { x: 0, y: 0 },
  toolsDrawerOpen: false,

  // Conexão manual de portas (Wiring)
  isConnecting: false,
  connectFromNodeId: null,
  connectStartPos: { x: 0, y: 0 },
  currentMousePos: { x: 0, y: 0 },

  // Lista oficial de ferramentas com metadados e ícones (Screenshots 4 & 5)
  availableTools: [
    { type: 'message', label: 'Mensagem', icon: '💬', color: 'blue', desc: 'Envio de mensagem de texto com variáveis' },
    { type: 'template', label: 'Template WhatsApp', icon: '📄', color: 'blue', desc: 'Modelo oficial aprovado pela Meta' },
    { type: 'tag', label: 'Etiquetas', icon: '🏷️', color: 'purple', desc: 'Adicionar etiqueta ou tag ao lead' },
    { type: 'pix', label: 'Botão PIX', icon: '💳', color: 'green', desc: 'Gerar e enviar cobrança Pix imediata' },
    { type: 'menu', label: 'Menu Interativo', icon: '📋', color: 'purple', desc: 'Menu com lista de opções interativas' },
    { type: 'carousel', label: 'Carrossel', icon: '🖼️', color: 'cyan', desc: 'Carrossel interativo de produtos' },
    { type: 'wait', label: 'Aguarda Resposta', icon: '⏳', color: 'orange', desc: 'Pausa o fluxo até o lead enviar mensagem' },
    { type: 'chat_ctrl', label: 'Controlador de Chat', icon: '💭', color: 'cyan', desc: 'Gerenciar status e fila de atendimento' },
    { type: 'notification', label: 'Notificação', icon: '🔔', color: 'cyan', desc: 'Notificar atendente no WhatsApp ou Email' },
    { type: 'condition', label: 'Condicional', icon: '🔀', color: 'purple', desc: 'Desvio de rota por condição (SE/SENÃO)' },
    { type: 'distributor', label: 'Distribuidor', icon: '🔀', color: 'amber', desc: 'Distribuição entre múltiplos atendentes' },
    { type: 'pixel', label: 'Pixel', icon: '🎯', color: 'amber', desc: 'Disparar evento do Facebook Pixel' },
    { type: 'delay', label: 'Intervalo Inteligente', icon: '⏱️', color: 'cyan', desc: 'Pausa realista simulando digitação' },
    { type: 'dept', label: 'Departamento', icon: '🏢', color: 'purple', desc: 'Transferir lead para setor específico' },
    { type: 'integration', label: 'Integração / API', icon: '🌐', color: 'darkblue', desc: 'Consulta de API externa ou Webhook' },
    { type: 'media', label: 'Mídia / Prova', icon: '📸', color: 'green', desc: 'Envio de áudio, vídeo ou prova gerada' },
    { type: 'ai', label: 'Bloco de IA', icon: '🤖', color: 'emerald', desc: 'Inteligência Artificial (ChatGPT/Kie.ai)' },
    { type: 'kanban_step', label: 'Kanban', icon: '🗂️', color: 'purple', desc: 'Mover lead entre colunas do CRM' },
    { type: 'handler', label: 'Manipulador', icon: '⚙️', color: 'amber', desc: 'Manipulação avançada de variáveis' },
    { type: 'sale', label: 'Venda aprovada', icon: '💲', color: 'green', desc: 'Gatilho de compra confirmada' },
    { type: 'payment', label: 'Pagamento / Link', icon: '💳', color: 'purple', desc: 'Enviar link de pagamento de checkout' },
    { type: 'call', label: 'Ligar', icon: '📞', color: 'cyan', desc: 'Ação de ligação ou chamada de voz' },
    { type: 'kie', label: 'Integração Kie.ai', icon: '✨', color: 'purple', desc: 'Conector com motor inteligente Kie.ai' }
  ],

  /**
   * TELA 1: LISTA DE FLUXOS (SCREENSHOT 2)
   */
  async renderList(container) {
    const flows = await fetch('/api/flows').then(r => r.json());

    container.innerHTML = `
      <div>
        <div class="flows-header-bar">
          <div>
            <h2 style="font-size: 22px; font-weight: 700; font-family: 'Outfit', sans-serif;">Fluxos</h2>
            <p style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">Automações e fluxos visuais de atendimento no WhatsApp</p>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-primary" onclick="FlowBuilder.createFlow()">+ Novo fluxo</button>
            <button class="btn btn-secondary" onclick="showToast('Criar pasta...')">📁 Pasta</button>
            <button class="btn btn-secondary" onclick="showToast('Importar fluxo JSON...')">📥 Importar</button>
          </div>
        </div>

        <div class="card" style="padding: 16px; margin-bottom: 20px; background: rgba(18, 24, 38, 0.4);">
          <input type="text" class="form-input" placeholder="🔍 Buscar fluxos..." style="max-width: 400px;" oninput="FlowBuilder.filterFlows(this.value)">
        </div>

        <div class="flows-tabs">
          <button class="flows-tab-btn active" onclick="FlowBuilder.filterTab('todos', this)">Todos</button>
          <button class="flows-tab-btn" onclick="FlowBuilder.filterTab('ativo', this)">Ativos</button>
          <button class="flows-tab-btn" onclick="FlowBuilder.filterTab('pausado', this)">Pausados</button>
        </div>

        <div class="card" style="padding: 0; overflow: hidden; background: rgba(18, 24, 38, 0.7);">
          <table class="flows-table">
            <thead>
              <tr>
                <th style="width: 40px;"></th>
                <th>Nome</th>
                <th>Status</th>
                <th>Blocos</th>
                <th>Atualizado</th>
                <th style="text-align: right;">Ações</th>
              </tr>
            </thead>
            <tbody id="flows-table-body">
              ${flows.map(f => `
                <tr onclick="FlowBuilder.openCanvas('${f.id}')">
                  <td style="color: var(--text-muted); font-size: 18px;">⋮⋮</td>
                  <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                      <span style="color: ${f.status === 'ativo' ? 'var(--wa-green)' : 'var(--text-muted)'}; font-size: 10px;">●</span>
                      <strong style="color: #fff; font-size: 14px;">${f.name}</strong>
                    </div>
                  </td>
                  <td>
                    <span class="btn" style="padding: 3px 8px; font-size: 11px; background: ${f.status === 'ativo' ? 'rgba(37, 211, 102, 0.15)' : 'rgba(255, 255, 255, 0.05)'}; color: ${f.status === 'ativo' ? 'var(--wa-green)' : 'var(--text-muted)'};">
                      ● ${f.status.toUpperCase()}
                    </span>
                  </td>
                  <td style="color: #c7d2fe; font-size: 13px;">
                    ⚡ ${f.nodes ? f.nodes.length : f.blocksCount || 0}
                  </td>
                  <td style="color: var(--text-muted); font-size: 12px;">
                    ${new Date(f.updatedAt).toLocaleDateString()} ${new Date(f.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                  </td>
                  <td style="text-align: right;" onclick="event.stopPropagation()">
                    <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="FlowBuilder.openCanvas('${f.id}')">Abrir no Canvas ➔</button>
                    <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px;" title="Duplicar fluxo" onclick="FlowBuilder.duplicateFlow('${f.id}')">📋</button>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 12px; margin-left: 4px;" title="Excluir fluxo permanentemente" onclick="FlowBuilder.deleteFlow('${f.id}')">🗑️</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  /**
   * TELA 2: CANVAS VISUAL ESTILO N8N (SCREENSHOTS 3, 4, 5)
   */
  async openCanvas(flowId) {
    window.location.hash = `#flow-canvas?id=${flowId}`;
  },

  async renderCanvas(container, flowId) {
    const flow = await fetch(`/api/flows/${flowId}`).then(r => r.json());
    this.currentFlow = flow;
    this.panX = 0;
    this.panY = 0;
    this.canvasScale = 1;

    container.innerHTML = `
      <div class="canvas-root" id="canvas-root">
        <!-- Floating Top Bar -->
        <div class="canvas-topbar">
          <div class="canvas-top-left">
            <button class="btn-tools" onclick="FlowBuilder.toggleToolsDrawer()">
              <span>🧰</span>
              <span>Ferramentas</span>
            </button>
            <button class="btn-simulate" onclick="FlowBuilder.runVisualSimulation()">
              <span>▶️</span>
              <span>Simular</span>
            </button>
            <span style="color: #fff; font-weight: 700; font-size: 15px; margin-left: 12px;">
              ${flow.name}
            </span>
            <span style="font-size: 12px; color: #a78bfa; background: rgba(167, 139, 250, 0.15); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(167, 139, 250, 0.3);">
              💡 Dica: Arraste da bolinha roxa de um bloco para a bolinha azul de outro para conectar manualmente!
            </span>
          </div>

          <div style="display: flex; gap: 10px;">
            <button class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;" onclick="FlowBuilder.deleteFlow('${flow.id}')" title="Excluir este fluxo">
              🗑️ Excluir Fluxo
            </button>
            <button class="btn btn-primary" onclick="FlowBuilder.saveCurrentFlow()">
              💾 Salvar Fluxo
            </button>
            <button class="btn btn-secondary" onclick="window.location.hash='#flows'">
              ✕ Fechar
            </button>
          </div>
        </div>

        <!-- Zoom Floating Controls (Canto Inferior Esquerdo) -->
        <div class="canvas-zoom-controls">
          <button class="zoom-btn" onclick="FlowBuilder.adjustZoom(0.15)" title="Aproximar (+)">➕</button>
          <span class="zoom-level" id="zoom-level-text">100%</span>
          <button class="zoom-btn" onclick="FlowBuilder.adjustZoom(-0.15)" title="Afastar (-)">➖</button>
          <button class="zoom-btn" onclick="FlowBuilder.resetZoom()" title="Redefinir / Centralizar">🎯</button>
        </div>

        <!-- Tools Drawer (Screenshots 4 & 5) -->
        <div class="tools-drawer" id="tools-drawer" style="display: none;">
          <div class="tools-search-box">
            <input type="text" class="tools-search-input" placeholder="Buscar blocos..." oninput="FlowBuilder.filterTools(this.value)">
          </div>
          <div class="tools-list" id="tools-list">
            ${this.availableTools.map(t => `
              <div class="tool-item" onclick="FlowBuilder.addNodeToCanvas('${t.type}')">
                <span class="tool-icon">${t.icon}</span>
                <span>${t.label}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Canvas World (Transformado com Pan & Zoom) -->
        <div class="canvas-world" id="canvas-world">
          <!-- SVG Connections Layer -->
          <svg class="canvas-svg" id="canvas-svg"></svg>

          <!-- Viewport dos Nós -->
          <div class="canvas-viewport" id="canvas-viewport">
            ${flow.nodes.map(n => this.renderNodeHtml(n)).join('')}
          </div>
        </div>

        <!-- Mini-mapa Flutuante (Screenshot 3) -->
        <div class="minimap">
          <div class="minimap-content" id="minimap-content"></div>
        </div>
      </div>
    `;

    this.initCanvasInteractions();
    this.bindNodesEvents();
    this.drawConnections();
    this.updateMiniMap();
    this.applyTransform();
  },

  renderNodeHtml(node) {
    let summaryText = 'Configuração ativa';
    if (node.data) {
      if (node.data.text) summaryText = node.data.text;
      else if (node.data.rule) summaryText = `Regra: ${node.data.rule}`;
      else if (node.data.template) summaryText = `Modelo: ${node.data.template}`;
      else if (node.data.seconds) summaryText = `Espera ${node.data.seconds}s (Digitando)`;
      else if (node.data.prompt) summaryText = `Prompt IA: ${node.data.prompt}`;
      else if (node.data.endpoint) summaryText = `API: ${node.data.endpoint}`;
      else if (node.data.timeout) summaryText = node.data.timeout;
    }

    return `
      <div class="flow-node" id="${node.id}" style="left: ${node.x}px; top: ${node.y}px;">
        <div class="node-header ${node.color || 'blue'}">
          <span>${node.icon || '⚡'}</span>
          <span>${node.label}</span>
        </div>
        <div class="node-body">
          ${summaryText}
        </div>
        <div class="node-port port-in" title="Porta de Entrada (Conectar aqui)"></div>
        <div class="node-port port-out" title="Porta de Saída (Puxar cabo daqui)"></div>
      </div>
    `;
  },

  bindNodesEvents() {
    const nodes = document.querySelectorAll('.flow-node');
    nodes.forEach(nodeEl => {
      this.bindSingleNode(nodeEl);
    });
  },

  bindSingleNode(nodeEl) {
    // Clique simples abre o modal (se não tiver sido arrastado e se não estiver conectando cabo)
    nodeEl.addEventListener('click', (e) => {
      if (this.hasDraggedNode || this.isConnecting) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      this.openNodeModal(nodeEl.id);
    });

    // Mousedown para início de arraste do nó
    nodeEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.classList.contains('node-port')) return;

      this.isDraggingNode = true;
      this.draggedNode = nodeEl;
      this.hasDraggedNode = false;
      this.dragStartMouse = { x: e.clientX, y: e.clientY };

      const left = parseFloat(nodeEl.style.left) || 0;
      const top = parseFloat(nodeEl.style.top) || 0;
      this.dragStartNodePos = { x: left, y: top };

      e.stopPropagation();
    });

    // Porta de saída (out): Inicia conexão manual de cabo
    const portOut = nodeEl.querySelector('.port-out');
    if (portOut) {
      portOut.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startConnecting(nodeEl.id, e);
      });
    }

    // Porta de entrada (in): Finaliza conexão manual de cabo
    const portIn = nodeEl.querySelector('.port-in');
    if (portIn) {
      portIn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isConnecting && this.connectFromNodeId && this.connectFromNodeId !== nodeEl.id) {
          this.finishConnecting(nodeEl.id);
        }
      });
    }
  },

  startConnecting(fromNodeId, e) {
    this.isConnecting = true;
    this.connectFromNodeId = fromNodeId;
    const node = this.currentFlow.nodes.find(n => n.id === fromNodeId);
    this.connectStartPos = { x: node.x + 210, y: node.y + 40 };
    showToast('Cabo iniciado! Agora clique na porta azul (esquerda) do bloco de destino.', 'info');
  },

  finishConnecting(toNodeId) {
    if (!this.connectFromNodeId || this.connectFromNodeId === toNodeId) return;

    const fromNode = this.currentFlow.nodes.find(n => n.id === this.connectFromNodeId);
    const toNode = this.currentFlow.nodes.find(n => n.id === toNodeId);

    let defaultLabel = 'Próximo passo';
    if (fromNode.type === 'condition') defaultLabel = '🟢 Resposta Positiva';
    else if (fromNode.type === 'ai') defaultLabel = '✅ Aprovado';

    const branchLabel = prompt(`Conectar "${fromNode.label}" ➔ "${toNode.label}":\nDigite o nome desta ramificação (ex: Positivo, Negativo, Dúvida, Comprovante):`, defaultLabel);

    if (!this.currentFlow.edges) this.currentFlow.edges = [];
    this.currentFlow.edges.push({
      id: `e_${Date.now()}`,
      from: this.connectFromNodeId,
      to: toNodeId,
      label: branchLabel || ''
    });

    this.isConnecting = false;
    this.connectFromNodeId = null;
    this.drawConnections();
    showToast(`Conexão criada: ${fromNode.label} ➔ ${toNode.label}!`, 'success');
  },

  manageEdge(edgeId) {
    const edge = this.currentFlow.edges.find(e => e.id === edgeId);
    if (!edge) return;

    const fromNode = this.currentFlow.nodes.find(n => n.id === edge.from);
    const toNode = this.currentFlow.nodes.find(n => n.id === edge.to);

    const action = prompt(`Cabo de Conexão:\nDe: "${fromNode?.label || edge.from}"\nPara: "${toNode?.label || edge.to}"\nRótulo atual: "${edge.label || 'Sem rótulo'}"\n\nDigite:\n1: Alterar nome/rótulo do cabo\n2: Excluir este cabo\n0: Cancelar`, '1');

    if (action === '1') {
      const newLabel = prompt('Novo nome para este cabo/ramificação:', edge.label || '');
      if (newLabel !== null) {
        edge.label = newLabel;
        this.drawConnections();
        showToast('Rótulo do cabo atualizado!');
      }
    } else if (action === '2') {
      this.currentFlow.edges = this.currentFlow.edges.filter(e => e.id !== edgeId);
      this.drawConnections();
      showToast('Cabo de conexão excluído!');
    }
  },

  initCanvasInteractions() {
    const canvasRoot = document.getElementById('canvas-root');
    if (!canvasRoot) return;

    // 1. ZOOM COM A RODINHA DO MOUSE
    canvasRoot.addEventListener('wheel', (e) => {
      if (e.target.closest('#tools-drawer') || e.target.closest('#node-config-modal')) return;

      e.preventDefault();

      const rect = canvasRoot.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      const oldScale = this.canvasScale;
      let newScale = oldScale * zoomFactor;

      newScale = Math.max(0.25, Math.min(2.5, newScale));

      this.panX = mouseX - (mouseX - this.panX) * (newScale / oldScale);
      this.panY = mouseY - (mouseY - this.panY) * (newScale / oldScale);
      this.canvasScale = newScale;

      this.applyTransform();
    }, { passive: false });

    // 2. PAN (ARRASTAR FUNDO DO CANVAS)
    canvasRoot.addEventListener('mousedown', (e) => {
      if (
        e.target.closest('.flow-node') ||
        e.target.closest('.canvas-topbar') ||
        e.target.closest('.tools-drawer') ||
        e.target.closest('.canvas-zoom-controls') ||
        e.target.closest('.minimap') ||
        e.target.closest('#node-config-modal') ||
        e.target.closest('.node-port')
      ) {
        return;
      }

      if (e.button === 0 || e.button === 1) {
        this.isPanning = true;
        this.panStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
        canvasRoot.classList.add('panning');
      }
    });

    // 3. MOVIMENTO DO MOUSE (PAN, ARRASTE OU CABO TEMPORÁRIO)
    window.addEventListener('mousemove', (e) => {
      // Arrastando cabo temporário
      if (this.isConnecting) {
        const rootRect = canvasRoot.getBoundingClientRect();
        this.currentMousePos = {
          x: (e.clientX - rootRect.left - this.panX) / this.canvasScale,
          y: (e.clientY - rootRect.top - this.panY) / this.canvasScale
        };
        this.drawConnections();
        return;
      }

      // Arrastando um nó
      if (this.isDraggingNode && this.draggedNode) {
        const moveDist = Math.hypot(e.clientX - this.dragStartMouse.x, e.clientY - this.dragStartMouse.y);
        if (moveDist > 4) {
          this.hasDraggedNode = true;
        }

        const dx = (e.clientX - this.dragStartMouse.x) / this.canvasScale;
        const dy = (e.clientY - this.dragStartMouse.y) / this.canvasScale;

        const newX = Math.round(this.dragStartNodePos.x + dx);
        const newY = Math.round(this.dragStartNodePos.y + dy);

        this.draggedNode.style.left = `${newX}px`;
        this.draggedNode.style.top = `${newY}px`;

        const nodeObj = this.currentFlow.nodes.find(n => n.id === this.draggedNode.id);
        if (nodeObj) {
          nodeObj.x = newX;
          nodeObj.y = newY;
        }

        this.drawConnections();
        this.updateMiniMap();
        return;
      }

      // Arrastando o fundo do canvas (pan)
      if (this.isPanning) {
        this.panX = e.clientX - this.panStart.x;
        this.panY = e.clientY - this.panStart.y;
        this.applyTransform();
      }
    });

    // 4. SOLTURA DO MOUSE
    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        canvasRoot.classList.remove('panning');
      }

      if (this.isDraggingNode) {
        setTimeout(() => {
          this.isDraggingNode = false;
          this.draggedNode = null;
          this.hasDraggedNode = false;
        }, 80);
      }
    });

    // Tecla Escape cancela ligação de cabo
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isConnecting) {
        this.isConnecting = false;
        this.connectFromNodeId = null;
        this.drawConnections();
        showToast('Ligação de cabo cancelada');
      }
    });
  },

  applyTransform() {
    const world = document.getElementById('canvas-world');
    const root = document.getElementById('canvas-root');
    const zoomText = document.getElementById('zoom-level-text');

    if (world) {
      world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.canvasScale})`;
      world.style.transformOrigin = '0 0';
    }

    if (root) {
      const bgSize = Math.round(22 * this.canvasScale);
      root.style.backgroundSize = `${bgSize}px ${bgSize}px`;
      root.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
    }

    if (zoomText) {
      zoomText.textContent = `${Math.round(this.canvasScale * 100)}%`;
    }

    this.updateMiniMap();
  },

  adjustZoom(delta) {
    const canvasRoot = document.getElementById('canvas-root');
    const rect = canvasRoot ? canvasRoot.getBoundingClientRect() : { width: 800, height: 600 };
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const oldScale = this.canvasScale;
    let newScale = Math.max(0.25, Math.min(2.5, oldScale + delta));

    this.panX = centerX - (centerX - this.panX) * (newScale / oldScale);
    this.panY = centerY - (centerY - this.panY) * (newScale / oldScale);
    this.canvasScale = newScale;

    this.applyTransform();
  },

  resetZoom() {
    this.canvasScale = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
    showToast('Zoom centralizado em 100%');
  },

  drawConnections() {
    const svg = document.getElementById('canvas-svg');
    if (!svg || !this.currentFlow) return;

    const edges = this.currentFlow.edges || [];
    let svgHtml = '';

    edges.forEach(edge => {
      const fromNode = this.currentFlow.nodes.find(n => n.id === edge.from);
      const toNode = this.currentFlow.nodes.find(n => n.id === edge.to);

      if (fromNode && toNode) {
        const x1 = fromNode.x + 210;
        const y1 = fromNode.y + 40;
        const x2 = toNode.x;
        const y2 = toNode.y + 40;

        const dx = Math.max(60, (x2 - x1) * 0.45);
        const cx1 = x1 + dx;
        const cy1 = y1;
        const cx2 = x2 - dx;
        const cy2 = y2;

        const pathD = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const labelText = edge.label || '';
        const badgeWidth = Math.max(80, labelText.length * 7.5 + 24);

        // Cor de destaque da aresta se tiver rótulo semântico
        let edgeColor = '#6366f1';
        if (labelText.includes('Positiva') || labelText.includes('Aprovado')) edgeColor = '#10b981';
        else if (labelText.includes('Dúvida') || labelText.includes('Sigilo')) edgeColor = '#f59e0b';
        else if (labelText.includes('Negativa') || labelText.includes('Aleatória')) edgeColor = '#ef4444';

        svgHtml += `
          <g class="canvas-edge-group" id="edge-group-${edge.id}">
            <path id="edge-${edge.id}" class="canvas-edge" d="${pathD}" style="stroke: ${edgeColor};" onclick="FlowBuilder.manageEdge('${edge.id}')" />
            ${edge.label ? `
              <g onclick="FlowBuilder.manageEdge('${edge.id}')" style="cursor: pointer;">
                <rect x="${midX - badgeWidth / 2}" y="${midY - 14}" width="${badgeWidth}" height="24" rx="12" fill="#110e2e" stroke="${edgeColor}" stroke-width="1.5" />
                <text x="${midX}" y="${midY + 3}" fill="#fff" font-size="11" font-weight="600" text-anchor="middle" style="pointer-events: none;">
                  ${edge.label}
                </text>
              </g>
            ` : ''}
          </g>
        `;
      }
    });

    // Se estiver conectando um novo cabo manualmente com o mouse
    if (this.isConnecting && this.connectStartPos && this.currentMousePos) {
      const x1 = this.connectStartPos.x;
      const y1 = this.connectStartPos.y;
      const x2 = this.currentMousePos.x;
      const y2 = this.currentMousePos.y;
      const dx = Math.max(40, (x2 - x1) * 0.45);
      const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      svgHtml += `<path class="canvas-edge temp" d="${pathD}" />`;
    }

    svg.innerHTML = svgHtml;
  },

  updateMiniMap() {
    const content = document.getElementById('minimap-content');
    if (!content || !this.currentFlow) return;

    const scale = 220 / 6400;
    let html = this.currentFlow.nodes.map(n => `
      <div class="minimap-node" style="left: ${n.x * scale}px; top: ${n.y * scale * 0.5}px; width: ${210 * scale}px; height: 12px; background: ${this.getNodeColorHex(n.color)};"></div>
    `).join('');

    const canvasRoot = document.getElementById('canvas-root');
    if (canvasRoot) {
      const viewW = (canvasRoot.clientWidth / this.canvasScale) * scale;
      const viewH = (canvasRoot.clientHeight / this.canvasScale) * scale * 0.5;
      const viewX = (-this.panX / this.canvasScale) * scale;
      const viewY = (-this.panY / this.canvasScale) * scale * 0.5;

      html += `
        <div style="position: absolute; left: ${viewX}px; top: ${viewY}px; width: ${viewW}px; height: ${viewH}px; border: 1.5px solid #a855f7; background: rgba(168, 85, 247, 0.15); border-radius: 4px; pointer-events: none;"></div>
      `;
    }

    content.innerHTML = html;
  },

  getNodeColorHex(color) {
    const map = { green: '#059669', blue: '#2563eb', orange: '#d97706', purple: '#7c3aed', cyan: '#0891b2', amber: '#b45309', emerald: '#047857', darkblue: '#1e3a8a' };
    return map[color] || '#7c3aed';
  },

  toggleToolsDrawer() {
    const drawer = document.getElementById('tools-drawer');
    if (!drawer) return;
    this.toolsDrawerOpen = !this.toolsDrawerOpen;
    drawer.style.display = this.toolsDrawerOpen ? 'flex' : 'none';
  },

  filterTools(query) {
    const list = document.getElementById('tools-list');
    const q = query.toLowerCase();
    list.innerHTML = this.availableTools
      .filter(t => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q))
      .map(t => `
        <div class="tool-item" onclick="FlowBuilder.addNodeToCanvas('${t.type}')">
          <span class="tool-icon">${t.icon}</span>
          <span>${t.label}</span>
        </div>
      `).join('');
  },

  addNodeToCanvas(toolType) {
    const tool = this.availableTools.find(t => t.type === toolType) || this.availableTools[0];
    
    const spawnX = Math.round((-this.panX + 450) / this.canvasScale);
    const spawnY = Math.round((-this.panY + 250) / this.canvasScale);

    const newNode = {
      id: `node_${Date.now()}`,
      type: tool.type,
      label: tool.label,
      icon: tool.icon,
      color: tool.color,
      x: spawnX,
      y: spawnY,
      data: this.getDefaultDataForType(tool.type)
    };

    this.currentFlow.nodes.push(newNode);
    const viewport = document.getElementById('canvas-viewport');
    viewport.insertAdjacentHTML('beforeend', this.renderNodeHtml(newNode));
    
    const newEl = document.getElementById(newNode.id);
    if (newEl) this.bindSingleNode(newEl);

    this.drawConnections();
    this.updateMiniMap();
    this.toggleToolsDrawer();
    showToast(`Bloco ${tool.label} adicionado ao Canvas!`);
  },

  getDefaultDataForType(type) {
    switch (type) {
      case 'message':
        return { text: 'Olá {primeiro_nome}, como posso te ajudar?' };
      case 'delay':
        return { seconds: 3, simulateTyping: true };
      case 'wait':
        return { timeoutMinutes: 60, timeout: 'Aguardar resposta do cliente...' };
      case 'condition':
        return { ruleType: 'contains_phone', rule: 'DDD + 9 dígitos (ex: 11912345678)' };
      case 'integration':
        return { endpoint: 'https://stalkea.app/spp/api/profile-picture.php', method: 'GET' };
      case 'media':
        return { template: 'template_com_foto.png', mediaType: 'proof', caption: 'Segue a verificação solicitada' };
      case 'ai':
        return { prompt: 'Classificar objeções: Por que pagar, Recusa, Denúncia/Golpe, O que é a taxa, Acesso, Enviar link' };
      case 'pix':
        return { pixKey: 'contato@seusite.com', amount: '49,90', description: 'Liberação de acesso' };
      case 'payment':
        return { checkoutUrl: 'https://pay.kirvano.com/checkout-49', text: 'Clique aqui para liberar seu acesso agora' };
      case 'tag':
        return { tag: 'Lead Qualificado' };
      case 'kanban_step':
        return { columnId: 'em_analise', columnName: 'Em Análise' };
      default:
        return { text: 'Configuração do bloco' };
    }
  },

  /**
   * MODAL DIDÁTICO E ULTRA-EXPLICADO POR TIPO DE BLOCO
   */
  openNodeModal(nodeId) {
    const node = this.currentFlow.nodes.find(n => n.id === nodeId);
    if (!node) return;

    if (!node.data) node.data = {};

    let guideHelpTitle = 'Como este bloco funciona:';
    let guideHelpText = '';
    let specificFieldsHtml = '';

    // 1. MENSAGEM DE TEXTO
    if (node.type === 'message') {
      guideHelpTitle = '📘 Bloco de Mensagem do WhatsApp';
      guideHelpText = 'Este bloco envia uma mensagem de texto automática para o cliente. Você pode usar formatação oficial do WhatsApp (*negrito*, _itálico_, ~tachado~) e variáveis dinâmicas que o robô substitui automaticamente pelos dados reais do cliente.';
      
      specificFieldsHtml = `
        <div class="form-group">
          <label class="form-label" style="display: flex; justify-content: space-between; align-items: center;">
            <span>Texto da Mensagem</span>
            <span style="font-size: 11px; color: var(--text-muted);">Suporta emojis e formatação</span>
          </label>

          <!-- Barra de Atalhos de Formatação -->
          <div class="wa-format-toolbar">
            <button type="button" class="wa-format-btn" onclick="FlowBuilder.insertFormatting('*', '*')" title="Negrito"><strong>*B*</strong> Negrito</button>
            <button type="button" class="wa-format-btn" onclick="FlowBuilder.insertFormatting('_', '_')" title="Itálico"><em>_I_</em> Itálico</button>
            <button type="button" class="wa-format-btn" onclick="FlowBuilder.insertFormatting('~', '~')" title="Tachado"><del>~S~</del> Riscado</button>
            <span style="color: rgba(255,255,255,0.2); margin: 0 4px;">|</span>
            <button type="button" class="wa-format-btn" onclick="FlowBuilder.insertEmoji('👇')">👇</button>
            <button type="button" class="wa-format-btn" onclick="FlowBuilder.insertEmoji('🔒')">🔒</button>
            <button type="button" class="wa-format-btn" onclick="FlowBuilder.insertEmoji('✅')">✅</button>
            <button type="button" class="wa-format-btn" onclick="FlowBuilder.insertEmoji('🏦')">🏦</button>
            <button type="button" class="wa-format-btn" onclick="FlowBuilder.insertEmoji('👍')">👍</button>
            <button type="button" class="wa-format-btn" onclick="FlowBuilder.insertEmoji('🙂')">🙂</button>
          </div>

          <textarea class="form-textarea" id="modal-node-text" style="min-height: 140px; font-size: 13px; line-height: 1.5; font-family: monospace;" oninput="FlowBuilder.updateLivePreview()">${node.data.text || ''}</textarea>
        </div>

        <div style="background: rgba(124, 58, 237, 0.08); border: 1px solid rgba(124, 58, 237, 0.25); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
          <label class="form-label" style="font-size: 12px; margin-bottom: 8px; color: #c4b5fd; display: flex; justify-content: space-between;">
            <span>⚡ Variáveis Prontas (Clique para inserir no texto):</span>
            <span style="font-size: 10.5px; color: #a78bfa;">Valores reais entram automaticamente</span>
          </label>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <button type="button" class="var-pill" onclick="FlowBuilder.insertVariable('{primeiro_nome}')">
              <strong>{primeiro_nome}</strong> <span style="color: var(--text-muted); font-size: 10px;">Nome do lead</span>
            </button>
            <button type="button" class="var-pill" onclick="FlowBuilder.insertVariable('{alvo}')">
              <strong>{alvo}</strong> <span style="color: var(--text-muted); font-size: 10px;">Número investigado</span>
            </button>
            <button type="button" class="var-pill" onclick="FlowBuilder.insertVariable('{telefone}')">
              <strong>{telefone}</strong> <span style="color: var(--text-muted); font-size: 10px;">WhatsApp do lead</span>
            </button>
            <button type="button" class="var-pill" onclick="FlowBuilder.insertVariable('{checkoutUrl}')">
              <strong>{checkoutUrl}</strong> <span style="color: var(--text-muted); font-size: 10px;">Link Pix Atual</span>
            </button>
            <button type="button" class="var-pill" onclick="FlowBuilder.insertVariable('{checkoutUrl100}')">
              <strong>{checkoutUrl100}</strong> <span style="color: var(--text-muted); font-size: 10px;">Upsell R$ 100</span>
            </button>
            <button type="button" class="var-pill" onclick="FlowBuilder.insertVariable('{checkoutUrl200}')">
              <strong>{checkoutUrl200}</strong> <span style="color: var(--text-muted); font-size: 10px;">Upsell R$ 200</span>
            </button>
            <button type="button" class="var-pill" onclick="FlowBuilder.insertVariable('{checkoutUrl400}')">
              <strong>{checkoutUrl400}</strong> <span style="color: var(--text-muted); font-size: 10px;">Upsell R$ 400</span>
            </button>
            <button type="button" class="var-pill" onclick="FlowBuilder.insertVariable('{valor_atual}')">
              <strong>{valor_atual}</strong> <span style="color: var(--text-muted); font-size: 10px;">Valor da etapa</span>
            </button>
          </div>
        </div>
      `;
    } 
    // 2. INTERVALO INTELIGENTE (DELAY)
    else if (node.type === 'delay') {
      guideHelpTitle = '⏱️ Bloco de Intervalo Inteligente (Delay)';
      guideHelpText = 'Pausa o robô por alguns segundos antes de disparar a próxima mensagem. Isso é crucial para parecer um atendente humano real digitando no WhatsApp, evitando bloqueios da Meta e transmitindo naturalidade.';
      
      specificFieldsHtml = `
        <div class="form-group">
          <label class="form-label">Tempo de Espera (Segundos)</label>
          <input type="number" class="form-input" id="modal-node-seconds" value="${node.data.seconds || 3}" min="1" max="120" oninput="FlowBuilder.updateLivePreview()">
          <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Recomendado: 3 a 5 segundos para mensagens curtas; 5 a 8 segundos antes de fotos/provas.</p>
        </div>
        <div class="form-group" style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: #fff; font-size: 13px;">
            <input type="checkbox" id="modal-node-typing" ${node.data.simulateTyping !== false ? 'checked' : ''} onchange="FlowBuilder.updateLivePreview()">
            <span>Simular status de <strong>"Digitando..."</strong> no WhatsApp do cliente</span>
          </label>
        </div>
      `;
    }
    // 3. CONDICIONAL / DESVIO DE ROTA
    else if (node.type === 'condition') {
      guideHelpTitle = '🔀 Bloco Condicional (Classificador de Rotas)';
      guideHelpText = 'Este bloco avalia o que o lead respondeu e decide qual caminho o fluxo deve seguir. Você pode ligar múltiplos cabos de saída, cada um com seu próprio rótulo (Positivo, Negativo ou Dúvidas).';
      
      specificFieldsHtml = `
        <div class="form-group">
          <label class="form-label">Tipo de Avaliação da Condicional</label>
          <select class="form-select" id="modal-node-rule-type" onchange="FlowBuilder.updateLivePreview()">
            <option value="contains_phone" ${node.data.ruleType === 'contains_phone' ? 'selected' : ''}>Classificar Resposta pós Boas-Vindas (Telefone vs Dúvida vs Aleatório)</option>
            <option value="has_photo" ${node.data.ruleType === 'has_photo' ? 'selected' : ''}>Verificar Foto Pública na API (urlImage != null)</option>
            <option value="receipt_check" ${node.data.ruleType === 'receipt_check' ? 'selected' : ''}>Verificar Comprovante de Pagamento (Válido vs Inválido)</option>
            <option value="contains_text" ${node.data.ruleType === 'contains_text' ? 'selected' : ''}>Mensagem contém Palavra-chave</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Critério / Parâmetro da Regra</label>
          <input type="text" class="form-input" id="modal-node-rule" value="${node.data.rule || ''}" placeholder="Ex: DDD + 9 dígitos (10 a 13 números)" oninput="FlowBuilder.updateLivePreview()">
        </div>

        <div style="background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
          <h4 style="font-size: 12px; color: #a78bfa; margin-bottom: 8px;">🧭 As 3 Rotas Inteligentes do Boas-Vindas:</h4>
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11.5px;">
            <div style="display: flex; gap: 8px; color: #34d399;">
              <span>🟢</span>
              <span><strong>Resposta Positiva (Número com DDD):</strong> Avança para mensagem de análise e API de foto.</span>
            </div>
            <div style="display: flex; gap: 8px; color: #fbbf24;">
              <span>🟡</span>
              <span><strong>Dúvida pós Boas-Vindas:</strong> Se o lead perguntar "como funciona?" ou "é seguro?", tira a dúvida e pede o número.</span>
            </div>
            <div style="display: flex; gap: 8px; color: #f87171;">
              <span>🔴</span>
              <span><strong>Resposta Negativa / Aleatória:</strong> Se mandar texto solto ou disser apenas "salvei", reforça o formato do número.</span>
            </div>
          </div>
        </div>
      `;
    }
    // 4. INTELIGÊNCIA ARTIFICIAL (CHATGPT)
    else if (node.type === 'ai') {
      guideHelpTitle = '🤖 Cérebro de IA (OpenAI ChatGPT + Respostas Oficiais)';
      guideHelpText = 'O ChatGPT atua como o classificador semântico treinado. Mesmo que o cliente use gírias, escreva errado ou tenha reações agressivas, o GPT identifica a intenção e responde com os scripts oficiais da Mavrol Empresarial.';
      
      specificFieldsHtml = `
        <div class="form-group">
          <label class="form-label">Diretriz Geral do Cérebro de IA</label>
          <textarea class="form-textarea" id="modal-node-prompt" style="min-height: 80px;" oninput="FlowBuilder.updateLivePreview()">${node.data.prompt || 'Classificar objeções e responder com o script da Mavrol'}</textarea>
        </div>
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
          <h4 style="font-size: 12px; color: #34d399; margin-bottom: 8px;">🧠 6 Quebras de Objeção Treinadas para Todos os Upsells:</h4>
          <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px; color: #cbd5e1; max-height: 180px; overflow-y: auto;">
            <div style="padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">
              <strong style="color: #6ee7b7;">1. Por que tem que pagar?</strong>
              <div>Explica que cada etapa ativa ferramentas essenciais no servidor e convida a finalizar pelo link.</div>
            </div>
            <div style="padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">
              <strong style="color: #6ee7b7;">2. Recusa ou resposta aleatória:</strong>
              <div>Responde amigavelmente: "Tranquilo, qualquer coisa é só chamar 🙂 Se quiser, pode seguir pelo link..."</div>
            </div>
            <div style="padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">
              <strong style="color: #6ee7b7;">3. Já paguei o anterior e recusa novo pagamento:</strong>
              <div>Esclarece dinamicamente que o pagamento anterior liberou a etapa correspondente e incentiva o avanço para a etapa atual (R$ 100, R$ 200 ou R$ 400).</div>
            </div>
            <div style="padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">
              <strong style="color: #6ee7b7;">4. Denúncia, golpe ou polícia:</strong>
              <div>Responde com calma e empatia: "Entendo sua decisão. Se quiser, posso te ajudar a usar melhor o sistema..."</div>
            </div>
            <div style="padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">
              <strong style="color: #6ee7b7;">5. Do que se trata a taxa atual?</strong>
              <div>Explica que o valor é referente à liberação desse recurso específico do sistema.</div>
            </div>
            <div style="padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">
              <strong style="color: #6ee7b7;">6. Quando vai ver mensagens / foto / acesso completo:</strong>
              <div>Reforça que o painel completo é liberado assim que concluir a etapa atual.</div>
            </div>
          </div>
        </div>
      `;
    }
    // 5. MÍDIA / PROVA
    else if (node.type === 'media') {
      guideHelpTitle = '📸 Bloco de Mídia / Prova Gerada Dinamicamente';
      guideHelpText = 'Gera a imagem de prova do WhatsApp combinando a foto retornada pela API stalkea.app com o print oficial da conversa investigada.';
      
      specificFieldsHtml = `
        <div class="form-group">
          <label class="form-label">Modelo de Mídia / Prova</label>
          <select class="form-select" id="modal-node-template" onchange="FlowBuilder.updateLivePreview()">
            <option value="template_com_foto.png" ${node.data.template === 'template_com_foto.png' ? 'selected' : ''}>Print 1: Foto Dinâmica no Áudio (X:139, Y:664, R:23)</option>
            <option value="template_sem_foto_cadeado.png" ${node.data.template === 'template_sem_foto_cadeado.png' ? 'selected' : ''}>Print 2: Cadeado Amarelo (Mensagens Criptografadas)</option>
            <option value="audio_gravado" ${node.data.template === 'audio_gravado' ? 'selected' : ''}>Áudio Gravado Oficial</option>
          </select>
        </div>
        <p style="font-size: 11.5px; color: var(--text-muted); line-height: 1.4;">
          💡 <strong>Regra Automática:</strong> Se o perfil do WhatsApp tiver foto pública, o sistema usa o Print 1. Se a foto for oculta ou privada, usa automaticamente o Print 2 com o aviso de sigilo criptografado!
        </p>
      `;
    }
    // 6. PAGAMENTO / PIX
    else if (node.type === 'pix' || node.type === 'payment') {
      guideHelpTitle = '💳 Bloco de Pagamento / Cobrança Pix Kirvano';
      guideHelpText = 'Envia a cobrança Pix personalizada com os dados oficiais (KIRVANO PAGAMENTOS LTDA • PICPAY) e o link para o cliente pagar.';
      
      specificFieldsHtml = `
        <div class="form-group">
          <label class="form-label">Texto da Cobrança com Link</label>
          <textarea class="form-textarea" id="modal-node-text" style="min-height: 110px;" oninput="FlowBuilder.updateLivePreview()">${node.data.text || ''}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Valor Cobrado nesta Etapa (R$)</label>
          <input type="text" class="form-input" id="modal-node-amount" value="${node.data.amount || '49,90'}" oninput="FlowBuilder.updateLivePreview()">
        </div>
        <div style="background: rgba(37, 211, 102, 0.08); border: 1px solid rgba(37, 211, 102, 0.25); border-radius: 8px; padding: 10px; font-size: 11.5px; color: #86efac;">
          🔒 <strong>Dados de Pagamento Oficiais:</strong> Nome: KIRVANO PAGAMENTOS LTDA • Instituição: PICPAY
        </div>
      `;
    } 
    // 7. FACEBOOK PIXEL / CONVERSIONS API
    else if (node.type === 'pixel') {
      guideHelpTitle = '🎯 Bloco de Pixel do Facebook (Conversions API - CAPI)';
      guideHelpText = 'Dispara um evento de conversão oficial para o Facebook Ads quando o cliente passar por este bloco no WhatsApp, otimizando seus públicos de anúncio e ROI.';
      
      specificFieldsHtml = `
        <div class="form-group">
          <label class="form-label">Nome do Evento da Meta</label>
          <select class="form-select" id="modal-node-event-name" onchange="FlowBuilder.updateLivePreview()">
            <option value="Lead" ${node.data.eventName === 'Lead' ? 'selected' : ''}>Lead (Captura de Contato / Número)</option>
            <option value="InitiateCheckout" ${node.data.eventName === 'InitiateCheckout' ? 'selected' : ''}>InitiateCheckout (Gerou Cobrança Pix)</option>
            <option value="Purchase" ${node.data.eventName === 'Purchase' ? 'selected' : ''}>Purchase (Compra Confirmada)</option>
            <option value="ViewContent" ${node.data.eventName === 'ViewContent' ? 'selected' : ''}>ViewContent (Visualizou Prova)</option>
            <option value="Contact" ${node.data.eventName === 'Contact' ? 'selected' : ''}>Contact (Iniciou Conversa)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Valor da Conversão (R$)</label>
          <input type="text" class="form-input" id="modal-node-event-value" value="${node.data.eventValue || '49.90'}" placeholder="49.90" oninput="FlowBuilder.updateLivePreview()">
        </div>
        <div style="background: rgba(24, 119, 242, 0.08); border: 1px solid rgba(24, 119, 242, 0.3); border-radius: 8px; padding: 10px; font-size: 11.5px; color: #93c5fd;">
          📊 <strong>Facebook Conversions API:</strong> O evento é enviado diretamente via servidor para o Pixel do Facebook Ads conectado na aba Configurações, associando o número de telefone do lead em hash SHA-256.
        </div>
      `;
    }
    // FALLBACK
    else {
      guideHelpTitle = '⚙️ Configurações do Bloco';
      guideHelpText = 'Parâmetros e configurações gerais para este bloco.';
      specificFieldsHtml = `
        <div class="form-group">
          <label class="form-label">Conteúdo / Dados do Bloco</label>
          <textarea class="form-textarea" id="modal-node-text" style="min-height: 100px;" oninput="FlowBuilder.updateLivePreview()">${node.data.text || node.data.rule || ''}</textarea>
        </div>
      `;
    }

    // Identifica conexões que saem deste bloco
    const outgoingEdges = (this.currentFlow.edges || []).filter(e => e.from === nodeId);
    const connectionsHtml = outgoingEdges.map(e => {
      const target = this.currentFlow.nodes.find(n => n.id === e.to);
      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; font-size: 12px; margin-bottom: 8px;">
          <div>
            <div style="color: #c4b5fd; font-weight: 600;">➔ ${target?.label || e.to}</div>
            <div style="color: #94a3b8; font-size: 11px; margin-top: 2px;">
              Rótulo: <strong style="color: #fff;">${e.label || 'Sem rótulo'}</strong>
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-secondary" style="padding: 3px 8px; font-size: 10.5px;" onclick="FlowBuilder.editEdgeLabelDirect('${e.id}')">✏️ Renomear</button>
            <button type="button" class="btn btn-secondary" style="padding: 3px 8px; font-size: 10.5px; color: var(--red);" onclick="FlowBuilder.deleteEdgeDirect('${e.id}')">✕ Desconectar</button>
          </div>
        </div>
      `;
    }).join('');

    const modalHtml = `
      <div class="node-modal-backdrop" id="node-config-modal">
        <div class="node-modal-card">
          <!-- Top Header -->
          <div class="node-modal-header">
            <div style="display: flex; align-items: center; gap: 12px;">
              <span style="font-size: 26px;">${node.icon || '⚡'}</span>
              <div>
                <h3 style="font-size: 16px; font-weight: 700; color: #fff; margin: 0;">${node.label}</h3>
                <div style="font-size: 11px; color: #a78bfa; margin-top: 2px;">
                  TIPO: <strong>${node.type.toUpperCase()}</strong> • ID: <code>${node.id}</code>
                </div>
              </div>
            </div>
            <button class="btn btn-secondary" onclick="document.getElementById('node-config-modal').remove()" style="padding: 6px 12px;">✕ Fechar</button>
          </div>

          <!-- 2-Column Body: Configuração (Esquerda) vs Live Preview (Direita) -->
          <div class="node-modal-body">
            <!-- Coluna da Esquerda: Configuração e Campos -->
            <div class="node-modal-left">
              <!-- Card Didático de Ajuda -->
              <div style="background: rgba(124, 58, 237, 0.08); border-left: 3px solid #7c3aed; padding: 12px 14px; border-radius: 6px; font-size: 12px; color: #e2e8f0; margin-bottom: 18px; line-height: 1.5;">
                <strong style="color: #c4b5fd; display: block; margin-bottom: 4px;">${guideHelpTitle}</strong>
                ${guideHelpText}
              </div>

              <div class="form-group">
                <label class="form-label">Título / Nome deste Bloco no Canvas</label>
                <input type="text" class="form-input" id="modal-node-title" value="${node.label}">
              </div>

              ${specificFieldsHtml}

              <!-- Rotas de Saída e Conexão de Cabos -->
              <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                  <label class="form-label" style="margin: 0; font-size: 12.5px;">Cabos e Rotas de Saída:</label>
                  <button type="button" class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px; background: rgba(124, 58, 237, 0.2); border-color: #7c3aed;" onclick="document.getElementById('node-config-modal').remove(); FlowBuilder.startConnecting('${node.id}')">
                    + Puxar Novo Cabo
                  </button>
                </div>
                ${connectionsHtml || '<p style="font-size: 11px; color: var(--text-muted); background: rgba(255,255,255,0.02); padding: 10px; border-radius: 6px;">Nenhum cabo conectado saindo deste bloco ainda. Clique em "+ Puxar Novo Cabo" para ligar a outro bloco.</p>'}
              </div>
            </div>

            <!-- Coluna da Direita: Smartphone Mockup Live Preview -->
            <div class="node-modal-right">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                <span style="font-size: 12.5px; font-weight: 600; color: #e2e8f0;">📱 Prévia no WhatsApp do Cliente:</span>
                <span style="font-size: 11px; color: #25d366;">● Ao Vivo</span>
              </div>

              <div class="phone-mockup">
                <!-- Phone Header -->
                <div class="phone-header">
                  <span style="color: #94a3b8; font-size: 14px;">←</span>
                  <div class="phone-avatar">M</div>
                  <div class="phone-user-info">
                    <span class="phone-user-name">Mavrol Suporte Oficial</span>
                    <span class="phone-user-status">online</span>
                  </div>
                </div>

                <!-- Phone Chat Body -->
                <div class="phone-chat-body" id="modal-wa-chat-body">
                  <!-- Mensagem do Lead (Contexto) -->
                  <div class="wa-message-bubble incoming" style="margin-bottom: 12px; font-size: 12px;">
                    <div>Oi, quero saber como ver as mensagens</div>
                    <div class="wa-message-time">14:30</div>
                  </div>

                  <!-- Mensagem deste Bloco Renderizada -->
                  <div class="wa-message-bubble" id="modal-wa-preview-bubble">
                    <div id="modal-wa-preview-text">...</div>
                    <div class="wa-message-time">
                      <span>14:31</span>
                      <span class="wa-ticks">✓✓</span>
                    </div>
                  </div>
                </div>
              </div>

              <div style="margin-top: 12px; padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; font-size: 11px; color: var(--text-muted); line-height: 1.4;">
                💡 <strong>Prévia Inteligente:</strong> As variáveis como <code>{primeiro_nome}</code> e <code>{alvo}</code> são simuladas acima como "Carlos" e "11988887777" para você ver exatamente como o lead receberá a mensagem!
              </div>
            </div>
          </div>

          <!-- Bottom Footer -->
          <div class="node-modal-footer">
            <button class="btn btn-danger" onclick="FlowBuilder.deleteNode('${node.id}')">Excluir Bloco</button>
            <div style="display: flex; gap: 10px;">
              <button class="btn btn-secondary" onclick="document.getElementById('node-config-modal').remove()">Cancelar</button>
              <button class="btn btn-primary" onclick="FlowBuilder.saveNodeModal('${node.id}')">💾 Salvar Alterações</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.updateLivePreview();
  },

  updateLivePreview() {
    const previewEl = document.getElementById('modal-wa-preview-text');
    if (!previewEl) return;

    const textEl = document.getElementById('modal-node-text');
    let rawText = textEl ? textEl.value : '';

    const ruleTypeEl = document.getElementById('modal-node-rule-type');
    const templateEl = document.getElementById('modal-node-template');
    const secondsEl = document.getElementById('modal-node-seconds');
    const typingEl = document.getElementById('modal-node-typing');

    // Se for bloco sem texto direto, renderiza prévia correspondente
    if (templateEl) {
      rawText = templateEl.value === 'template_com_foto.png'
        ? '📸 [Print Oficial com Foto Dinâmica injetada no Áudio]\n✓ Verificação concluída nos servidores.'
        : '🔒 [Print Oficial com Cadeado Amarelo de Sigilo Criptografado]\n✓ Registros protegidos nos servidores.';
    } else if (secondsEl) {
      rawText = `⏱️ [Pausa de ${secondsEl.value}s simulando ${typingEl?.checked ? '"Digitando..."' : 'espera'}]`;
    } else if (ruleTypeEl) {
      rawText = `🔀 [Condição: ${ruleTypeEl.options[ruleTypeEl.selectedIndex].text}]`;
    }

    if (!rawText.trim()) {
      previewEl.innerHTML = '<span style="color: rgba(255,255,255,0.4); font-style: italic;">Digite o texto da mensagem no formulário ao lado...</span>';
      return;
    }

    // Interpolação de variáveis na prévia
    let rendered = rawText
      .replace(/\{primeiro_nome\}/gi, 'Carlos')
      .replace(/\{alvo\}/gi, '11988887777')
      .replace(/\{telefone\}/gi, '11912345678')
      .replace(/\{checkoutUrl\}/gi, 'https://pay.kirvano.com/checkout-49')
      .replace(/\{checkoutUrl100\}/gi, 'https://pay.kirvano.com/checkout-100')
      .replace(/\{checkoutUrl200\}/gi, 'https://pay.kirvano.com/checkout-200')
      .replace(/\{checkoutUrl400\}/gi, 'https://pay.kirvano.com/checkout-400')
      .replace(/\{valor_atual\}/gi, '49,90')
      .replace(/\{proximo_valor\}/gi, '100');

    // Formatação estilo WhatsApp: *negrito*, _itálico_, ~tachado~
    rendered = rendered
      .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
      .replace(/_(.*?)_/g, '<em>$1</em>')
      .replace(/~(.*?)~/g, '<del>$1</del>')
      .replace(/\n/g, '<br>');

    previewEl.innerHTML = rendered;
  },

  insertFormatting(prefix, suffix) {
    const textarea = document.getElementById('modal-node-text');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end) || 'texto';
    textarea.value = textarea.value.substring(0, start) + prefix + selected + suffix + textarea.value.substring(end);
    textarea.focus();
    this.updateLivePreview();
  },

  insertEmoji(emoji) {
    const textarea = document.getElementById('modal-node-text');
    if (!textarea) return;
    const pos = textarea.selectionStart;
    textarea.value = textarea.value.slice(0, pos) + emoji + textarea.value.slice(pos);
    textarea.focus();
    this.updateLivePreview();
  },

  insertVariable(varTag) {
    const textarea = document.getElementById('modal-node-text');
    if (!textarea) return;
    const pos = textarea.selectionStart;
    textarea.value = textarea.value.slice(0, pos) + varTag + textarea.value.slice(pos);
    textarea.focus();
    this.updateLivePreview();
  },

  editEdgeLabelDirect(edgeId) {
    const edge = this.currentFlow.edges.find(e => e.id === edgeId);
    if (!edge) return;
    const newLabel = prompt('Digite o novo rótulo desta rota/cabo (ex: 🟢 Resposta Positiva, 🟡 Dúvida, 🔴 Negativa):', edge.label || '');
    if (newLabel !== null) {
      edge.label = newLabel;
      this.drawConnections();
      document.getElementById('node-config-modal')?.remove();
      this.openNodeModal(edge.from);
      showToast('Rótulo da rota atualizado!');
    }
  },

  deleteEdgeDirect(edgeId) {
    const edge = this.currentFlow.edges.find(e => e.id === edgeId);
    const fromId = edge?.from;
    this.currentFlow.edges = this.currentFlow.edges.filter(e => e.id !== edgeId);
    this.drawConnections();
    document.getElementById('node-config-modal')?.remove();
    if (fromId) this.openNodeModal(fromId);
    showToast('Conexão removida com sucesso!');
  },

  saveNodeModal(nodeId) {
    const node = this.currentFlow.nodes.find(n => n.id === nodeId);
    if (!node) return;

    node.label = document.getElementById('modal-node-title').value;
    if (!node.data) node.data = {};

    if (node.type === 'message' || node.type === 'payment') {
      const textEl = document.getElementById('modal-node-text');
      if (textEl) node.data.text = textEl.value;
      const amountEl = document.getElementById('modal-node-amount');
      if (amountEl) node.data.amount = amountEl.value;
    } else if (node.type === 'delay') {
      node.data.seconds = parseInt(document.getElementById('modal-node-seconds').value, 10) || 3;
      node.data.simulateTyping = document.getElementById('modal-node-typing').checked;
    } else if (node.type === 'condition') {
      node.data.ruleType = document.getElementById('modal-node-rule-type').value;
      node.data.rule = document.getElementById('modal-node-rule').value;
    } else if (node.type === 'media') {
      node.data.template = document.getElementById('modal-node-template').value;
    } else if (node.type === 'ai') {
      node.data.prompt = document.getElementById('modal-node-prompt').value;
    } else if (node.type === 'pix') {
      const textEl = document.getElementById('modal-node-text');
      if (textEl) node.data.text = textEl.value;
      const amountEl = document.getElementById('modal-node-amount');
      if (amountEl) node.data.amount = amountEl.value;
    } else if (node.type === 'pixel') {
      node.data.eventName = document.getElementById('modal-node-event-name').value;
      node.data.eventValue = document.getElementById('modal-node-event-value').value;
    } else {
      const textEl = document.getElementById('modal-node-text');
      if (textEl) node.data.text = textEl.value;
    }

    const el = document.getElementById(nodeId);
    if (el) {
      el.querySelector('.node-header span:last-child').textContent = node.label;
      const bodyEl = el.querySelector('.node-body');
      if (bodyEl) {
        bodyEl.textContent = node.data.text || node.data.rule || node.data.template || `Espera ${node.data.seconds}s (Digitando)` || 'Configuração salva';
      }
    }

    document.getElementById('node-config-modal').remove();
    showToast('Bloco atualizado com sucesso!', 'success');
  },

  deleteNode(nodeId) {
    this.currentFlow.nodes = this.currentFlow.nodes.filter(n => n.id !== nodeId);
    this.currentFlow.edges = this.currentFlow.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
    document.getElementById(nodeId)?.remove();
    document.getElementById('node-config-modal')?.remove();
    this.drawConnections();
    this.updateMiniMap();
    showToast('Bloco removido do Canvas');
  },

  async saveCurrentFlow() {
    await fetch(`/api/flows/${this.currentFlow.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.currentFlow)
    });
    showToast('Fluxo salvo com sucesso no servidor!', 'success');
  },

  async runVisualSimulation() {
    showToast('Iniciando Simulação Visual no Canvas...');
    const nodes = this.currentFlow.nodes;

    document.querySelectorAll('.flow-node').forEach(el => el.classList.remove('highlighted'));
    document.querySelectorAll('.canvas-edge').forEach(el => el.classList.remove('active'));

    for (let i = 0; i < Math.min(nodes.length, 14); i++) {
      const node = nodes[i];
      const el = document.getElementById(node.id);
      if (el) {
        el.classList.add('highlighted');
        
        const canvasRoot = document.getElementById('canvas-root');
        if (canvasRoot) {
          this.panX = (canvasRoot.clientWidth / 2) - (node.x * this.canvasScale) - 100;
          this.panY = (canvasRoot.clientHeight / 2) - (node.y * this.canvasScale) - 40;
          this.applyTransform();
        }
      }

      if (i > 0) {
        const prevNode = nodes[i - 1];
        const edge = this.currentFlow.edges.find(e => e.from === prevNode.id && e.to === node.id);
        if (edge) {
          document.getElementById(`edge-${edge.id}`)?.classList.add('active');
        }
      }

      await new Promise(r => setTimeout(r, 800));
    }

    showToast('Simulação visual concluída com sucesso!', 'success');
  },

  async createFlow() {
    const name = prompt('Digite o nome do novo fluxo:', 'Novo Fluxo de Atendimento');
    if (!name) return;

    const res = await fetch('/api/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    }).then(r => r.json());

    showToast('Fluxo criado!');
    this.openCanvas(res.flow.id);
  },

  async duplicateFlow(flowId) {
    await fetch(`/api/flows/${flowId}/duplicate`, { method: 'POST' });
    showToast('Fluxo duplicado!');
    FlowBuilder.renderList(document.getElementById('view-container'));
  },

  async deleteFlow(flowId) {
    if (!confirm('Deseja realmente excluir este fluxo?')) return;
    try {
      const res = await fetch(`/api/flows/${flowId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('✓ Fluxo excluído com sucesso!');
        window.location.hash = '#flows';
        FlowBuilder.renderList(document.getElementById('view-container'));
      } else {
        showToast('Erro ao excluir fluxo', 'error');
      }
    } catch(err) {
      showToast('Erro: ' + err.message, 'error');
    }
  }
};
