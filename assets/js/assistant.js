/* ============ ASSISTENTE PERLA — pré-atendimento guiado ============
   IMPORTANTE (ver PROGRESS.md / relatório de entrega): este é um fluxo guiado determinístico
   (perguntas fixas + botões + um extrator simples de texto por palavra-chave/regex). NÃO há
   nenhum serviço de IA real por trás — o site é estático (GitHub Pages), sem backend. A função
   `ServicoIA.interpretar()` abaixo é só um ponto de extensão documentado para o dia em que um
   backend real existir; hoje ela nunca é chamada de verdade pelo fluxo.

   Nada de pessoal (nome/telefone/e-mail) é enviado a lugar nenhum por este arquivo. A única saída
   de dados é o link wa.me montado no fim, e mesmo esse link só carrega alguma informação até a
   própria pessoa visitante tocar em Enviar dentro do WhatsApp — este arquivo não sabe (e não tem
   como saber) se ela chegou a enviar.

   Organização interna (arquivo único por ser site estático sem bundler, mas os papéis abaixo são
   mantidos separados de propósito, cada um em seu próprio objeto/IIFE):
   1. Conteudo   — textos e definição das perguntas (dado, não lógica).
   2. Estado     — respostas confirmadas + histórico da conversa (nada disso sai do navegador).
   3. ServicoIA  — ponto de extensão para um backend real futuro (hoje: não-operação documentada).
   4. Resumo     — monta o texto final e o link wa.me (determinístico, sem IA).
   5. UI         — cria o DOM do widget e reage a cliques/teclas.
   6. Boot       — liga tudo: convite após 3s, sessionStorage, guardas de sobreposição.
*/
(function () {
  'use strict';

  /* ============ 1. CONTEÚDO ============ */
  var Conteudo = {
    nomeAssistente: 'Assistente Perla',
    apresentacao: 'Sou o assistente virtual da Perla. Posso ajudar você a organizar as informações do seu projeto para conversar com nossa equipe.',
    avisoPrivacidade: 'Este atendimento roda no seu navegador — nenhuma informação é enviada à Perla até você mesmo tocar em Enviar no WhatsApp. Não use CPF, senhas ou dados bancários aqui.',
    convite: 'Pensando em construir ou reformar? Vamos conversar sobre seu projeto?',
    numeroWhatsapp: '5531999203886',
    faltaResposta: 'Sem problema, podemos seguir sem essa informação.',
    // opções sempre visíveis, além das da pergunta atual
    opcaoPular: 'Pular esta pergunta',
    opcaoEquipe: 'Prefiro falar com a equipe',
  };

  // Cada pergunta: id, rótulo curto p/ resumo, texto (pode depender do estado), tipo de resposta,
  // opções (função do estado -> array, pra variar por serviço) e se aplica ao serviço escolhido.
  var TODOS_SERVICOS = ['construir', 'reformar', 'projeto', 'transformar', 'clinica', 'avaliando'];
  var SEM_OBRA = ['transformar', 'avaliando']; // serviços que não envolvem terreno/construção

  var PERGUNTAS = [
    {
      id: 'tipo_imovel', rotulo: 'Tipo de imóvel',
      texto: function () { return 'Que tipo de imóvel é?'; },
      opcoes: function () { return ['Casa', 'Apartamento', 'Clínica/consultório', 'Comercial', 'Outro']; },
      aplicavel: function (e) { return e.servico !== 'clinica'; }, // clínica já vem implícito da 1ª pergunta
    },
    {
      id: 'cidade_bairro', rotulo: 'Cidade/bairro',
      texto: function () { return 'Em qual cidade e bairro fica (ou vai ficar) o projeto? Não precisa do endereço completo.'; },
      opcoes: function () { return []; },
      aplicavel: function () { return true; },
    },
    {
      id: 'situacao_imovel', rotulo: 'Situação do imóvel ou terreno',
      texto: function () { return 'Qual a situação do imóvel ou terreno hoje?'; },
      opcoes: function () { return ['Imóvel/terreno já disponível', 'Em negociação', 'Ainda em busca']; },
      aplicavel: function (e) { return SEM_OBRA.indexOf(e.servico) === -1; },
    },
    {
      id: 'o_que_fazer', rotulo: 'O que pretendo fazer',
      texto: function (e) {
        if (e.servico === 'transformar') return 'Quais ambientes você quer transformar, e o que imagina mudar neles?';
        if (e.servico === 'avaliando') return 'O que você imagina construir, reformar ou transformar?';
        return 'O que você deseja construir ou transformar, e quais ambientes estão envolvidos?';
      },
      opcoes: function () { return []; },
      aplicavel: function () { return true; },
    },
    {
      id: 'area_m2', rotulo: 'Área aproximada',
      texto: function () { return 'Você tem uma ideia da área aproximada, em m²?'; },
      opcoes: function () { return ['Ainda não sei']; },
      aplicavel: function (e) { return SEM_OBRA.indexOf(e.servico) === -1; },
    },
    {
      id: 'etapa_atual', rotulo: 'Etapa atual',
      texto: function () { return 'Em que etapa vocês estão agora?'; },
      opcoes: function () { return ['Ideia inicial', 'Projeto existente', 'Obra iniciada', 'Preciso de reforma']; },
      aplicavel: function (e) { return SEM_OBRA.indexOf(e.servico) === -1; },
    },
    {
      id: 'quando_comecar', rotulo: 'Previsão para começar',
      texto: function () { return 'Quando pretende começar?'; },
      opcoes: function () { return ['Sem data definida']; },
      aplicavel: function () { return true; },
    },
    {
      id: 'investimento', rotulo: 'Investimento informado',
      texto: function () { return 'Qual investimento aproximado você tem disponível? É só pra orientar a conversa — não é um orçamento da Perla.'; },
      opcoes: function () { return ['Ainda não defini', Conteudo.opcaoEquipe]; },
      aplicavel: function () { return true; },
      // escolher "Prefiro conversar com a equipe" aqui já leva direto ao resumo
      atalhoParaResumo: function (valor) { return valor === Conteudo.opcaoEquipe; },
    },
    {
      id: 'prioridade', rotulo: 'Prioridade principal',
      texto: function () { return 'O que é mais importante pra você nesse projeto?'; },
      opcoes: function () { return ['Prazo', 'Planejamento financeiro', 'Conforto', 'Valorização do imóvel', 'Outra']; },
      aplicavel: function () { return true; },
    },
    {
      id: 'observacoes', rotulo: 'Observações', opcional: true,
      texto: function () { return 'Quer acrescentar algum detalhe importante? Se não, é só pular.'; },
      opcoes: function () { return []; },
      aplicavel: function () { return true; },
    },
  ];

  var PERGUNTAS_CONTATO = [
    {
      id: 'contato_nome', rotulo: 'Nome',
      texto: function () { return 'Qual é o seu nome?'; },
      opcoes: function () { return []; },
      aplicavel: function () { return true; },
    },
    {
      id: 'contato_whatsapp', rotulo: 'WhatsApp',
      texto: function () { return 'Qual o melhor WhatsApp pra falar com você? (com DDD, e código do país se estiver fora do Brasil)'; },
      opcoes: function () { return []; },
      aplicavel: function () { return true; },
      validar: function (v) {
        var digitos = (v || '').replace(/\D/g, '');
        if (digitos.length < 10 || digitos.length > 14) return 'Esse número parece incompleto — pode conferir o DDD e os dígitos? Se preferir, dá pra pular e combinar direto no WhatsApp.';
        return null;
      },
    },
    {
      id: 'contato_email', rotulo: 'E-mail', opcional: true,
      texto: function () { return 'Se quiser, me deixe também um e-mail (opcional).'; },
      opcoes: function () { return []; },
      aplicavel: function () { return true; },
      validar: function (v) {
        if (!v) return null;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Esse e-mail parece incompleto — quer corrigir, ou prefere pular?';
        return null;
      },
    },
    {
      id: 'contato_periodo', rotulo: 'Melhor período para contato', opcional: true,
      texto: function () { return 'Qual o melhor período pra te ligarmos?'; },
      opcoes: function () { return ['Manhã', 'Tarde', 'Noite', 'Qualquer horário']; },
      aplicavel: function () { return true; },
    },
  ];

  var SERVICO_LABEL = {
    construir: 'Construir',
    reformar: 'Reformar',
    projeto: 'Projeto de arquitetura ou interiores',
    transformar: 'Transformar um ambiente sem obra',
    clinica: 'Projeto ou reforma de clínica/consultório',
    avaliando: 'Ainda estou avaliando',
  };

  /* ============ 2. ESTADO ============ */
  var CHAVE_CONVITE = 'perlaAssistConviteVisto'; // só um boolean, sem dado pessoal
  var CHAVE_CONVERSA = 'perlaAssistConversa';    // some quando a aba fecha (sessionStorage)
  var LIMITE_MSG = 400; // caracteres por mensagem de texto livre

  function estadoInicial() {
    return {
      iniciadoEm: new Date().toISOString(),
      servico: null,
      respostas: {},          // id da pergunta -> valor confirmado
      mensagens: [],          // {de:'bot'|'user', texto}
      etapa: 'inicio',        // 'inicio' | 'perguntas' | 'contato' | 'resumo'
      indice: 0,              // posição na lista de perguntas ativa
      historico: [],          // pilha de {etapa, indice} para "voltar"
    };
  }

  function carregarEstado() {
    try {
      var bruto = sessionStorage.getItem(CHAVE_CONVERSA);
      if (bruto) return JSON.parse(bruto);
    } catch (e) { /* sessionStorage indisponível — segue só em memória */ }
    return estadoInicial();
  }

  function salvarEstado(estado) {
    try { sessionStorage.setItem(CHAVE_CONVERSA, JSON.stringify(estado)); } catch (e) { /* ok seguir sem persistir */ }
  }

  function apagarEstado() {
    try { sessionStorage.removeItem(CHAVE_CONVERSA); } catch (e) { /* nada a fazer */ }
  }

  /* ============ 3. SERVIÇO DE IA (ponto de extensão — não operacional nesta entrega) ============ */
  var ServicoIA = {
    disponivel: false,
    // Assinatura pensada para um backend futuro: receberia só o texto da última mensagem e o
    // estado ESTRUTURADO (não o histórico bruto), nunca nome/telefone/e-mail sem necessidade.
    // Hoje retorna sempre null — o fluxo guiado abaixo cobre 100% da conversa.
    interpretar: function (_textoLivre, _estadoResumido) { return null; },
  };

  /* Extrator simples por palavra-chave/regex — NÃO é IA, é casamento de padrão mesmo.
     Roda em toda mensagem de texto livre pra aproveitar respostas combinadas (ex.: "quero
     reformar um apartamento em Savassi, uns 90m², ainda sem data") e evitar perguntar de novo o
     que a pessoa já disse. */
  function extrairSinais(texto, estado) {
    var achados = {};
    var t = texto;

    var tel = t.match(/(\+?\(?\d[\d\s().-]{7,17}\d\)?)/);
    if (tel && !estado.respostas.contato_whatsapp) {
      var telLimpo = tel[0].trim().replace(/^\(\s*/, '(').replace(/^([^\d(+]+)/, '');
      var digitos = telLimpo.replace(/\D/g, '');
      if (digitos.length >= 10 && digitos.length <= 14) achados.contato_whatsapp = telLimpo;
    }
    var email = t.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    if (email && !estado.respostas.contato_email) achados.contato_email = email[0];

    var area = t.match(/(\d{2,4})\s?(m²|m2|metros)/i);
    if (area && !estado.respostas.area_m2) achados.area_m2 = area[1] + ' m²';

    if (/sem data|ainda n[aã]o sei quando|n[aã]o defini(do)? (a )?data/i.test(t) && !estado.respostas.quando_comecar) {
      achados.quando_comecar = 'Sem data definida';
    }

    return achados;
  }

  /* ============ 4. RESUMO E WHATSAPP ============ */
  var CAMPOS_RESUMO = [
    ['contato_nome', 'Nome'],
    ['contato_whatsapp', 'WhatsApp'],
    ['contato_email', 'E-mail'],
    ['servicoLabel', 'Serviço desejado'],
    ['tipo_imovel', 'Tipo de imóvel'],
    ['cidade_bairro', 'Cidade/bairro'],
    ['situacao_imovel', 'Situação do imóvel ou terreno'],
    ['o_que_fazer', 'O que pretendo fazer'],
    ['area_m2', 'Área aproximada'],
    ['etapa_atual', 'Etapa atual'],
    ['quando_comecar', 'Previsão para começar'],
    ['investimento', 'Investimento informado'],
    ['prioridade', 'Prioridade'],
    ['contato_periodo', 'Melhor período para contato'],
    ['observacoes', 'Observações'],
  ];

  function nomeDaPagina() {
    var h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    return document.title.split('|')[0].trim() || 'Site da Perla';
  }

  function montarResumoTexto(estado) {
    var dados = {};
    for (var k in estado.respostas) dados[k] = estado.respostas[k];
    dados.servicoLabel = estado.servico ? SERVICO_LABEL[estado.servico] : null;

    var linhas = ['Olá, equipe Perla! Conversei com o assistente do site e gostaria de falar sobre meu projeto.'];
    CAMPOS_RESUMO.forEach(function (par) {
      var valor = dados[par[0]];
      if (valor) linhas.push(par[1] + ': ' + valor);
    });
    linhas.push('Página/projeto de interesse: ' + nomeDaPagina());
    return linhas.join('\n');
  }

  function linkWhatsapp(texto) {
    return 'https://wa.me/' + Conteudo.numeroWhatsapp + '?text=' + encodeURIComponent(texto);
  }

  /* ============ 5. INTERFACE ============ */
  var el = {}; // cache de elementos do DOM do widget
  var estado = carregarEstado();

  function svgAbrir() {
    return '<svg class="pa-fab-abrir" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-3.8 7.1L3 21l1.9-6.1A8.5 8.5 0 1 1 21 11.5z"/></svg>';
  }
  function svgFechar() {
    return '<svg class="pa-fab-fechar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:none"><path d="M6 6l12 12M18 6l-12 12"/></svg>';
  }

  function montarDOM() {
    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'pa-fab';
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-label', 'Abrir o Assistente Perla');
    fab.innerHTML = svgAbrir() + svgFechar();
    document.body.appendChild(fab);

    var invite = document.createElement('div');
    invite.className = 'pa-invite';
    invite.setAttribute('role', 'status');
    invite.innerHTML = '<p>' + Conteudo.convite + '</p>' +
      '<div class="pa-invite-acoes">' +
      '<button type="button" class="pa-invite-comecar">Começar</button>' +
      '<button type="button" class="pa-invite-fechar" aria-label="Fechar convite">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6l-12 12"/></svg>' +
      '</button></div>';
    document.body.appendChild(invite);

    var panel = document.createElement('div');
    panel.className = 'pa-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', Conteudo.nomeAssistente);
    panel.innerHTML =
      '<div class="pa-cabecalho">' +
        '<span class="pa-avatar" aria-hidden="true">P</span>' +
        '<div class="pa-titulos"><b>' + Conteudo.nomeAssistente + '</b><span>Pré-atendimento</span></div>' +
        '<button type="button" class="pa-acao-topo pa-minimizar" aria-label="Minimizar conversa">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>' +
        '</button>' +
        '<button type="button" class="pa-acao-topo pa-fechar-painel" aria-label="Fechar conversa">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6l-12 12"/></svg>' +
        '</button>' +
      '</div>' +
      '<p class="pa-aviso">' + Conteudo.avisoPrivacidade + '</p>' +
      '<div class="pa-corpo" tabindex="-1"></div>' +
      '<div class="pa-rodape">' +
        '<div class="pa-nav-rodape">' +
          '<button type="button" class="pa-link-rodape pa-voltar" disabled>← Voltar</button>' +
          '<button type="button" class="pa-link-rodape pa-equipe">Prefiro falar com a equipe</button>' +
          '<button type="button" class="pa-link-rodape pa-reiniciar">Reiniciar</button>' +
          '<button type="button" class="pa-link-rodape pa-apagar">Apagar conversa</button>' +
        '</div>' +
        '<form class="pa-campo">' +
          '<label for="pa-texto">Sua resposta</label>' +
          '<textarea id="pa-texto" rows="1" maxlength="' + LIMITE_MSG + '" placeholder="Digite sua resposta…"></textarea>' +
          '<button type="submit" class="pa-enviar" aria-label="Enviar">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l16-7-6 16-2-7-8-2z"/></svg>' +
          '</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(panel);

    el.fab = fab;
    el.invite = invite;
    el.panel = panel;
    el.corpo = panel.querySelector('.pa-corpo');
    el.form = panel.querySelector('.pa-campo');
    el.textarea = panel.querySelector('#pa-texto');
    el.enviar = panel.querySelector('.pa-enviar');
    el.voltar = panel.querySelector('.pa-voltar');
    el.equipe = panel.querySelector('.pa-equipe');
    el.reiniciar = panel.querySelector('.pa-reiniciar');
    el.apagar = panel.querySelector('.pa-apagar');
    el.minimizar = panel.querySelector('.pa-minimizar');
    el.fecharPainel = panel.querySelector('.pa-fechar-painel');
  }

  function rolarParaFim() {
    el.corpo.scrollTop = el.corpo.scrollHeight;
  }

  function adicionarMensagem(de, texto, semSalvar) {
    var bolha = document.createElement('div');
    bolha.className = 'pa-msg ' + de;
    bolha.textContent = texto; // nunca innerHTML com conteúdo dinâmico
    el.corpo.appendChild(bolha);
    if (!semSalvar) estado.mensagens.push({ de: de, texto: texto });
    rolarParaFim();
  }

  function limparAreaQuick() {
    var atual = el.corpo.querySelector('.pa-quick');
    if (atual) atual.remove();
  }

  function mostrarOpcoes(opcoes, aoEscolher, opcional) {
    limparAreaQuick();
    var lista = opcoes.slice();
    if (opcional) lista.push(Conteudo.opcaoPular);
    if (!lista.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'pa-quick';
    lista.forEach(function (texto) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = texto;
      b.addEventListener('click', function () { aoEscolher(texto === Conteudo.opcaoPular ? '' : texto); });
      wrap.appendChild(b);
    });
    el.corpo.appendChild(wrap);
    rolarParaFim();
  }

  function listaAtivaDePerguntas() {
    return estado.etapa === 'contato' ? PERGUNTAS_CONTATO : PERGUNTAS;
  }

  function proximaPerguntaAplicavel(lista, apartirDe, pularJaRespondidas) {
    if (pularJaRespondidas === undefined) pularJaRespondidas = true;
    for (var i = apartirDe; i < lista.length; i++) {
      var p = lista[i];
      if (!p.aplicavel(estado)) continue;
      if (pularJaRespondidas && estado.respostas[p.id]) continue;
      return i;
    }
    return lista.length; // acabou
  }

  function irParaResumo() {
    estado.etapa = 'resumo';
    salvarEstado(estado);
    renderizarResumo();
  }

  function registrarResposta(pergunta, valor) {
    if (valor) {
      estado.respostas[pergunta.id] = valor;
      adicionarMensagem('user', valor);
    } else {
      adicionarMensagem('bot', Conteudo.faltaResposta, true);
    }
  }

  function avancar() {
    var lista = listaAtivaDePerguntas();
    var pularRespondidas = !estado.modoEdicao;
    var proximo = proximaPerguntaAplicavel(lista, estado.indice + 1, pularRespondidas);
    estado.historico.push({ etapa: estado.etapa, indice: estado.indice });
    if (proximo >= lista.length) {
      if (estado.etapa === 'perguntas') {
        estado.etapa = 'contato';
        estado.indice = proximaPerguntaAplicavel(PERGUNTAS_CONTATO, 0, pularRespondidas);
        salvarEstado(estado);
        adicionarMensagem('bot', 'Agora, quais contatos você gostaria de compartilhar com a Perla para conversar sobre esse projeto?');
        renderizarPasso();
        return;
      }
      estado.modoEdicao = false;
      irParaResumo();
      return;
    }
    estado.indice = proximo;
    salvarEstado(estado);
    renderizarPasso();
  }

  // Cria o handler de escolha de uma pergunta (validação, atalho pro resumo, avançar). Usado tanto
  // ao mostrar a pergunta pela primeira vez quanto ao retomar uma conversa minimizada.
  function criarEscolhaHandler(pergunta) {
    function aoEscolher(valor) {
      // pular (valor vazio) nunca passa por validação — só respostas de fato preenchidas
      if (valor && pergunta.validar) {
        var erro = pergunta.validar(valor);
        if (erro) { adicionarMensagem('bot', erro, true); mostrarOpcoes(pergunta.opcoes(estado), aoEscolher, pergunta.opcional !== false); return; }
      }
      registrarResposta(pergunta, valor);
      if (valor && pergunta.atalhoParaResumo && pergunta.atalhoParaResumo(valor)) { irParaResumo(); return; }
      avancar();
    }
    return aoEscolher;
  }

  // Em modo de edição, a pergunta pode já ter uma resposta anterior — "Manter" deixa confirmar
  // rápido sem repetir a mesma escolha manualmente; qualquer outra opção corrige a resposta.
  function opcoesParaExibir(pergunta) {
    var opcoes = pergunta.opcoes(estado);
    var atual = estado.respostas[pergunta.id];
    if (estado.modoEdicao && atual) return ['Manter: ' + atual].concat(opcoes);
    return opcoes;
  }
  function ajustarValorEscolhido(pergunta, valorClicado) {
    var atual = estado.respostas[pergunta.id];
    if (estado.modoEdicao && atual && valorClicado === 'Manter: ' + atual) return atual;
    return valorClicado;
  }

  function renderizarPasso() {
    el.voltar.disabled = estado.historico.length === 0;
    var lista = listaAtivaDePerguntas();
    var pergunta = lista[estado.indice];
    if (!pergunta) { irParaResumo(); return; }
    adicionarMensagem('bot', pergunta.texto(estado));
    var handler = criarEscolhaHandler(pergunta);
    mostrarOpcoes(opcoesParaExibir(pergunta), function (v) { handler(ajustarValorEscolhido(pergunta, v)); }, pergunta.opcional !== false);
  }

  function tratarTextoLivre(texto) {
    texto = texto.slice(0, LIMITE_MSG);
    if (!texto.trim()) return;

    if (estado.etapa === 'inicio') {
      adicionarMensagem('user', texto);
      adicionarMensagem('bot', 'Entendi! Pra te ajudar melhor, escolha uma das opções abaixo (ou me conte mais).');
      renderizarInicio();
      return;
    }

    var lista = listaAtivaDePerguntas();
    var pergunta = lista[estado.indice];
    if (!pergunta) return;

    var sinais = extrairSinais(texto, estado);
    Object.keys(sinais).forEach(function (id) { estado.respostas[id] = sinais[id]; });

    // ponto de extensão: um backend real de IA entraria aqui, se existisse
    ServicoIA.interpretar(texto, { servico: estado.servico });

    adicionarMensagem('user', texto);
    if (!estado.respostas[pergunta.id]) estado.respostas[pergunta.id] = texto;
    if (pergunta.validar) {
      var erro = pergunta.validar(estado.respostas[pergunta.id]);
      if (erro) { delete estado.respostas[pergunta.id]; adicionarMensagem('bot', erro, true); return; }
    }
    limparAreaQuick();
    avancar();
  }

  function renderizarInicio() {
    estado.etapa = 'inicio';
    estado.indice = 0;
    salvarEstado(estado);
    adicionarMensagem('bot', 'Como a Perla pode ajudar você?');
    mostrarOpcoes(['Construir', 'Reformar', 'Fazer um projeto de arquitetura ou interiores',
      'Transformar um ambiente sem obra', 'Projeto ou reforma de clínica/consultório', 'Ainda estou avaliando'],
      function (valor) {
        var chave = Object.keys(SERVICO_LABEL).filter(function (k) { return SERVICO_LABEL[k] === valor; })[0] || 'avaliando';
        estado.servico = chave;
        if (chave === 'clinica') estado.respostas.tipo_imovel = 'Clínica/consultório';
        adicionarMensagem('user', valor);
        estado.etapa = 'perguntas';
        var primeiro = proximaPerguntaAplicavel(PERGUNTAS, 0);
        estado.indice = primeiro;
        salvarEstado(estado);
        renderizarPasso();
      }, false);
  }

  function renderizarResumo() {
    limparAreaQuick();
    adicionarMensagem('bot', 'Antes de continuar, veja o resumo do que conversamos. Você pode editar antes de enviar.');
    var box = document.createElement('div');
    box.className = 'pa-resumo';
    box.textContent = montarResumoTexto(estado);
    el.corpo.appendChild(box);

    var acoes = document.createElement('div');
    acoes.className = 'pa-cta-final';
    var principal = document.createElement('a');
    principal.className = 'pa-btn-principal';
    principal.href = linkWhatsapp(montarResumoTexto(estado));
    principal.target = '_blank';
    principal.rel = 'noopener';
    principal.textContent = 'Continuar no WhatsApp';
    var editar = document.createElement('button');
    editar.type = 'button';
    editar.className = 'pa-btn-secundario';
    editar.textContent = 'Editar informações';
    editar.addEventListener('click', function () {
      // modo edição: percorre de novo todas as perguntas aplicáveis (sem pular as já respondidas),
      // cada uma com a opção "Manter" pra confirmar rápido sem repetir a mesma escolha.
      estado.modoEdicao = true;
      estado.etapa = 'perguntas';
      estado.indice = proximaPerguntaAplicavel(PERGUNTAS, 0, false);
      salvarEstado(estado);
      box.remove();
      acoes.remove();
      renderizarPasso();
    });
    var copiar = document.createElement('button');
    copiar.type = 'button';
    copiar.className = 'pa-btn-secundario';
    copiar.textContent = 'Copiar resumo';
    copiar.addEventListener('click', function () {
      var texto = montarResumoTexto(estado);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(function () { copiar.textContent = 'Copiado!'; setTimeout(function () { copiar.textContent = 'Copiar resumo'; }, 1800); });
      }
    });
    acoes.appendChild(principal);
    acoes.appendChild(editar);
    acoes.appendChild(copiar);
    el.corpo.appendChild(acoes);
    adicionarMensagem('bot', 'Ao continuar, você abrirá o WhatsApp com este resumo preenchido para compartilhar com a Perla. Revise a mensagem e toque em Enviar no WhatsApp.', true);
    rolarParaFim();
  }

  function abrirPainel() {
    el.panel.classList.add('aberto');
    el.invite.classList.remove('mostrar');
    el.fab.setAttribute('aria-expanded', 'true');
    if (!estado.mensagens.length) {
      adicionarMensagem('bot', Conteudo.apresentacao);
      renderizarInicio();
    } else {
      // retomando conversa existente (minimizada) — não repete perguntas já feitas
      el.corpo.querySelectorAll('.pa-msg,.pa-resumo,.pa-cta-final').forEach(function (n) { n.remove(); });
      estado.mensagens.forEach(function (m) { adicionarMensagem(m.de, m.texto, true); });
      if (estado.etapa === 'resumo') renderizarResumo();
      else {
        var lista = listaAtivaDePerguntas();
        var pergunta = lista[estado.indice];
        if (pergunta) {
          var handler = criarEscolhaHandler(pergunta);
          mostrarOpcoes(opcoesParaExibir(pergunta), function (v) { handler(ajustarValorEscolhido(pergunta, v)); }, pergunta.opcional !== false);
        }
      }
    }
    el.corpo.focus();
  }

  function fecharPainel() {
    el.panel.classList.remove('aberto');
    el.fab.setAttribute('aria-expanded', 'false');
  }

  /* ============ 6. GUARDAS DE SOBREPOSIÇÃO + CONVITE ============ */
  function algoSobrepondo() {
    return !!(document.querySelector('.nav-mobile.open') || document.querySelector('.lightbox.open') || document.body.classList.contains('nav-open'));
  }

  function tentarMostrarConvite() {
    try { if (sessionStorage.getItem(CHAVE_CONVITE)) return; } catch (e) { return; }
    if (el.panel.classList.contains('aberto')) return;
    if (algoSobrepondo()) { setTimeout(tentarMostrarConvite, 800); return; }
    el.invite.classList.add('mostrar');
    try { sessionStorage.setItem(CHAVE_CONVITE, '1'); } catch (e) { /* ok */ }
  }

  function ligarEventos() {
    el.fab.addEventListener('click', function () {
      if (el.panel.classList.contains('aberto')) fecharPainel(); else abrirPainel();
    });
    el.invite.querySelector('.pa-invite-comecar').addEventListener('click', function () {
      el.invite.classList.remove('mostrar');
      abrirPainel();
    });
    el.invite.querySelector('.pa-invite-fechar').addEventListener('click', function () {
      el.invite.classList.remove('mostrar');
    });
    el.minimizar.addEventListener('click', fecharPainel); // minimizar preserva o estado (não apaga)
    el.fecharPainel.addEventListener('click', fecharPainel);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && el.panel.classList.contains('aberto')) fecharPainel();
    });

    el.form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var texto = el.textarea.value;
      el.textarea.value = '';
      tratarTextoLivre(texto);
    });
    el.textarea.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.form.requestSubmit(); }
    });

    el.voltar.addEventListener('click', function () {
      var anterior = estado.historico.pop();
      if (!anterior) return;
      estado.etapa = anterior.etapa;
      estado.indice = anterior.indice;
      // remove da tela E do registro salvo a última mensagem do bot (a pergunta da etapa que a
      // pessoa está deixando) — sem isso, ao minimizar e reabrir depois de usar "voltar", a
      // pergunta ficaria duplicada no histórico reproduzido.
      el.corpo.querySelectorAll('.pa-resumo,.pa-cta-final').forEach(function (n) { n.remove(); });
      var ultimaBolha = el.corpo.querySelector('.pa-msg:last-child');
      if (ultimaBolha) ultimaBolha.remove();
      if (estado.mensagens.length) estado.mensagens.pop();
      salvarEstado(estado);
      renderizarPasso();
    });

    el.equipe.addEventListener('click', irParaResumo);

    el.reiniciar.addEventListener('click', function () {
      estado = estadoInicial();
      apagarEstado();
      el.corpo.innerHTML = '';
      adicionarMensagem('bot', Conteudo.apresentacao);
      renderizarInicio();
    });

    el.apagar.addEventListener('click', function () {
      estado = estadoInicial();
      apagarEstado();
      el.corpo.innerHTML = '';
      fecharPainel();
    });
  }

  function iniciar() {
    montarDOM();
    ligarEventos();
    if (estado.mensagens.length) { /* conversa em andamento na sessão — só mostra ao clicar no FAB */ }
    if (document.visibilityState === 'visible') {
      setTimeout(tentarMostrarConvite, 3000);
    } else {
      document.addEventListener('visibilitychange', function espera() {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', espera);
          setTimeout(tentarMostrarConvite, 3000);
        }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
