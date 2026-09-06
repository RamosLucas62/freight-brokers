# Produto: auditoria por e-mail e assinatura

Decisões do produto registradas em 2026-09-06. Este documento descreve o fluxo a implementar; recebimento de e-mail, envio de relatórios, contas por cliente e Stripe ainda não estão implementados.

## Experiência do cliente

1. Cliente se cadastra e paga a assinatura pelo Stripe.
2. Após confirmação de elegibilidade pelo backend, recebe um endereço exclusivo, por exemplo `shore-logistics@audit.aiolympian.com`.
3. Adiciona esse endereço às regras de encaminhamento de contas a pagar ou o coloca em cópia nos e-mails de faturas das transportadoras.
4. O sistema recebe anexos automaticamente, identifica a empresa pelo destinatário e processa a auditoria.
5. O relatório fica salvo no sistema e é entregue por e-mail aos destinatários cadastrados do cliente. O corpo deve informar resultado, alertas e ações necessárias, sem exigir login para entender o resultado; o sistema oferece histórico e detalhes complementares.
6. A interface serve para cadastro, assinatura, destinatários, configurações e histórico. Upload manual não é o fluxo principal do cliente.

## Entrada centralizada no domínio

O catch-all `*@audit.aiolympian.com` terá uma entrada central. Cada endereço deve ser cadastrado e vinculado a um identificador interno imutável de cliente. O prefixo não é uma credencial de acesso, nem cria uma conta automaticamente.

O provedor de e-mail precisa entregar o destinatário SMTP original e os anexos ao backend por webhook autenticado ou mecanismo equivalente. Uma simples caixa compartilhada só atende se preservar essas informações. Não identificar a conta exclusivamente pelos cabeçalhos To/Cc: encaminhamento e cópia oculta podem torná-los insuficientes.

- Reservar aliases únicos; normalizar caixa e validar o domínio completo. Evitar reutilizar aliases de clientes encerrados.
- Endereços desconhecidos não iniciam auditorias cobradas e não recebem documentos de outras contas.
- Uma mensagem destinada a vários aliases deve produzir trabalhos separados por cliente, com deduplicação em cada conta.
- Limitar tamanho e quantidade de anexos; validar PDF; sinalizar arquivos sem suporte ou com várias faturas conforme o contrato atual.
- Preservar mensagem, anexos e vínculo com a auditoria em armazenamento privado. Política e prazo de retenção ainda serão definidos.
- Registrar identificador do evento e hash por cliente para que reentregas do provedor não processem nem cobrem o mesmo anexo novamente.
- Filtrar loops, respostas automáticas e mensagens sem anexos. Não tratar conteúdo de e-mail/PDF como instruções para o sistema.

O provedor de recebimento/envio ainda precisa ser escolhido. Configurar MX no subdomínio de auditoria e autenticação do domínio de envio conforme esse provedor, sem substituir a configuração de e-mail do domínio principal.

## Separação dos dados

Pré-requisito para atender múltiplos clientes: adicionar `tenant_id` às faturas, alertas, relatórios, anexos, mensagens e trabalhos. Toda consulta de histórico, regra e gravação deve receber esse contexto.

O índice de hash passa a ser único por `(tenant_id, document_hash)`. A função de gravação deve conferir pertencimento ao cliente e concorrência no histórico dele. Aplicar RLS para usuários do painel; o backend com chave de serviço também deve restringir explicitamente suas consultas, pois não depende da RLS para isolamento.

O cache de dados públicos FMCSA pode ser compartilhado; documentos e dados bancários privados não. Os registros fictícios existentes devem ser vinculados a uma conta de teste, nunca automaticamente ao primeiro cliente pago. Não aplicar alterações às tabelas de CRM preexistentes.

## Processamento e entrega

Entrada autenticada → identificação do cliente → persistência do evento/anexos → fila → conferência de conta ativa → extração OpenRouter → regras e histórico do cliente → gravação atômica do relatório → fila de envio → e-mail do cliente.

