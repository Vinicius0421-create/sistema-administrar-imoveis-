import { Papel } from "../types";

// Item 4 da missão "Melhorias Adicionais" (08/07/2026, pedido do Vini) —
// conteúdo da Central de Ajuda e base dos tutoriais por papel. Um artigo por
// módulo/assunto (não um artigo por papel × módulo) — o próprio campo
// `papeis` decide quem vê o quê, evitando duplicar texto 5 vezes pra dizer
// a mesma coisa. Isso também é o que faz cada papel enxergar só tutoriais
// da funcionalidade que ele realmente tem permissão de usar (exigência
// explícita do pedido): a Central de Ajuda filtra por `papeis` usando o
// mesmo papel já presente no token/contexto de autenticação.
//
// Nota de manutenção (também pedida explicitamente): sempre que uma
// funcionalidade nova for adicionada ao sistema, este arquivo deveria
// ganhar um artigo novo (ou o artigo existente deveria ser atualizado) na
// mesma entrega — é por isso que cada objeto abaixo tem um campo
// `atualizadoEm`, pensado para checagem visual rápida de "o que está
// desatualizado" ao revisar este arquivo no futuro, mesmo sem nenhuma
// ferramenta especial.

export interface PerguntaFrequente {
  pergunta: string;
  resposta: string;
}

export interface ArtigoAjuda {
  id: string;
  titulo: string;
  categoria: "Conta e Acesso" | "Módulos" | "Portal do Colaborador" | "Recursos Gerais";
  // "todos" cobre os 5 papéis atuais sem precisar listar cada um e correr o
  // risco de esquecer um novo papel que venha a existir amanhã.
  papeis: Papel[] | "todos";
  resumo: string;
  objetivo: string;
  quandoUsar: string;
  passoAPasso: string[];
  exemplos?: string[];
  boasPraticas?: string[];
  errosComuns?: string[];
  faq?: PerguntaFrequente[];
  atualizadoEm: string;
}

