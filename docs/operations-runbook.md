# Runbook operacional

Este guia explica como configurar, publicar, verificar e operar o Olympian Freight Audit. A [referência funcional](product-reference.md) descreve o comportamento para o cliente.

## 1. Componentes

| Componente | Responsabilidade |
| --- | --- |
| Servidor Node.js | Webhooks, páginas públicas, portal, APIs e endpoints internos. |
| Worker inbound | Processa e-mails pagos, documentos e auditorias. |
| Worker free audit | Processa auditorias gratuitas e follow-ups. |
| Worker notifications | Agenda e envia alertas imediatos, diários e mensais. |
| Worker billing | Processa Stripe, onboarding, excedentes, pausas, carência e exclusões. |
| Supabase/PostgreSQL | Estado transacional, RLS, filas, relatórios, CRM e trilhas. |
| Supabase Auth | Magic links, sessão e MFA TOTP. |
| Cloudflare R2 | Armazenamento privado de documentos. |
| Redis | Rate limiting compartilhado entre instâncias. |
| Resend | Recebimento e envio de e-mail. |
| OpenRouter | Classificação e extração estruturada dos documentos. |
| FMCSA | Identidade e autoridade atual da transportadora. |
| Stripe | Checkout, trial, assinatura, faturas e forma de pagamento. |
| Google Chat | Eventos do funil e erros operacionais em espaços separados. |
| PDF scanner | Rejeita documentos inseguros antes da leitura. |

Em uma única réplica, `npm run start:server` pode iniciar todos os workers quando `WORKER_ENABLED=true`. Ao escalar, mantenha web e workers em serviços separados para controlar concorrência e recursos.

## 2. Configuração

Copie `.env.example` para `.env` somente no ambiente local. Em produção, use o cofre de variáveis do EasyPanel. Nunca grave valores reais na documentação ou no repositório.

Defina `NODE_ENV=production` no serviço publicado. `AUDIT_TENANT_ID` é usado somente pela auditoria manual persistida; o fluxo por e-mail resolve a empresa pelo alias recebido.

### 2.1 Banco e armazenamento

| Variável | Uso |
| --- | --- |
| `SUPABASE_URL` | URL do projeto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Acesso exclusivo do backend e workers. |
| `SUPABASE_ANON_KEY` | Cliente Auth usado pelo backend para validar sessões; pode ser pública, mas não substitui RLS. |
| `DATABASE_URL` | Conexão usada pelo migrador. |
| `R2_ACCOUNT_ID` | Conta Cloudflare do bucket. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Token restrito ao bucket. |
| `R2_BUCKET_NAME` | Bucket privado de documentos. |

### 2.2 IA, documentos e transportadoras

| Variável | Uso e valor esperado |
| --- | --- |
| `EXTRACTOR_PROVIDER` | `openrouter` em produção. |
| `CARRIER_PROVIDER` | `fmcsa` em produção. |
| `OPENROUTER_API_KEY` | Chave de processamento. |
| `OPENROUTER_MODEL` | Modelo principal; padrão `google/gemini-2.5-flash`. |
| `OPENROUTER_ALLOWED_MODELS` | Allowlist separada por vírgulas; impede modelo inesperado. |
| `OPENROUTER_DATA_PROCESSING_ACK` | Deve ser `true` em produção após aprovação da política de dados. |
| `OPENROUTER_PDF_ENGINE` | `native` ou engine suportado pelo provedor. |
| `POD_OPENROUTER_MODEL` | Modelo opcional específico de POD. |
| `POD_SECONDARY_OPENROUTER_MODEL` | Segundo modelo opcional para consenso. |
| `RATE_CONFIRMATION_OPENROUTER_MODEL` | Modelo opcional de rate confirmation. |
| `POD_CONFIDENCE_THRESHOLD` | Padrão `0.90`. |
| `SUPPORTING_DOCUMENT_CONFIDENCE_THRESHOLD` | Padrão `0.90`. |
| `LOW_CONFIDENCE_THRESHOLD` | Compatibilidade com extrações antigas; padrão `0.85`. |
| `CONFIDENCE_VERIFIED_THRESHOLD` | Limiar verificável; padrão recomendado `0.92`. |
| `CONFIDENCE_QA_SAMPLE_RATE` | Amostra de QA; padrão recomendado `0.05`. |
| `FMCSA_API_KEY` | WebKey da FMCSA/QCMobile. |
| `FMCSA_BASE_URL` | Endpoint FMCSA; normalmente não alterar. |
| `CARRIER_CACHE_TTL_HOURS` | Cache da consulta; padrão 4 horas. |

