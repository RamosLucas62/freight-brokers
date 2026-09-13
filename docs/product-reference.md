# Referência funcional do produto

Este documento descreve o comportamento atual do Olympian Freight Audit. Ele serve para produto, suporte, vendas, QA e engenharia. Detalhes de implantação ficam no [runbook operacional](operations-runbook.md).

## 1. Visão do sistema

O produto tem quatro superfícies conectadas:

1. **Auditoria gratuita:** captura um lead, confirma o e-mail, audita um lote e conduz o lead até o checkout.
2. **Auditoria recorrente:** recebe e processa documentos enviados ao endereço exclusivo da empresa.
3. **Portal do cliente:** apresenta operação, relatórios, exceções, cobrança e configurações.
4. **Administração global:** gerencia empresas e usuários e acompanha o CRM automático.

Os principais serviços externos são Supabase/PostgreSQL, Supabase Auth, Cloudflare R2, Redis, Resend, OpenRouter, FMCSA, Stripe, Google Chat e o scanner privado de PDF.

## 2. Auditoria gratuita

### 2.1 Dados capturados

O formulário envia `multipart/form-data` para `POST /webhooks/free-audit` com:

- nome do contato;
- nome da empresa;
- e-mail profissional;
- telefone;
- faixa de faturas/cargas por mês;
- PDFs ou ZIP com PDFs;
- token do Cloudflare Turnstile;
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term` e `utm_content`, quando presentes.

Limites: até 50 PDFs, 20 MiB por PDF e 100 MiB descompactados no total. Caminhos internos do ZIP são descartados, arquivos repetidos são removidos por SHA-256 e o tamanho declarado e o expandido são verificados.

### 2.2 Jornada

1. O servidor valida origem, Turnstile, formato, limites e taxa por IP/e-mail.
2. Os arquivos ficam inertes no R2 privado; nenhum processamento começa antes da confirmação.
3. O contato recebe um link aleatório válido por 30 minutos.
4. O link é consumido uma vez e coloca o pedido na fila.
5. O worker examina os PDFs, executa a auditoria e envia um link para o resultado privado; nessa página o lead baixa PDF e CSV.
6. O token do resultado é criado com validade máxima de 35 dias e recomenda um plano conforme o volume informado. A retenção dos dados é de 30 dias; quando a limpeza ocorrer, o resultado deixa de existir mesmo que ainda reste validade nominal no token.
7. Se o lead não assinar, recebe follow-ups em D+1, D+3, D+5, D+10 e D+30.
8. Assinatura, descadastro, expiração ou cancelamento encerram os follow-ups ainda pendentes.

O mesmo endereço tem direito a uma auditoria gratuita concluída. Nova solicitação não guarda nem processa os documentos; envia uma oferta no máximo uma vez a cada 24 horas. A resposta HTTP é sempre genérica (`202`) para não revelar se o endereço já existe.

### 2.3 Falha e recuperação

- Erros temporários são tentados novamente automaticamente, até o limite da fila.
- Arquivo inválido, inseguro, criptografado ou grande demais gera orientação específica.
- Quando não existe resultado utilizável, o direito gratuito não é consumido.
- O cliente recebe um link de substituição de arquivos, aleatório, de uso único e válido por 72 horas. Dados do contato não são solicitados novamente.
- Arquivos, resultado e perfil identificável são programados para eliminação após 30 dias; permanece somente o necessário para impedir repetição indevida do benefício.

## 3. Contratação, teste e onboarding

### 3.1 Checkout

O visitante escolhe Core, Growth ou Scale e período mensal, semestral ou anual. O checkout público aceita `email`, `plan`, `period` e `turnstile_token`; o checkout do resultado privado reutiliza o e-mail verificado do lead.

O Stripe cria uma assinatura com cartão e teste de 7 dias. O backend não considera parâmetros do navegador como prova de pagamento: o webhook assinado e uma nova consulta ao Stripe são as fontes de verdade.

### 3.2 Estados de cobrança

| Estado local | Significado operacional |
| --- | --- |
| `pending_payment` | Checkout recebido, mas pagamento/teste ainda não confirmado. |
| `trialing` | Teste gratuito de 7 dias ativo; empresa pode operar. |
| `active` | Assinatura paga e empresa ativa. |
| `past_due` | Pagamento falhou; há carência de três dias. |
| `paused` | Pausa voluntária ou carência expirada; novas auditorias são bloqueadas. |
| `canceling` | Cancelamento agendado para o fim do período; operação segue ativa até lá. |
| `canceled` | Assinatura encerrada; empresa inativa e exclusão programada. |

Eventos Stripe aceitos: `checkout.session.completed`, `invoice.payment_failed`, `invoice.paid`, `customer.subscription.updated` e `customer.subscription.deleted`. IDs de evento, checkout, assinatura e fatura impedem efeitos duplicados.

### 3.3 Notificações corretas do ciclo

- Checkout sem cobrança imediata (`no_payment_required`) gera **período de teste iniciado**.
- Mudança de `trialing` para `active` gera **período de teste encerrado**.
- **Plano atualizado** só é enviado quando plano ou período realmente mudou.
- **Novo cliente** representa assinatura paga, não o começo do teste.
- Nome, empresa e e-mail são enriquecidos com o pedido de auditoria gratuita mais recente.

### 3.4 Onboarding e aceite

Após o checkout, uma fila idempotente envia o e-mail de onboarding. O cliente informa empresa, usuário principal, destinatários e fuso horário. O backend valida novamente checkout e assinatura antes de criar a empresa, o endereço de entrada e os vínculos.

No primeiro login autenticado, um diálogo bloqueante exige aceite dos Termos de Serviço e ciência da Política de Privacidade. O aceite não fica na página de vendas nem no checkout. São registrados usuário, versões, texto exibido, horário do servidor, IP e user agent. Uma nova versão exige novo aceite. Depois disso, o guia inicial é apresentado.

## 4. Recebimento recorrente por e-mail

Cada empresa recebe um alias em `audit.aiolympian.com`. O Resend entrega `email.received` em `POST /webhooks/resend`.

O fluxo:

1. verifica a assinatura Svix do webhook;
2. grava o evento e cria um job idempotente;
3. confirma que a empresa está disponível;
4. ignora respostas automáticas para evitar loops;
5. valida autenticação e autorização do remetente;
6. lista, baixa, limita e examina os PDFs;
7. armazena anexos no R2 privado antes da extração paga;
8. classifica cada PDF;
9. processa invoice, POD e rate confirmation;
10. grava faturas, exceções e relatório de forma transacional;
11. agenda notificações aplicáveis.

### 4.1 Estados do job

| Estado | Interpretação |
| --- | --- |
| `queued` | Aguardando execução ou nova tentativa automática. |
| `processing` | Job reivindicado por um worker. |
| `completed` | Processamento terminou; pode conter exceções para revisão. |
| `needs_review` | Falha permanente ou temporária ainda presente após as tentativas. |
| `blocked` | Conta, remetente ou regra de acesso impediu a execução. |
| `ignored` | Mensagem automática ou sem PDF; não exige auditoria. |

Falhas temporárias de rede/provedor em classificação ou extração usam atrasos de 1, 5 e 15 minutos. Depois disso o job passa para revisão. O portal atualiza a fila a cada 30 segundos; o cliente não precisa manter a página aberta para o worker continuar.

## 5. Documentos e contagem

### 5.1 Tipos

- **Invoice:** fatura cobrada; é a única categoria que pode contar no uso mensal.
- **Rate confirmation:** prova do valor e dos adicionais autorizados.
- **POD:** prova de entrega e possível evidência de serviço realizado.

Nomes explícitos permitem classificação local. Nomes ambíguos usam o classificador do OpenRouter. Classificação abaixo de 0,90 exige revisão.

### 5.2 O que conta como invoice

Conta uma vez cada PDF aceito que contenha exatamente uma fatura extraída. Não contam arquivos rejeitados, PODs, rate confirmations, PDFs sem fatura, PDFs com múltiplas faturas nem o mesmo hash reenviado pela mesma empresa. Um arquivo corrigido com bytes diferentes conta como nova fatura.

Por isso, o total do portal pode ser maior que o número de e-mails: um e-mail pode ter várias faturas. Também pode ser menor que o total de anexos: documentos de apoio não contam.

## 6. Extração e confiança verificável

O OpenRouter recebe o PDF e devolve JSON estruturado. A extração inclui número e data da fatura, total, transportadora, MC/DOT, load number, data da carga, origem, destino, dados bancários, adicionais e evidência de origem por campo.

O modelo não fornece a decisão final de confiança. O motor verifica presença, formato, página/trecho de origem e coerência com o histórico da empresa.

| Estado | Consequência |
| --- | --- |
| `verified` | Evidência atende ao limiar; pode seguir automaticamente. |
| `review` | Há dado presente, mas inválido, conflitante ou insuficiente. |
| `unverifiable` | Informação necessária está ausente; nenhuma acusação é inferida. |

`CONFIDENCE_VERIFIED_THRESHOLD` é `0.92` por padrão. `CONFIDENCE_QA_SAMPLE_RATE` é `0.05`: 5% dos documentos verificados entram de forma determinística na fila de QA. A amostra não altera o resultado do cliente; serve para medir falso automático e falso review.

Dados bancários são opcionais quando ausentes. Quando presentes, precisam de evidência e formato válidos. A identificação da transportadora pode usar MC ou DOT. Veja [confiança verificável](verifiable-confidence.md).

## 7. Regras de auditoria

| Regra | Quando é gerada |
| --- | --- |
| `LOW_CONFIDENCE` | Campo crítico requer revisão ou é não verificável. |
| `DUPLICATE_EXACT` | Mesma identidade de transportadora e mesmo número de fatura no lote/histórico. |
| `DUPLICATE_PROBABLE` | Números diferentes, mas mesma transportadora, valor, janela de sete dias e sinal forte da mesma carga. |
| `BANKING_CHANGE` | Conta/routing verificáveis diferem do baseline mais recente da transportadora. |
| `MC_DIVERGENCE` | Nome verificável na fatura diverge do nome legal retornado pela FMCSA para o MC. |
| `AUTHORITY_INACTIVE` | Autoridade está inativa no momento da consulta. |
| `CARRIER_VERIFICATION_REQUIRED` | FMCSA não identificou uma transportadora única. |
| `RATE_CONFIRMATION_MISMATCH` | Transportadora ou total verificado diverge da rate confirmation. |
| `UNSUPPORTED_ACCESSORIAL` | Adicional cobrado não aparece, ou excede, o valor autorizado. |
| `UNBILLED_ACCESSORIAL` | Rate confirmation autoriza e o POD confirma o serviço, mas a fatura omite a cobrança. |

Autoridade FMCSA descreve o estado no momento da consulta; não prova o estado histórico na data da carga. Receita potencial só é calculada quando autorização e execução do serviço possuem evidência suficiente.

## 8. Relatórios e alertas ao cliente

### 8.1 Entregas

- **Imediato:** duplicidade exata, mudança bancária, autoridade inativa e achados acima do limite da empresa (US$ 5.000 por padrão).
- **Diário:** às 07:00 no fuso da empresa, cobre o dia anterior e também confirma quando não houve riscos.
- **Mensal:** no primeiro dia útil, após 07:00, cobre o mês anterior.

Cada e-mail contém resumo visual, tabela de achados, botão para o portal e anexos PDF e CSV. O PDF prioriza leitura executiva e o CSV contém período, invoice/load, carrier, achado, descrição, valor, horário, resolução e referência de origem.

### 8.2 Valores

- **Amount under review:** soma das faturas com achados; não é economia confirmada.
- **Confirmed loss avoided:** somente exceção marcada pelo cliente como `avoided`, com valor e nota.
- `no_loss` registra que a revisão não confirmou perda.
- Um achado `pending` nunca entra na economia declarada.

## 9. Portal do cliente

O portal usa magic link do Supabase. A sessão fica em cookies HttpOnly; tokens são removidos da URL e não há acesso direto do navegador à service role.

Recursos:

- fila de processamento e detalhes do job;
- faturas, relatórios, exceções e histórico, paginados em 50 itens;
- revisão do job com nota obrigatória;
- reprocessamento de exceção nos planos Growth e Scale;
- resolução como perda evitada ou sem perda;
- destinatários confirmados, remetentes autorizados e fuso horário;
- uso do mês, limite, excedente estimado e estado da assinatura;
- Stripe Customer Portal para cartão e faturas;
- desconto de retenção único, pausa de 30 dias uma vez a cada 12 meses e cancelamento no fim do período;
- MFA TOTP opcional, com exigência configurável para operações sensíveis.

O estado de cobrança exibido é sincronizado pelos webhooks e lido localmente. A tela não depende de uma chamada ao Stripe a cada abertura. O cliente web usa cache curto, prefetch e cancelamento de chamadas antigas para navegação responsiva.

## 10. Administração e CRM

O administrador global usa a própria identidade e não herda acesso por domínio. O bootstrap inicial usa `ramos.lucas@aiolympian.com` por padrão; a permissão efetiva fica em `audit_admins`.

Administração:

- criar, ativar, pausar e desativar empresas;
- criar/reutilizar usuários e gerenciar vínculos e papéis;
- habilitar ou bloquear acesso ao portal;
- consultar atividade administrativa imutável;
- abrir a operação de qualquer empresa com aviso de modo administrativo;
- revisar a amostra de confiança;
- visualizar o funil comercial em português do Brasil.

Etapas do CRM:

1. Auditoria gratuita;
2. Follow-up D+1;
3. Follow-up D+3;
4. Follow-up D+5;
5. Follow-up D+10;
6. Follow-up D+30;
7. Teste de 7 dias;
8. Cliente ativo;
9. Churn.

O card reúne nome, empresa, e-mail, telefone, volume informado, UTMs, faturas analisadas, plano/período, status e último valor efetivamente pago. O card muda automaticamente quando um follow-up é enviado ou quando um webhook altera o ciclo da assinatura. Trial não é receita: o valor pago só aparece depois de `invoice.paid`.

## 11. Google Chat e observabilidade

Dois webhooks separados são obrigatórios em produção:

- **Leads:** novo lead, auditoria entregue, cada follow-up, início/fim de trial, novo cliente, cancelamento e mudança real de plano.
- **Erros:** falhas estruturadas com local legível, código estável, referência, etapa, status externo, tentativa e horário.

As mensagens comerciais incluem nome, empresa, e-mail, etapa e contexto aplicável. O canal de erro nunca recebe PDF, corpo bruto de webhook, credencial ou dado bancário. O envio ao Google Chat faz três tentativas curtas para erros temporários.

Todos os serviços também escrevem JSON correlacionado em stdout/stderr. Use `request_id`, `audit_request_id`, `job_id`, `event_id`, `delivery_id`, `settlement_id` ou `tenant_id` para localizar a operação completa.

## 12. Segurança e retenção

- RLS e consultas do servidor isolam todas as entidades por `tenant_id`.
- A service role nunca é entregue ao navegador.
- Webhooks Resend e Stripe têm assinatura verificada.
- Turnstile, Redis e chaves privadas limitam abuso.
- PDFs passam pelo scanner antes da extração.
- O bucket R2 não possui acesso público.
- Logs removem tokens, cookies, assinaturas, payloads e conteúdos sensíveis.
- Cancelamento definitivo programa eliminação operacional após 30 dias e mantém somente o mínimo anonimizado necessário para cobrança/auditoria da exclusão.
- Auditoria gratuita elimina documentos e perfil identificável depois de 30 dias.

O aceite implementado ajuda a formar uma trilha de clickwrap, mas os textos finais, jurisdição, renovação, cancelamento e privacidade devem ser revisados por advogado nos Estados Unidos antes da produção.
