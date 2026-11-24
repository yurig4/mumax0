# MUMAX0 — Interface Web Didática para MuMax3

🔗 **Versão Online (GitHub Pages):** https://yurig4.github.io/mumax0/

**MUMAX0** é uma aplicação web leve (zero dependências externas) criada para facilitar a montagem estruturada de scripts `.mx3`, a validação física/numérica da malha micromagnética e a visualização elucidativa de resultados (`.ovf` e `table.txt`) do simulador [**MuMax3**](https://mumax.github.io/).

> *"O objetivo não é decorar comandos, mas entender a estrutura da preparação do script."*

---

## Principais Recursos

### Aba 1 — Gerador Estruturado de Scripts `.mx3`
* **Modo Básico e Modo Avançado:** interface limpa para introdução à micromagnética (Básico) e opções completas para pesquisa (Avançado: PBC, `EdgeSmooth`, `Kc1`, DMI `Dind`/`Dbulk`, temperatura `Temp`, skyrmions, pulso `sinc` para FMR, corrente Zhang-Li, seleção de integrador LLG e bloco de código customizado).
* **Montagem em 5 passos lógicos:**
  1. **Malha & Geometria** (`SetGridSize`, `SetCellSize` por passo $\Delta x$ ou por dimensão total $L_x/N_x$, `SetGeom` / `circle` / `ellipse` / anel / `cuboid` / `imageShape`).
  2. **Material & Energias** (`Msat`, `Aex`, `alpha`, `EnableDemag`, `Ku1`/`anisU`, `Kc1`, `Dind`/`Dbulk`, `Temp`), com entrada em unidades amigáveis (`nm`, `mT`, `ns`, `kA/m`, `pJ/m`, `kJ/m³`, `mJ/m²`) convertidas automaticamente para SI no código.
  3. **Estado Inicial (`m`)** (`uniform`, `randomMag`, `vortex`, `twoDomain`, `neelSkyrmion`, `blochSkyrmion`, `LoadFile`).
  4. **Etapas & Dinâmica (2 etapas):** busca de equilíbrio (`relax()`, `minimize()`) seguida opcionalmente por excitação dinâmica (campo constante, pulso liga → desliga, ciclo de histerese com desalinhamento configurável, pulso `sinc` FMR ou corrente STT).
  5. **Escrita & Solver** (`TableAdd`, `SaveAs`, `SnapshotAs`, `Autosave`, `TableAutoSave`, `OutputFormat`, `SetSolver`).
* **Visualização 2D em tempo real** da geometria, malha, configuração inicial $\mathbf{m}_0$ e vetor $\mathbf{B}_{\text{ext}}$.
* **Diagnóstico Físico e Numérico ao vivo:**
  * Equação da energia livre $E(\mathbf{m}) = E_{\text{ex}} + E_d + E_{\text{anis}} + E_Z + E_{\text{DMI}}$ indicando os termos ativos.
  * Cálculo instantâneo de $l_{\text{ex}}$, largura de parede $\Delta$ e fator de qualidade $Q$.
  * Alertas de malha grossa ($\Delta x > l_{\text{ex}}$), malha fina demais ($\Delta x < 0.5\text{ nm}$), eficiência de FFT na GPU, simetria na histerese e critério de Nyquist.
* **Guia Didático Bilíngue (PT / EN)** em tempo real (*Física & Equação*, *Intuição & Unidades* e *Cuidados Numéricos*).

### Aba 2 — Visualização Elucidativa (`.ovf` e `table.txt`)
* Leitura nativa de **OVF 2.0 / 1.0** (`Binary 4`, `Binary 8` e `Text`) diretamente no navegador (suporta seleção múltipla e **arrastar e soltar**).
* **6 mapas de cor científicos:** HSL vetorial (com Roda de Cores $+x, +y, -x, -y, \pm z$ embutida), $m_z / m_x / m_y$ em mapa divergente Azul–Branco–Vermelho com Colorbar, ângulo $\phi$ e gradiente $|\nabla \mathbf{m}|$ (Inferno).
* **Separação visual clara entre vácuo e amostra** com contorno da geometria.
* **Setas com halo de contraste + marcadores `⊙` ($+z$) e `⊗` ($-z$)** para núcleos de vórtice e skyrmions.
* Eixos físicos em `nm`, barra de escala, contornos ($|m_z| = 0.5$), cálculo da **carga topológica $Q$** (Berg & Lüscher), sonda interativa com o mouse, player animado, **comparação lado a lado** e exportação em **PNG HD**.
* Gráficos de `table.txt`: evolução temporal sincronizada com o frame `.ovf`, curva de histerese, órbita no plano, energias e **espectro FFT (GHz)**.

---

## Como Usar

### 1. Modo Online (GitHub Pages — sem instalação)
Basta abrir a página publicada no navegador:
* Monte e valide o script `.mx3` e faça download do arquivo pronto.
* Na aba **Visualização**, arraste ou carregue arquivos `.ovf` e `table.txt` do seu computador (todo o processamento acontece localmente no navegador).

### 2. Modo Local com Execução na GPU (Windows / Linux / macOS)
Para habilitar os botões **Validar (`-vet`)** e **Executar MuMax3** direto na sua GPU local:

**Requisitos:** [Node.js](https://nodejs.org/) (v18+) e [MuMax3](https://mumax.github.io/) instalados.

* **Windows:** dê duplo clique em `Abrir_MUMAX0.bat`.
* **Linux / macOS:**
  ```bash
  chmod +x abrir_mumax0.sh
  ./abrir_mumax0.sh
  ```
* O navegador abrirá automaticamente em `http://127.0.0.1:8765`. Clique em **🔧 Configurar MuMax3** caso precise indicar manualmente o caminho do executável `mumax3`.

---

## Estrutura do Projeto
```text
├── index.html          # Interface principal (Aba 1: Gerador + Aba 2: Visualizador)
├── style.css           # Tema claro científico + editor escuro Consolas
├── didactics.js        # Traduções PT/EN e Guia Didático em 3 camadas
├── app.js              # Gerador .mx3, diagnósticos físicos, preview 2D e cliente API
├── viewer.js           # Parser OVF 2.0, renderizador editorial HD e gráficos/FFT
├── server.js           # Servidor local opcional (Node.js stdlib) para chamar mumax3
├── Abrir_MUMAX0.bat    # Lançador rápido (Windows)
└── abrir_mumax0.sh     # Lançador rápido (Linux/macOS)
```

## Licença
Distribuído sob licença **MIT**. Veja [LICENSE](LICENSE) para mais detalhes.