Trocar modelo exige validar suporte a JSON Schema e, com `native`, leitura de PDF. Não diminua o limiar de confiança para ocultar revisão: calibre com documentos rotulados.

### 2.3 Resend, portal e páginas públicas

| Variável | Uso |
| --- | --- |
| `PORT` | Porta interna, padrão 3000. |
| `RESEND_API_KEY` | Leitura do inbound e envio de mensagens. |
| `RESEND_WEBHOOK_SECRET` | Segredo Svix do webhook `email.received`. |
| `RESEND_FROM_EMAIL` | Remetente verificado dos relatórios. |
| `PORTAL_URL` | Origem HTTPS exata do portal. |
| `FREE_AUDIT_ORIGIN` | Origem principal do formulário. |
| `FREE_AUDIT_ORIGINS` | Allowlist de origens exatas, separadas por vírgula. |
| `FREE_AUDIT_PUBLIC_URL` | Origem pública dos links de confirmação/resultado. |
| `FREE_AUDIT_OFFER_URL` | Página pública de preços/oferta. |
| `WORKER_ENABLED` | `true` habilita consumo das filas. |
| `ROSE_ROCKET_ENABLED` | `false` por padrão; não ativar sem cliente autorizado e migração 034. |
| `ROSE_ROCKET_CONNECT_ENABLED` | `false` por padrão; habilita somente o cadastro opcional no portal depois da migração 035. Não inicia sincronização. |
| `ROSE_ROCKET_CREDENTIAL_KEY` | Chave estável de 32 bytes em base64url para cifrar contas de serviço por empresa. Obrigatória quando o cadastro está habilitado; guardar e fazer backup no cofre de segredos. |
| `ROSE_ROCKET_ORG_ID` / `ROSE_ROCKET_USER_ID` | Identidade da organização e da conta de serviço Platform v2. |
| `ROSE_ROCKET_CLIENT_ID` / `ROSE_ROCKET_CLIENT_SECRET` | Credenciais OAuth da conta de serviço, somente no cofre de segredos. |
| `ROSE_ROCKET_WEBHOOK_TOKEN` | Segredo aleatório de 48–128 caracteres para a URL do webhook; não registrar em logs. |
| `ROSE_ROCKET_API_ORIGIN` | Opcional; origem HTTPS da organização em `*.roserocket.com` quando não for `network.roserocket.com`. |

No Supabase Auth, autorize `PORTAL_URL/auth/callback`, habilite e-mail passwordless e configure SMTP próprio. O template Magic Link deve usar `{{ .ConfirmationURL }}`.

### 2.4 Segurança e observabilidade

| Variável | Uso |
| --- | --- |
| `REDIS_URL` | Redis privado com TLS e autenticação. |
| `RATE_LIMIT_KEY_SECRET` | Segredo de pelo menos 32 caracteres para fingerprints. |
| `TRUST_PROXY` | `easypanel` para Traefik ou `cloudflare` atrás do proxy Cloudflare. |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Proteção dos formulários públicos. |
| `REQUIRE_MFA_SENSITIVE` | Exige AAL2 em ações sensíveis quando `true`. |
| `PDF_SCAN_URL` | URL interna do scanner. |
| `PDF_SCAN_TOKEN` | Segredo de pelo menos 32 caracteres. |
| `METRICS_TOKEN` | Bearer token de `/internal/metrics`. |
| `CSRF_SECRET` | Segredo de pelo menos 32 caracteres. |
| `GOOGLE_CHAT_LEADS_WEBHOOK_URL` | Espaço comercial. |
| `GOOGLE_CHAT_ERRORS_WEBHOOK_URL` | Espaço de erros. |

O servidor de produção recusa inicialização quando uma dessas dependências obrigatórias está ausente ou inválida. Os dois webhooks do Google Chat devem apontar para espaços diferentes.

### 2.5 Stripe

| Variável | Uso |
| --- | --- |
| `STRIPE_SECRET_KEY` | Chave secreta do mesmo modo dos preços. |
| `STRIPE_WEBHOOK_SECRET` | Segredo do endpoint `/webhooks/stripe`. |
| `STRIPE_PRICE_{PLAN}_{PERIOD}` | Nove Price IDs: 3 planos × 3 períodos. |
| `STRIPE_RETENTION_COUPON_ID` | Cupom de 15%, duração `once`. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Configuração dedicada do Customer Portal. |