export const ARTIGOS: ArtigoAjuda[] = [
  // ─────────────────────────── Conta e Acesso ───────────────────────────
  {
    id: "login-senha",
    titulo: "Entrar no sistema e trocar sua senha",
    categoria: "Conta e Acesso",
    papeis: "todos",
    resumo: "Como fazer login, o que fazer no primeiro acesso e como trocar sua senha quando quiser.",
    objetivo: "Garantir que você consiga entrar no sistema com segurança e manter sua senha sob seu controle.",
    quandoUsar: "Sempre que for acessar o sistema pela primeira vez, ou quando quiser trocar sua senha por conta própria.",
    passoAPasso: [
      "Acesse o endereço do sistema e informe seu e-mail e senha na tela de login.",
      "Se esta for a primeira vez (ou se sua senha foi redefinida por um administrador), o sistema vai pedir para você criar uma senha só sua antes de liberar o resto das telas.",
      "Para trocar a senha depois, quando quiser: abra o Menu Centralizado do Usuário (sua foto/iniciais no canto superior direito) e clique em \"Alterar senha\".",
      "Esqueceu a senha? Na tela de login, use o link \"Esqueci minha senha\" — um e-mail com um link de redefinição é enviado (só se o e-mail estiver mesmo cadastrado no sistema).",
    ],
    boasPraticas: [
      "Nunca compartilhe sua senha com colegas, mesmo temporariamente — cada pessoa deve ter seu próprio login.",
      "Prefira uma senha que você não usa em nenhum outro serviço.",
    ],
    errosComuns: [
      "Digitar o e-mail com espaço ou letra maiúscula a mais — o sistema não corrige isso sozinho.",
      "Tentar reaproveitar a senha temporária como senha definitiva — o sistema recusa (a nova senha precisa ser diferente da atual).",
    ],
    faq: [
      { pergunta: "Fechei o navegador sem sair — minha sessão continua aberta?", resposta: "Sim. Desde a atualização de Persistência de Login, sua sessão sobrevive a F5 e a fechar/reabrir o navegador, dentro do prazo de validade da sessão (normalmente alguns dias). Só some de propósito se você clicar em \"Sair\"." },
      { pergunta: "Posso estar logado em mais de um aparelho ao mesmo tempo?", resposta: "Sim. Veja e gerencie todos os aparelhos logados em \"Sessões ativas\", dentro do Menu Centralizado do Usuário." },
    ],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "menu-usuario",
    titulo: "Menu Centralizado do Usuário",
    categoria: "Conta e Acesso",
    papeis: "todos",
    resumo: "Onde encontrar e editar seus dados pessoais, foto, sessões ativas e sair do sistema — tudo num só lugar.",
    objetivo: "Reunir num único painel tudo relacionado à sua conta, sem espalhar essas opções por várias telas.",
    quandoUsar: "Sempre que precisar atualizar sua foto, conferir seus dados, trocar a senha, revisar onde está logado ou sair do sistema.",
    passoAPasso: [
      "Clique na sua foto/iniciais no canto superior direito de qualquer tela.",
      "No topo, veja/troque sua foto de perfil (clique no ícone de câmera sobre a foto).",
      "Em \"Contato\", confira seu e-mail e telefone cadastrados.",
      "Em \"Segurança\", clique em \"Alterar senha\" quando precisar.",
      "Em \"Sessões ativas\", veja cada aparelho/navegador logado com sua conta; encerre um específico ou todos os outros de uma vez.",
      "No fim do painel, o botão \"Sair da conta\" encerra sua sessão atual.",
    ],
    boasPraticas: [
      "Se perder o celular ou usar um computador compartilhado, use \"Encerrar todas as outras sessões\" assim que possível.",
    ],
    errosComuns: [
      "Achar que precisa estar vinculado a um cadastro de colaborador para usar o sistema — contas puramente administrativas funcionam normalmente, só não têm foto/cargo/setor/telefone (o painel avisa isso claramente).",
    ],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "chamados-offline",
    titulo: "Abrindo chamados sem internet",
    categoria: "Conta e Acesso",
    papeis: "todos",
    resumo: "Como o sistema continua permitindo abrir um chamado de manutenção mesmo sem sinal, e o que acontece quando a conexão volta.",
    objetivo: "Garantir que um chamado urgente não se perca só porque o sinal caiu no momento em que você foi abri-lo.",
    quandoUsar: "Automaticamente, sempre que você tentar abrir um chamado e o sistema detectar que está sem conexão — não é preciso ativar nada manualmente.",
    passoAPasso: [
      "Preencha o formulário de \"Novo Chamado\" normalmente, mesmo sem internet — todos os campos e o anexo de foto funcionam do mesmo jeito.",
      "Ao enviar sem conexão, você vê a mensagem \"Salvo neste aparelho — sem conexão no momento\" em vez de \"Enviado com sucesso\".",
      "O chamado aparece na sua lista com o selo \"Pendente de Sincronização\" até ser enviado de verdade.",
      "Assim que o aparelho voltar a ter conexão, o envio acontece sozinho — acompanhe pelo indicador de conexão no topo da tela (🟢 Online / 🟡 Sincronizando / 🔴 Offline).",
      "Quando terminar, aparece um aviso confirmando quantos chamados foram sincronizados com sucesso.",
    ],
    boasPraticas: [
      "Não feche o aplicativo/aba imediatamente após salvar offline — dê um tempinho para o sistema tentar sincronizar assim que o sinal voltar.",
      "Se um item ficar marcado \"Erro ao sincronizar\", toque no indicador de conexão para tentar de novo manualmente.",
    ],
    errosComuns: [
      "Achar que o chamado \"sumiu\" por estar pendente — ele continua salvo no aparelho até sincronizar; não recarregue apagando dados do navegador enquanto estiver pendente.",
    ],
    faq: [
      { pergunta: "A data de abertura registrada é a hora que eu preenchi ou a hora que sincronizou?", resposta: "É a hora real em que você preencheu e enviou o formulário, mesmo offline — o sistema preserva essa data original, não a data da sincronização." },
      { pergunta: "Corro o risco do chamado duplicar se eu tentar sincronizar de novo?", resposta: "Não. O sistema controla exatamente o que já foi enviado (inclusive anexos) e nunca reenvia a mesma coisa duas vezes." },
      { pergunta: "Isso funciona pra qualquer tela do sistema, não só chamados?", resposta: "Não — só a abertura de chamados tem esse suporte a offline. O restante do sistema continua exigindo conexão." },
    ],
    atualizadoEm: "2026-07-08",
  },

  // ────────────────────────────── Módulos ───────────────────────────────
  {
    id: "visao-geral",
    titulo: "Visão Geral (Dashboard)",
    categoria: "Módulos",
    papeis: ["ADMINISTRADOR", "GESTOR_COORDENADOR", "RH"],
    resumo: "A tela inicial com os números principais do sistema e atalhos para o que precisa de atenção.",
    objetivo: "Dar um resumo rápido da operação sem precisar abrir tela por tela.",
    quandoUsar: "Como ponto de partida do seu dia — é a primeira tela que aparece depois do login.",
    passoAPasso: [
      "Os cartões no topo mostram contagens rápidas: pessoas, equipamentos e itens em operação.",
      "\"Chamados de alta prioridade\" e \"Solicitações que precisam de atenção\" listam o que está pedindo ação — clique em qualquer item da lista para ir direto ao detalhe dele.",
      "Os gráficos mostram a distribuição por status/categoria, útil para identificar acúmulo em algum ponto específico.",
    ],
    boasPraticas: ["Comece o dia por aqui antes de ir direto para uma tela específica — evita perder algo urgente."],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "colaboradores",
    titulo: "Colaboradores",
    categoria: "Módulos",
    papeis: ["ADMINISTRADOR", "GESTOR_COORDENADOR", "RH"],
    resumo: "Cadastro de todas as pessoas da empresa: dados pessoais, unidade, setor, cargo e status.",
    objetivo: "Manter um cadastro único e atualizado de cada colaborador, usado como referência por todos os outros módulos (equipamentos, linhas, acessos, chamados).",
    quandoUsar: "Ao admitir, transferir, promover ou desligar alguém, ou para consultar os dados de qualquer pessoa da empresa.",
    passoAPasso: [
      "Use a busca e os filtros (unidade, setor, status) para localizar rapidamente um colaborador.",
      "Clique num cartão para ver o cadastro completo, incluindo equipamentos/linhas/acessos vinculados a essa pessoa.",
      "\"Novo Colaborador\" abre o formulário de cadastro — CPF é único no sistema e obrigatório (exceto para \"contas de função\", como uma recepção sem titular fixo).",
      "Para desligar alguém, mude o status para \"Desligado\" em vez de excluir o cadastro — mantém o histórico intacto.",
      "O anexo de termo de responsabilidade de equipamentos fica dentro do próprio cadastro do colaborador.",
    ],
    boasPraticas: [
      "Preencha unidade e setor sempre que possível — vários filtros e relatórios do sistema dependem desses dois campos.",
      "Use o status \"Em aviso\" para marcar quem está em aviso prévio, sem tratar como desligado ainda.",
    ],
    errosComuns: [
      "Tentar cadastrar CPF ou e-mail já usado por outro colaborador — o sistema recusa por serem campos únicos.",
      "Confundir o telefone de contato do colaborador com o número da linha corporativa — são conceitos diferentes, o corporativo vem do módulo Linhas Telefônicas.",
    ],
    faq: [
      { pergunta: "Papel RH consegue editar cadastros?", resposta: "Não — RH tem acesso somente leitura a esta tela; edição é reservada a Administrador e Gestor/Coordenador." },
    ],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "equipamentos",
    titulo: "Equipamentos",
    categoria: "Módulos",
    papeis: ["ADMINISTRADOR", "SUPORTE_TI"],
    resumo: "Inventário de notebooks, celulares e outros equipamentos, com quem está com cada um.",
    objetivo: "Saber a qualquer momento onde está cada equipamento da empresa e seu histórico de uso.",
    quandoUsar: "Ao entregar, trocar ou dar baixa em um equipamento, ou para conferir o inventário completo.",
    passoAPasso: [
      "Use a busca e o filtro de status para localizar um equipamento específico.",
      "Clique num cartão para ver detalhes: patrimônio, tipo, data de aquisição e colaborador responsável atual.",
      "Movimentações de equipamento entre colaboradores ficam registradas no módulo Movimentações/Histórico de Trocas.",
    ],
    boasPraticas: ["Mantenha o número de patrimônio preenchido sempre que existir — facilita muito localizar o item depois."],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "linhas",
    titulo: "Linhas Telefônicas",
    categoria: "Módulos",
    papeis: ["ADMINISTRADOR"],
    resumo: "Controle das linhas corporativas e de qual colaborador é a responsável principal por cada uma.",
    objetivo: "Evitar linha corporativa \"perdida\" (sem responsável claro) ou duplicada entre pessoas.",
    quandoUsar: "Ao contratar, transferir ou cancelar uma linha corporativa.",
    passoAPasso: [
      "Cada colaborador pode ter uma linha marcada como \"principal\" — é essa que aparece como \"linha corporativa\" no cadastro dele.",
      "Use \"Nova Linha\" para cadastrar um número novo e já vincular ao colaborador responsável.",
      "Ao excluir, o sistema exige confirmação explícita e não desfaz sozinho — informação real, sem etapa de \"lixeira\".",
    ],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "acessos",
    titulo: "Acessos a Sistemas",
    categoria: "Módulos",
    papeis: ["ADMINISTRADOR"],
    resumo: "Quais sistemas/plataformas cada colaborador tem acesso (login corporativo, e-mail, CRM etc.).",
    objetivo: "Ter visibilidade de quem tem acesso a quê, para revogar rapidamente em caso de desligamento.",
    quandoUsar: "Ao conceder ou revogar acesso de um colaborador a um sistema, ou para auditar quem tem acesso a quê.",
    passoAPasso: [
      "\"Conceder acesso\" vincula um colaborador a um sistema já cadastrado.",
      "Sistemas em si (o catálogo de plataformas disponíveis) são gerenciados em Configurações.",
    ],
    boasPraticas: ["Ao desligar um colaborador, revise esta tela para revogar os acessos dele nos sistemas externos correspondentes — o sistema não faz isso automaticamente."],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "solicitacoes",
    titulo: "Solicitações de Equipamento",
    categoria: "Módulos",
    papeis: ["ADMINISTRADOR", "GESTOR_COORDENADOR", "SUPORTE_TI", "FINANCEIRO"],
    resumo: "Pedidos de compra/reposição de equipamento, do pedido até a aprovação.",
    objetivo: "Formalizar e acompanhar pedidos de equipamento novo, com aprovação registrada.",
    quandoUsar: "Quando um colaborador (pelo Portal) ou alguém da administração precisa pedir um equipamento novo.",
    passoAPasso: [
      // Achado ao construir o módulo de Papelaria e Compras (09/07/2026):
      // "Solicitações" deixou de significar só Equipamento — agora tem 2
      // sub-abas dentro do mesmo item de menu. Este artigo continua
      // cobrindo só a aba "Equipamentos"; ver o artigo "Papelaria e Compras"
      // para a outra frente.
      "Desde 09/07/2026, \"Solicitações\" tem 2 sub-abas: \"Equipamentos\" (este artigo) e \"Papelaria e Compras\" (artigo próprio, mais abaixo). Use a pílula no topo da tela para alternar entre elas.",
      "O quadro Kanban mostra as solicitações por status — arraste o cartão entre colunas para avançar o fluxo.",
      "Clique num cartão para ver justificativa, quantidade e valor estimado.",
      // Duas etapas (17/07/2026, reorganização de hierarquia + papel
      // Financeiro): antes era um único aprovador; agora a aprovação exige
      // dois passos independentes, ver PASSO abaixo.
      "Desde 17/07/2026, a aprovação tem 2 etapas: primeiro Suporte/TI (ou Administrador) valida tecnicamente, movendo para \"Em análise\"; só depois o Financeiro (ou Administrador) decide aprovar/reprovar o custo. Gestor/Coordenador continua podendo criar solicitação em nome do time e acompanhar o andamento, mas não decide nenhuma das duas etapas.",
    ],
    faq: [
      { pergunta: "Por que não consigo aprovar/reprovar uma solicitação mesmo tendo acesso à tela?", resposta: "A aprovação de custo é exclusiva de Financeiro/Administrador, e só fica disponível depois que a solicitação já foi validada tecnicamente (status \"Em análise\") por Suporte/TI ou Administrador." },
    ],
    atualizadoEm: "2026-07-17",
  },
  {
    id: "papelaria-compras",
    titulo: "Papelaria e Compras",
    categoria: "Módulos",
    papeis: ["ADMINISTRADOR", "GESTOR_COORDENADOR", "RH", "FINANCEIRO"],
    resumo: "Remessas de papelaria e material de escritório: mensal (ciclo normal) ou avulsa (urgente), do pedido até a entrega.",
    objetivo: "Organizar pedidos de material de escritório por unidade, com aprovação e acompanhamento até a entrega — mesmo racional de Solicitações de Equipamento, mas para papelaria/consumíveis.",
    quandoUsar: "Ao montar a remessa mensal de material de uma unidade, ao analisar um pedido que um colaborador abriu pelo Portal, ou quando falta algo com urgência antes do próximo ciclo (remessa avulsa).",
    passoAPasso: [
      "Acesse pela aba \"Solicitações\" → pílula \"Papelaria e Compras\" no topo da tela (para RH, esta é a única aba — não existe alternador).",
      "Desde 09/07/2026, qualquer colaborador também pode abrir uma solicitação pelo Portal dele — nesse caso ela chega pronta como \"Mensal\"/prioridade Média, sem justificativa, porque quem decide se é urgente é quem gerencia o módulo (ver próximo passo), não quem pediu.",
      "\"Mensal\" é a remessa programada, dentro do ciclo normal de reposição — não exige justificativa. \"Avulsa/Urgente\" é um pedido fora do ciclo, e o sistema exige uma justificativa antes de deixar salvar — inclusive ao RECLASSIFICAR uma solicitação que chegou como Mensal (abra a solicitação, edite o Tipo para Avulsa e preencha a justificativa antes de aprovar).",
      "Ao montar os itens, escolha a categoria e depois o produto já cadastrado no catálogo — se o item não estiver na lista, escolha \"Outro / não cadastrado...\" e digite o nome livremente (a categoria continua obrigatória mesmo nesse caso).",
      "\"Salvar rascunho\" guarda a solicitação sem enviar para análise (dá para voltar e editar depois); \"Enviar\" já manda direto para a fila de análise. Solicitações abertas por colaborador pelo Portal já nascem \"Enviada\", sem passar por rascunho.",
      "Fluxo de status, em ordem: Rascunho → Enviada → Em análise → Aprovada (ou Reprovada) → Em separação → Em transporte → Entregue. Cancelada pode acontecer a partir de qualquer ponto antes da entrega.",
      "Só é possível editar os itens/dados (inclusive reclassificar Tipo/Prioridade) enquanto o status é Rascunho ou Enviada — depois que entra em análise, a edição fica bloqueada (peça para reprovar/cancelar e abrir de novo, se for o caso).",
      "RH e Financeiro podem aprovar e mudar status aqui — mas só neste módulo, não em Equipamentos (nenhum dos dois tem acesso à aba Equipamentos). Desde 17/07/2026, Gestor/Coordenador deixou de aprovar aqui: continua vendo a lista completa e podendo criar em nome do time, mas a decisão é de RH/Financeiro/Administrador.",
      "A aba \"Indicadores\" (pílula ao lado de \"Quadro\") mostra solicitações abertas/concluídas/urgentes, remessas mensais dos últimos 30 dias, tempo médio de atendimento e gráficos por unidade/período.",
    ],
    boasPraticas: [
      "Reclassifique para \"Avulsa\" só quando realmente não dá pra esperar o próximo ciclo — é você (RH/Administrador/Gestor) quem decide isso agora, então essa escolha fica mais consistente do que deixar cada colaborador marcar como quiser.",
      "Prefira escolher o produto do catálogo em vez de digitar o nome livremente — mantém os relatórios/indicadores consistentes ao longo do tempo.",
      "Leia a observação/motivo escrito pelo colaborador antes de classificar — é a principal pista de urgência que você tem, já que ele não escolhe o tipo.",
    ],
    errosComuns: [
      "Tentar salvar uma reclassificação para Avulsa sem preencher a justificativa — o sistema recusa, mesmo sendo uma edição e não uma criação nova.",
      "Tentar editar uma solicitação que já está Em análise ou além — o sistema bloqueia; abra a solicitação e use \"Mudar status\"/comentário para o pedido de ajuste em vez disso.",
    ],
    faq: [
      { pergunta: "Quem pode aprovar uma remessa avulsa?", resposta: "ADMINISTRADOR, RH e FINANCEIRO — desde a reorganização de hierarquia de 17/07/2026, Gestor/Coordenador não aprova mais aqui (só cria em nome do time e acompanha)." },
      { pergunta: "RH consegue ver as solicitações de Equipamento também?", resposta: "Não. O acesso de RH é limitado à aba Papelaria e Compras — Equipamentos nunca aparece para esse papel, nem como sub-aba nem em nenhum outro lugar do sistema." },
      { pergunta: "O colaborador que abriu o pedido escolhe se é urgente?", resposta: "Não. Ele só descreve o que precisa (itens + um motivo, em texto livre); classificar como Mensal ou Avulsa/Urgente é sempre uma decisão de quem gerencia o módulo, feita durante a análise." },
    ],
    atualizadoEm: "2026-07-09",
  },
  {
    id: "chamados",
    titulo: "Chamados de Manutenção (Kanban)",
    categoria: "Módulos",
    // Gestor/Coordenador removido (17/07/2026, reorganização de hierarquia)
    // — o item de menu já tinha saído do NAV dele (ver App.tsx): tinha
    // acesso à tela mas nenhuma ação real (`podeGerenciar` em Chamados.tsx
    // já era só ADMINISTRADOR/SUPORTE_TI), um item morto que só confundia.
    papeis: ["ADMINISTRADOR", "SUPORTE_TI"],
    resumo: "Quadro Kanban de chamados técnicos, do momento em que são abertos até serem resolvidos.",
    objetivo: "Organizar e priorizar os chamados de manutenção/TI, com técnico responsável definido desde a abertura.",
    quandoUsar: "Para abrir um chamado em nome de outra pessoa, gerenciar o andamento, ou consultar o histórico de um chamado.",
    passoAPasso: [
      "Arraste os cartões entre colunas para mudar o status (no celular, abra o cartão e use o campo \"Mudar status\" em vez de arrastar).",
      "\"Novo Chamado\" exige categoria, descrição, unidade e técnico responsável — todos obrigatórios desde 07/07/2026.",
      "Você pode anexar fotos/arquivos já na abertura do chamado (funciona mesmo sem conexão — ver artigo \"Abrindo chamados sem internet\").",
      "Use o filtro de unidade para ver só os chamados de uma cidade específica (Itaúna, Itatiaiuçu ou Igarapé).",
      "Dentro do chamado, a aba de mensagens permite conversar diretamente com quem abriu o chamado.",
    ],
    boasPraticas: ["Preencha \"solução aplicada\" antes de encerrar um chamado — é o que aparece pro colaborador como explicação do que foi feito."],
    errosComuns: ["Tentar excluir um técnico responsável sem reatribuir — o sistema sempre exige um responsável, nunca fica \"sem ninguém\"."],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "portal-suporte",
    titulo: "Fila de Atendimento (Suporte de TI)",
    categoria: "Módulos",
    papeis: ["SUPORTE_TI"],
    resumo: "Visão dedicada de Suporte de TI, focada na fila de chamados que precisam de atendimento.",
    objetivo: "Dar ao Suporte de TI uma tela de trabalho enxuta, sem os módulos administrativos que não usam no dia a dia.",
    quandoUsar: "Como tela principal de trabalho de quem atende chamados técnicos.",
    passoAPasso: [
      "A fila prioriza automaticamente por urgência/tempo em aberto.",
      "Clique num item para atender, mudar status ou conversar com quem abriu o chamado.",
    ],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "movimentacoes",
    titulo: "Movimentações de Colaboradores",
    categoria: "Módulos",
    // Gestor/Coordenador adicionado (17/07/2026, reorganização de
    // hierarquia) — já tinha permissão de escrita no backend, ganhou o item
    // de menu agora que sua identidade passou a ser o ciclo de vida de
    // pessoas (ver App.tsx e useAppData.ts `podeVerMovimentacoes`).
    papeis: ["ADMINISTRADOR", "GESTOR_COORDENADOR"],
    resumo: "Histórico de admissões, desligamentos, transferências e promoções.",
    objetivo: "Manter um registro formal de mudanças na vida funcional de cada colaborador.",
    quandoUsar: "Ao registrar uma transferência de unidade/setor ou uma promoção.",
    passoAPasso: ["Escolha o tipo de movimentação e o colaborador — o sistema já preenche os dados atuais como ponto de partida."],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "historico-trocas",
    titulo: "Histórico de Trocas",
    categoria: "Módulos",
    papeis: ["ADMINISTRADOR"],
    resumo: "Registro de todo equipamento que já trocou de mãos entre colaboradores.",
    objetivo: "Rastrear a cadeia de custódia de um equipamento ao longo do tempo.",
    quandoUsar: "Para conferir quem teve um equipamento antes da pessoa atual, ou investigar um problema de patrimônio.",
    passoAPasso: ["A lista é somente consulta — trocas novas são geradas automaticamente quando um equipamento muda de colaborador responsável."],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "mensagens",
    titulo: "Mensagens (Chat interno)",
    categoria: "Módulos",
    papeis: ["ADMINISTRADOR", "GESTOR_COORDENADOR", "SUPORTE_TI", "COLABORADOR"],
    resumo: "Chat interno com conversas diretas e canais por unidade/setor.",
    objetivo: "Permitir comunicação rápida dentro do próprio sistema, sem depender de WhatsApp/e-mail para assuntos do dia a dia.",
    quandoUsar: "Para tirar uma dúvida rápida, avisar algo a um setor inteiro, ou conversar sobre um chamado específico.",
    passoAPasso: [
      "No celular, a lista de conversas e a conversa aberta ocupam a tela inteira uma de cada vez — use a seta \"Voltar\" no topo da conversa para retornar à lista.",
      "Canais por unidade/setor reúnem automaticamente quem pertence àquele grupo — acesso é restrito a quem realmente faz parte.",
      "Dá para anexar imagem ou vídeo curto diretamente numa mensagem.",
    ],
    atualizadoEm: "2026-07-08",
  },
  {
    id: "configuracoes",
    titulo: "Configurações do Sistema",
    categoria: "Módulos",
    papeis: ["ADMINISTRADOR"],
    resumo: "Cadastro dos domínios usados em todo o sistema: unidades, setores, cargos, empresas e sistemas de acesso.",
    objetivo: "Manter as listas-base (dropdowns) usadas em todo o sistema sempre atualizadas e sem duplicidade.",
    quandoUsar: "Ao criar um novo setor, cargo, unidade ou sistema de acesso antes de conseguir usá-lo em outro cadastro.",
    passoAPasso: [
      "Cada bloco (Unidades, Setores, Cargos, Empresas, Sistemas) tem seu próprio botão \"Novo\".",
      "O sistema impede excluir um item que já está em uso em outro cadastro (ex: um setor com colaboradores vinculados) — avisa exatamente onde está o vínculo.",
      "Desde 09/07/2026, há também \"Categorias de Produto (Papelaria)\" e \"Produtos de Papelaria\" — o catálogo usado ao montar itens de uma solicitação de Papelaria e Compras. Produto exige uma categoria já cadastrada e tem uma unidade de medida padrão (ex: Resma, Caixa, Pacote).",
    ],
    atualizadoEm: "2026-07-09",
  },

  // ────────────────────────── Portal do Colaborador ──────────────────────
  {
    id: "portal-colaborador",
    titulo: "Portal do Colaborador (autoatendimento)",
    categoria: "Portal do Colaborador",
    papeis: ["COLABORADOR"],
    resumo: "Sua tela pessoal para abrir chamados, pedir equipamento, solicitar material de escritório e conversar com o suporte — sem acesso aos módulos administrativos.",
    objetivo: "Dar autonomia para você resolver sozinho as solicitações mais comuns, sem depender de pedir para alguém da administração.",
    quandoUsar: "Sempre que precisar abrir um chamado técnico, solicitar um equipamento, pedir material de escritório, ou conversar com o suporte.",
    passoAPasso: [
      "\"Abrir Chamado\" leva ao formulário — descreva o problema, escolha a unidade e o técnico responsável (funciona mesmo sem internet, ver artigo específico).",
      "\"Solicitar Equipamento\" é para pedidos de equipamento novo — descreva a justificativa.",
      "\"Solicitar Papelaria\" é para material de escritório (papel, canetas, material de limpeza etc.) — ver artigo específico \"Solicitar Papelaria e Material de Escritório\".",
      "\"Mensagens\" abre o mesmo chat interno usado pelo resto do sistema.",
      "\"Meus chamados\" e \"Minhas solicitações\", mais abaixo na tela, mostram o andamento de tudo que você já abriu — toque em qualquer item para ver detalhes.",
    ],
    errosComuns: [
      "Achar que precisa preencher o nome do solicitante — o sistema já identifica você automaticamente pelo seu login, não existe seletor de \"em nome de quem\".",
    ],
    faq: [
      { pergunta: "Não vejo meu cadastro / não consigo abrir nada no Portal — por quê?", resposta: "Sua conta de login provavelmente ainda não está vinculada a um cadastro de colaborador. Fale com o RH ou com o administrador do sistema para regularizar." },
    ],
    atualizadoEm: "2026-07-09",
  },
  {
    id: "portal-solicitar-papelaria",
    titulo: "Solicitar Papelaria e Material de Escritório",
    categoria: "Portal do Colaborador",
    papeis: ["COLABORADOR"],
    resumo: "Peça papel, canetas, material de limpeza e outros itens de escritório direto pelo Portal — o RH analisa e aprova.",
    objetivo: "Facilitar o pedido de material de escritório sem precisar falar direto com o RH por WhatsApp ou pessoalmente.",
    quandoUsar: "Sempre que faltar algo no dia a dia (papel, café, material de limpeza etc.) ou precisar de algo pontual e urgente.",
    passoAPasso: [
      "Toque em \"Solicitar Papelaria\" no Portal.",
      "Escolha a unidade e adicione um ou mais itens: selecione a categoria e o produto do catálogo (se o que você precisa não estiver na lista, escolha \"Outro / não cadastrado...\" e digite o nome) e informe a quantidade.",
      "Escreva um breve motivo/observação — é a informação mais importante que você pode dar, porque é a partir dela que o RH decide se seu pedido é tratado como urgente.",
      "Envie — o pedido já entra direto na fila de análise do RH (não existe \"rascunho\" no Portal).",
      "Acompanhe o andamento em \"Minhas solicitações de papelaria\": Enviada → Em análise → Aprovada (ou Reprovada) → Em separação → Em transporte → Entregue.",
      "Você pode comentar na sua própria solicitação a qualquer momento — útil se o RH pedir mais detalhes, ou se você quiser reforçar que é urgente.",
    ],
    errosComuns: [
      "Achar que dá para marcar o pedido como \"urgente\" você mesmo — essa classificação (Mensal ou Avulsa/Urgente) é sempre feita pelo RH durante a análise, não por quem pede. Por isso, capriche na observação: é ela que ajuda o RH a perceber a urgência.",
    ],
    faq: [
      { pergunta: "Por que não escolho se meu pedido é urgente?", resposta: "Para manter a classificação consistente, quem decide se uma remessa é Mensal (ciclo normal) ou Avulsa/Urgente é sempre o RH (ou Administrador/Gestor), a partir do que você descreveu no motivo — não existe campo de urgência no formulário do Portal." },
      { pergunta: "Posso pedir em nome de outra pessoa/unidade?", resposta: "Não. Toda solicitação aberta pelo Portal é sempre em seu próprio nome." },
    ],
    atualizadoEm: "2026-07-09",
  },
];

export function artigosParaPapel(papel: Papel): ArtigoAjuda[] {
  return ARTIGOS.filter((a) => a.papeis === "todos" || a.papeis.includes(papel));
}

export function categoriasParaPapel(papel: Papel): string[] {
  const vistas = new Set(artigosParaPapel(papel).map((a) => a.categoria));
  // Ordem fixa (não alfabética) — Conta e Acesso primeiro porque é o que
  // qualquer pessoa, de qualquer papel, mais provavelmente vai procurar
  // primeiro ("como troco minha senha", "por que caiu minha sessão").
  return (["Conta e Acesso", "Portal do Colaborador", "Módulos", "Recursos Gerais"] as const).filter((c) => vistas.has(c));
}