A fila permite responder rapidamente ao webhook e retomar falhas. Antes de uma chamada paga, revalidar estado e deduplicação. Registrar tentativas de extração e evitar repetição cega quando uma resposta externa tiver resultado incerto.

Salvar o relatório antes de agendar a entrega. Usar uma caixa de saída transacional vinculada ao relatório: falha no e-mail não deve gerar uma nova auditoria. Registrar envio, falhas e entrega quando o provedor disponibilizar esses eventos; aceitação do envio não comprova leitura.

Enviar somente aos destinatários verificados cadastrados na conta, nunca automaticamente ao remetente da fatura ou a todos os endereços em cópia. Não incluir números completos de contas bancárias no e-mail; apresentar a divergência com dados mascarados. Qualquer link para detalhes deve exigir autorização da conta ou token restrito e com validade.

Proposta inicial: um relatório por e-mail recebido, reunindo os anexos aceitos e indicando falhas parciais. Frequência final (imediata, resumo diário ou ambas) ainda depende de decisão do produto. A mensagem deve distinguir ausência de alertas de comprovação de legitimidade; os resultados de IA continuam sujeitos a revisão.

## Stripe e estado da conta

Manter `stripe_customer_id`, `stripe_subscription_id`, estado original da assinatura e estado de serviço separado: `active`, `inactive`, `paused`, com motivo e datas. Não guardar dados de cartão no aplicativo.

- Ativa: assinatura elegível e período de serviço confirmado; permite novas auditorias.
- Inativa: conta sem ativação ou acesso encerrado; não inicia extrações pagas.
- Pausada: serviço temporariamente suspenso; preserva a associação do endereço e o histórico. A política de cobrança durante a pausa ainda precisa ser definida.

A confirmação deve vir de eventos Stripe assinados e consulta ao estado atual quando necessário, não do redirecionamento de sucesso do checkout. Tratar pagamento, falha de pagamento, atualização e encerramento da assinatura. Deduplicar eventos por ID e suportar eventos fora de ordem, sem reativar uma conta por um pagamento antigo.

`pause_collection` e estado de assinatura `paused` têm significados diferentes: não copiar esses valores cegamente para o estado do serviço. Definir também carência por atraso, cancelamento imediato ou ao final do período, retomada e cobrança proporcional antes de implementar as transições.

Mensagens recebidas durante pausa/inatividade não devem desaparecer silenciosamente nem iniciar custo de IA. Proposta: registrar como bloqueadas e notificar contatos cadastrados com controle de frequência. Retenção dos anexos e processamento retroativo na reativação ainda serão definidos.

## Sequência de implementação

1. Clientes, aliases, destinatários e isolamento dos dados, com testes de acesso entre contas.
2. Stripe em ambiente de teste, checkout, eventos assinados e controle de elegibilidade.
3. Provedor de e-mail, DNS do subdomínio, entrada autenticada e armazenamento de anexos.
4. Fila de processamento com contexto do cliente, idempotência e tratamento de falhas.
5. Relatório legível por e-mail, fila de entrega e histórico no sistema.
6. Painel auxiliar para cadastro, configurações, assinatura e consulta.

Critérios de aceite: encaminhamento e cópia oculta resolvem o cliente correto; contas diferentes não compartilham histórico; eventos repetidos não duplicam custo/documentos/e-mails; pagamento ativa acesso e encerramento o bloqueia conforme política; falha de envio permite reenviar sem reauditar; clientes recebem o resultado sem precisar abrir o painel.

## Definições ainda necessárias

- Provedor de e-mail e acesso ao DNS de `aiolympian.com`.
- Conta Stripe, plano, preço, moeda e periodicidade.
- Política de pausa, atraso, cancelamento, retenção e reprocessamento.
- Frequência, idioma e destinatários dos relatórios.

## Referências técnicas

- Stripe, eventos de assinaturas: https://docs.stripe.com/billing/subscriptions/webhooks
- Stripe, pausa de cobrança: https://docs.stripe.com/billing/subscriptions/pause-payment
- Exemplo de provedor que preserva destinatário SMTP e anexos (não escolhido): https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http