Os nove Payment Links em `src/billing/plans.ts` apontam para produção. Antes de publicar o código e aceitar o primeiro cliente real, confira na Stripe (modo produção) que cada link corresponde ao plano, período, preço, moeda, recorrência, teste grátis e URL de retorno esperados. Configure os nove Price IDs, a chave secreta, o webhook, o cupom de retenção e o Customer Portal no mesmo modo de produção; recursos de teste não funcionam com IDs de produção.

## 3. Endpoints

### 3.1 Públicos

| Método e rota | Função |
| --- | --- |
| `POST /webhooks/resend` | Recebe evento assinado de e-mail. |
| `POST /webhooks/stripe` | Recebe evento assinado de cobrança. |
| `POST /webhooks/free-audit` | Recebe formulário da auditoria gratuita. |
| `POST /webhooks/rose-rocket/<token>` | Desativado por padrão; recebe evento de pedido e o coloca na fila de descoberta, sem auditar ou escrever no TMS. |
| `POST /checkout` | Cria checkout público validado por Turnstile. |
| `GET /free-audit/verify` | Confirma e-mail e enfileira auditoria. |
| `GET/POST /free-audit/retry` | Substitui arquivos de um pedido que falhou. |
| `GET /free-audit/result` | Mostra resultado privado. |
| `POST /free-audit/result/continue` | Registra avanço para a oferta. |
| `POST /free-audit/result/checkout` | Abre checkout a partir do resultado. |
| `GET /free-audit/unsubscribe` | Cancela follow-ups do lead. |
| `POST /api/support` | Responde dúvidas não sensíveis na página do resultado. |
| `GET /terms` / `GET /privacy` | Documentos legais atuais. |

### 3.2 Saúde e métricas

| Rota | Uso |
| --- | --- |
| `GET /healthz` | Processo HTTP está vivo. |
| `GET /readyz` | Banco/fila estão acessíveis. |
| `GET /internal/metrics` | Métricas com bearer token; não publicar sem proteção. |

### 3.3 Portal

As APIs sob `/api/portal/` cobrem login, sessão, logout, aceite legal, guia, MFA, onboarding, configurações, cobrança, jobs, exceções e administração. Todas as mutações exigem CSRF, limite de taxa e autorização por usuário/empresa. Consulte [portal do cliente](customer-portal.md).

## 4. Migrações

Execute todos os arquivos em ordem. O resumo abaixo ajuda a identificar pré-requisitos; não substitui a leitura do SQL em revisão.

| Migração | Entrega principal |
| --- | --- |
| 001–002 | Auditoria atômica, empresas e isolamento. |
| 003 | Fila de e-mail e anexos inbound. |
| 004–005 | Portal, revisões e administração global. |
| 006–010 | Stripe, onboarding, notificações, lifecycle, segurança, preços e uso. |
| 011–013 | Lead gratuito, recuperação e retry seguro. |
| 014–015 | Três planos e conciliação de documentos. |
| 016–017 | Resultado/follow-ups e permissões de onboarding. |
| 018–022 | Trial, vínculo invoice/subscription, MFA, guia e leitura da fila. |
| 023–025 | Confiança verificável, resiliência e alerta de autoridade. |
| 026–028 | Recuperação de convite, aceite antigo e deduplicação de alertas. |
| 029–030 | CRM e replay isolado de follow-ups. |
| 031 | Aceite legal obrigatório no portal. |
| 032 | Índices para leitura rápida do portal. |

Procedimento:

```sh
npm run db:migrate -- --check
npm run db:migrate
```

Faça backup antes de produção. Não edite uma migração já aplicada; crie a próxima. Mudanças de billing, RLS e exclusão exigem revisão adicional.

## 5. Deploy no EasyPanel

1. Execute testes e build com Node 24.
2. Confirme que todas as migrações foram aplicadas.
3. Configure o R2 privado e o scanner na rede interna.
4. Configure Redis privado.
5. Cadastre os webhooks Resend e Stripe com segredos distintos.
6. Configure todas as variáveis no EasyPanel.
7. Publique uma réplica com `WORKER_ENABLED=false`.
8. Verifique `/healthz`, `/readyz` e os logs de configuração.
9. Faça smoke tests de portal e endpoints públicos.
10. Altere para `WORKER_ENABLED=true` e reinicie.
11. Observe idade das filas, erros e consumo dos provedores.

### Piloto Rose Rocket, ainda desativado

A migração 034 cria `audit_rose_connections` e `audit_rose_events`, mas não cadastra nem habilita nenhuma organização. A 035 acrescenta cadastro opcional de conta de serviço pelo proprietário/administrador de cobrança no portal, cifrado com `ROSE_ROCKET_CREDENTIAL_KEY`; `ROSE_ROCKET_CONNECT_ENABLED=false` mantém essa tela desabilitada. A verificação da conta deixa a associação `pending` e `enabled=false`. Mesmo com `ROSE_ROCKET_ENABLED=true`, o banco ignora eventos de organizações sem associação habilitada a uma empresa ativa. A fila deduplica por organização e evento; o worker atual ainda usa uma única conta configurada no servidor, só busca metadados do pedido e marca `discovered`, sem baixar/analisar PDFs nem devolver status ao TMS. Consulte [o guia do piloto](rose-rocket-pilot.md) antes de qualquer ativação.

O webhook Platform v2 não documenta assinatura de entrega. O token na URL é um segredo portador: redija-o nos logs do proxy/CDN, restrinja acesso ao endpoint e valide a configuração com o cliente. Para desativar ou reverter a ativação, defina `ROSE_ROCKET_ENABLED=false` e `enabled=false` na associação específica; mantenha os dados da fila para auditoria e não reverta a migração por exclusão de tabelas. A implantação sem cliente deve manter `ROSE_ROCKET_ENABLED=false`.

O container deve executar como usuário sem privilégios, root filesystem somente leitura, `/tmp` em memória, capabilities removidas e sem porta pública para Redis ou scanner. Veja [segurança de produção](security-production.md).

## 6. Rotinas automáticas

| Rotina | Frequência aproximada | Trabalho por ciclo |
| --- | ---: | --- |
| Inbound | 3 segundos | Reivindica um e-mail e processa seus PDFs. |
| Free audit | 10 segundos | Até 3 auditorias e 5 follow-ups. |
| Notificações | 60 segundos | Agenda entregas e envia até 25 mensagens. |
| Billing | 60 segundos | Até 10 convites, 25 eventos Stripe, uma liquidação de uso, retenção e uma exclusão. |

Filas usam bloqueio de linha e `SKIP LOCKED`, permitindo múltiplos workers sem processar o mesmo item. Itens interrompidos voltam à fila depois do timeout definido na migração.

## 7. Cobrança de excedente

O uso fecha depois do fim do mês no fuso configurado da empresa. O banco cria uma liquidação com:

```text
excedente = max(0, faturas_aceitas - franquia)
valor = excedente × preço_unitário
```

Exemplo Growth com 2.000 faturas: 1.500 incluídas, 500 excedentes × US$ 0,50 = **US$ 250,00**, além da assinatura-base do período. O worker cria um invoice item idempotente e uma fatura Stripe usando o método salvo. Em falha, tenta novamente com backoff, até 12 tentativas.

Verifique no Stripe e no banco que `usage_month`, `usage_count`, `overage_count`, `amount_cents`, `stripe_invoice_id` e `status` estão corretos. Nunca altere manualmente o uso sem registrar justificativa e trilha.

## 8. Checklist de homologação

### 8.1 Auditoria e confiança

- invoice normal sem falso positivo;
- duplicidade exata dentro do lote e contra histórico;
- provável duplicidade com e sem vínculo forte de carga;
- mudança bancária contra baseline verificável;
- MC/DOT válido, divergente, inativo e não encontrado;
- campo ausente, ambíguo, ilegível e formato inválido;
- rate confirmation correspondente e divergente;
- accessorial autorizado, excedente, ausente e não realizado;
- POD claro, degradado, sem assinatura e com dois modelos discordando;
- conferência da amostra de QA e da taxa de automação.

### 8.2 E-mail e relatórios

- webhook assinado e assinatura inválida;
- remetente permitido, não permitido e resposta automática;
- um e-mail com vários anexos e anexos repetidos;
- alerta imediato, relatório diário vazio/com riscos e relatório mensal;
- PDF visual, CSV completo, links e destinatários confirmados;
- falha temporária do provedor, retry automático e esgotamento para revisão.

### 8.3 Cliente e cobrança

- checkout de cada plano/período em test mode;
- início e encerramento do trial;
- onboarding idempotente e reenvio do convite;
- magic link com sessão existente e nova aba;
- aceite legal antes do guia e novo aceite por nova versão;
- atualização de destinatários/remetentes e limites por plano;
- invoice paga, falha, carência, suspensão e reativação;
- excedente com volume abaixo, igual e acima da franquia;
- desconto, pausa, cancelamento e exclusão após 30 dias.

### 8.4 Administração e alertas internos

- acesso admin apenas para usuário cadastrado em `audit_admins`;
- CRM avançando em cada follow-up e evento Stripe;
- nome, empresa, UTMs e valor pago no card;
- mensagem legível no canal comercial para cada etapa;
- mensagem sanitizada no canal de erro para falhas controladas;
- busca do mesmo erro no Better Stack pela referência.

## 9. Diagnóstico

### Job parado em `queued`

1. confirme `WORKER_ENABLED=true`;
2. verifique `/readyz` e conexão com o Supabase;
3. procure `inbound.worker.tick_failed` ou `free_audit.worker.tick_failed`;
4. confira `next_attempt_at`, `attempts` e idade da fila;
5. confirme créditos/chaves de OpenRouter, Resend e FMCSA.

### Job em `needs_review`

Leia `error_code`, `stage` e as tentativas. Não reenvie repetidamente um documento inválido. Erro de rede/provedor deve ter passado pelos retries de 1, 5 e 15 minutos; falha de formato exige substituir o arquivo.

### Portal mostra zero registros ou erro após atualizar

Procure `portal.request.failed` pelo `X-Request-Id`. Confirme migrações, RLS, vínculo em `audit_memberships` e campos nulos de jobs antigos. Não consulte Stripe para diagnosticar listagem: as configurações usam estado local sincronizado.

### Checkout não abre

Confirme origem permitida, Turnstile, rate limiting, Price IDs, chave Stripe e modo consistente. Procure `checkout.public.failed` ou `free_audit.checkout.failed` no canal de erros e nos logs.

### Onboarding não chegou

Confirme `checkout.session.completed`, a linha na fila de convites, `RESEND_FROM_EMAIL` e os eventos `stripe.onboarding_email.*`. O worker recupera convites antigos sem workspace e usa idempotência pela Checkout Session.

### Google Chat não recebe mensagens

Confirme os dois webhooks, acesso dos apps aos espaços e resposta HTTP. O servidor não inicia em produção sem as URLs. Procure `google_chat.lead_notification.failed`; não coloque a URL real em ticket ou log.

### Stripe envia eventos duplicados ou fora de ordem

Isso é esperado. O banco deduplica por Event ID e compara o timestamp do evento antes de alterar a assinatura. Use o Event ID como referência e não repita efeitos manualmente.

## 10. Observabilidade e resposta a incidentes

Todo erro deve ser localizável por uma referência segura. O fluxo de resposta é:

1. copiar a referência do Google Chat ou `X-Request-Id`;
2. buscar no Better Stack;
3. identificar `event`, `stage`, `error_code`, `attempt` e `upstream_status`;
4. confirmar se existe retry agendado antes de intervir;
5. corrigir dependência/configuração ou orientar substituição do documento;
6. validar recuperação e registrar a ação sem dados sensíveis.

Alertas mínimos: exceções não tratadas, falhas de webhook, idade de fila, notificações esgotadas, falha de excedente, falha de exclusão, divergência Stripe/local, bounces/spam do Resend, gasto OpenRouter e erros do scanner.

## 11. Comandos úteis

```sh
npm run typecheck
npm test
npm run build
npm run db:migrate -- --check
node scripts/check-db-isolated.cjs
node scripts/preview-portal.cjs
node scripts/preview-portal.cjs --admin
```

As prévias usam dados em memória e escutam somente em loopback: cliente em `http://127.0.0.1:3101` e admin em `http://127.0.0.1:3102`. Elas não enviam e-mail, não cobram e não acessam dados reais.

## 12. Critério para começar a receber clientes

Não basta o CI ficar verde. O lançamento exige:

- todas as migrações aplicadas e restore de backup testado;
- Payment Links e Price IDs de produção revisados;
- termos e privacidade revisados por advogado;
- domínio, SPF, DKIM, DMARC e bounces do e-mail validados;
- conjunto rotulado de documentos reais com métricas por regra/campo;
- zero falso automático crítico no critério acordado;
- suporte e resposta a incidentes definidos;
- teste de ponta a ponta de aquisição, trial, primeiro pagamento, excedente e cancelamento;
- teste de segurança independente antes de clientes maiores.
