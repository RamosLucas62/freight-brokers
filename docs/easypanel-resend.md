# Implantação do backend no EasyPanel com Cloudflare R2

Backend preparado para `https://api.audit.aiolympian.com`. Este guia publica o recebimento, a auditoria dos anexos e o envio automático de relatórios pelo Resend. Stripe e painel são descritos em `customer-portal.md`.

## 1. Preparar o banco

Com as migrações 001 e 002 já aplicadas, execute **somente** o arquivo `db/migrations/003_inbound_queue.sql` completo no SQL Editor do Supabase. Ele cria a fila e os registros de metadados dos anexos. Os PDFs ficam no Cloudflare R2, não no Supabase Storage. Não altera as tabelas de CRM. Não execute novamente a migração 001 isolada: ela recria o índice global de hashes anterior ao isolamento por cliente.

## 2. Criar o bucket privado no R2

No Cloudflare R2, crie um bucket privado, por exemplo `freight-audit-invoices`. Não habilite domínio público nem `r2.dev`. Crie um token de API com permissão **Object Read & Write** limitada somente a esse bucket e anote o Account ID, Access Key ID e Secret Access Key.

## 3. Criar o serviço

No EasyPanel, crie um projeto (por exemplo `freight-audit`) e um serviço **App** (por exemplo `backend`). Em **Source → Upload**, envie `freight-audit-easypanel.tar.gz`. O pacote contém o código e Dockerfile na raiz, sem .env ou credenciais. Se a sua versão pedir ZIP, use o pacote `.zip` equivalente.

Escolha o build por **Dockerfile**, caminho `Dockerfile`, contexto raiz. O comando de inicialização já está definido na imagem. Mantenha inicialmente uma réplica. Não configure portas TCP públicas adicionais: o domínio será encaminhado pelo proxy do EasyPanel à porta interna 3000.

Os documentos ficam no Cloudflare R2 e os trabalhos/metadados no PostgreSQL do Supabase; não é necessário volume para os PDFs temporários. A imagem roda como usuário sem privilégios e não executa migrações automaticamente. Faça o build e inspecione os logs de implantação.

## 4. Domínio

Na Cloudflare, zona `aiolympian.com`, adicione um registro **A**, nome **api.audit**, apontando para o IP público da mesma VPS do EasyPanel. Use **DNS only** inicialmente. Preserve o MX de `audit` e os registros do Google Workspace.

No serviço do EasyPanel, em **Domains**, configure:

- Host: `api.audit.aiolympian.com`
- Caminho: `/`
- Protocolo interno: `HTTP`
- Porta de destino: `3000`
- HTTPS/certificado automático: habilitado

O aplicativo escuta em `0.0.0.0:3000`; o TLS termina no proxy do EasyPanel.

## 5. Webhook Resend e variáveis

No Resend → Webhooks → Add Webhook, cadastre:

`https://api.audit.aiolympian.com/webhooks/resend`

Para o envio dos relatórios, configure também `RESEND_FROM_EMAIL` com um remetente do domínio verificado no Resend, por exemplo `reports@audit.aiolympian.com`. O mesmo `RESEND_API_KEY` é usado para receber anexos e enviar alertas.

Selecione somente **email.received**. Copie o **Signing secret** desse webhook para `RESEND_WEBHOOK_SECRET`. Ele não é a chave de API.

No Resend → API Keys, use uma chave com acesso de leitura aos e-mails recebidos/anexos (uma chave limitada apenas a envio não atende). Coloque-a em `RESEND_API_KEY`. Não envie chaves pelo chat nem as coloque no pacote de upload.

No EasyPanel → Environment, configure usando os valores do seu .env local:

```dotenv
NODE_ENV=production
PORT=3000
SUPABASE_URL=URL_DO_SEU_PROJETO
SUPABASE_SERVICE_ROLE_KEY=CHAVE_DE_BACKEND
R2_ACCOUNT_ID=ID_DA_CONTA_CLOUDFLARE
R2_ACCESS_KEY_ID=ACCESS_KEY_DO_TOKEN_R2
R2_SECRET_ACCESS_KEY=SECRET_KEY_DO_TOKEN_R2
R2_BUCKET_NAME=freight-audit-invoices
EXTRACTOR_PROVIDER=openrouter
CARRIER_PROVIDER=fmcsa
OPENROUTER_API_KEY=CHAVE_OPENROUTER
OPENROUTER_MODEL=google/gemini-2.5-flash
OPENROUTER_PDF_ENGINE=native
FMCSA_API_KEY=WEBKEY_FMCSA
FMCSA_BASE_URL=https://mobile.fmcsa.dot.gov/qc/services
CARRIER_CACHE_TTL_HOURS=4
LOW_CONFIDENCE_THRESHOLD=0.85
STRIPE_PRICE_CORE_MONTHLY=price_...
STRIPE_PRICE_CORE_SEMIANNUAL=price_...
STRIPE_PRICE_CORE_ANNUAL=price_...
STRIPE_PRICE_GROWTH_MONTHLY=price_...
STRIPE_PRICE_GROWTH_SEMIANNUAL=price_...
STRIPE_PRICE_GROWTH_ANNUAL=price_...
STRIPE_PRICE_SCALE_MONTHLY=price_...
STRIPE_PRICE_SCALE_SEMIANNUAL=price_...
STRIPE_PRICE_SCALE_ANNUAL=price_...
RESEND_API_KEY=CHAVE_RESEND
RESEND_WEBHOOK_SECRET=SEGREDO_DO_WEBHOOK
RESEND_FROM_EMAIL=reports@audit.aiolympian.com
PORTAL_URL=https://portal.audit.aiolympian.com
WORKER_ENABLED=false
TRUST_PROXY=easypanel
```

`DATABASE_URL` não é usada pelo servidor, e `AUDIT_TENANT_ID` é exclusivo do comando manual. No fluxo de e-mail, a conta vem do destinatário cadastrado. Nenhum tenant padrão é aplicado ao catch-all.

Selecione **Deploy**. Se o webhook for criado antes da aplicação estar disponível, suas tentativas podem falhar até o deploy terminar; confira/reenvie pelo painel Resend após a aplicação estar pronta.

## 6. Validar antes de ativar processamento

1. Abra `https://api.audit.aiolympian.com/healthz`: deve responder `{"status":"ok"}`.
2. Abra `/readyz`: deve responder `{"status":"ready"}`. Isso verifica acesso à tabela da fila; não comprova validade das chaves OpenRouter, FMCSA ou Resend.
3. Envie um PDF fictício para **synthetic-tests@audit.aiolympian.com**. Esse é o alias da conta de teste existente. `teste@audit.aiolympian.com` chega ao catch-all, mas não corresponde automaticamente a um cliente cadastrado.
4. No Resend, confirme entrega do webhook com HTTP 200; no Supabase, veja a linha em `audit_inbound_jobs` como `queued`.
5. Mude `WORKER_ENABLED=true` no EasyPanel e faça novo deploy. A fila passará a consumir créditos OpenRouter para PDFs novos.
6. Confirme `completed` e o relatório em `result`. Confira também `audit_runs` para auditorias que incluíram faturas novas. PDFs idênticos aos testes já salvos serão ignorados por conteúdo, sem nova chamada de extração.
7. Reenvie o evento pelo Resend: não deve criar outro trabalho para o mesmo e-mail e cliente. Teste um novo e-mail em cópia e cópia oculta para validar o payload real da conta antes de liberar clientes.

O Resend fornece os destinatários `to`, `cc` e `bcc`; o roteamento usa esses campos do evento assinado, com domínio exato e aliases cadastrados. `received_for` não é usado como fonte independente, pois é derivado de cabeçalhos Received. Formatos de encaminhamento que não preservem o alias nesses campos precisam de validação/adaptação; não prometer roteamento para um destinatário ausente do evento.

## Comportamento e operação

- A assinatura Svix é verificada sobre o corpo original, com validação de tempo. Payload máximo: 256 KiB. Falha de persistência retorna 503 para o Resend tentar novamente.
- Evento e trabalhos são criados numa transação. Há unicidade por evento e por cliente/e-mail. Endereços desconhecidos ficam registrados com zero contas correspondentes e não geram extração.
- Contas inativas ou pausadas recebem trabalhos `blocked`, sem chamadas pagas. Reativar a conta não reprocessa automaticamente mensagens antigas.
- Até 10 anexos por mensagem, 20 MiB por PDF e 50 MiB de PDFs por e-mail. Não-PDFs são ignorados com aviso; um PDF inválido interrompe o lote. Não há auditoria parcial neste lançamento.
- Os downloads são obtidos pela API autenticada do Resend, limitados ao host `inbound-cdn.resend.com`, sem redirects nem envio de credenciais ao CDN. Se o Resend mudar o host, o trabalho exige revisão em vez de aceitar uma URL arbitrária.
- PDFs são salvos no bucket privado do Cloudflare R2 antes da extração, sob `invoices/<tenant>/<job>/<attachment>.pdf`. O arquivo temporário usa UUID, nunca o nome recebido como caminho. A extração e o caminho do objeto são armazenados no Supabase por anexo para investigação e retomada controlada.
- Respostas automáticas (`Auto-Submitted: auto-replied`) são ignoradas. E-mails de faturas gerados por sistemas (`auto-generated`) podem ser processados.
- `needs_review` indica uma falha permanente ou uma falha temporária que continuou após as retentativas automáticas. Falhas transitórias de OpenRouter e FMCSA são repetidas após 1, 5 e 15 minutos; extrações e anexos já persistidos são reutilizados. Trabalhos `processing` interrompidos por reinício há mais de 20 minutos voltam automaticamente para a fila enquanto ainda houver tentativas.
- Uma resposta FMCSA ausente, ambígua ou insuficiente não interrompe o lote: a auditoria termina com a exceção `CARRIER_VERIFICATION_REQUIRED`, exibida como validação da identidade da transportadora e nunca como acusação de autoridade inativa.
- Para retomar um trabalho, primeiro pare o worker, confira o relatório pelo run_id igual ao ID do trabalho e o cache dos anexos. Só então um administrador pode recolocá-lo em `queued`. Se já existir relatório, o worker recupera-o sem reauditar. Nunca reencaminhe artificialmente como novo trabalho para contornar falhas.
- Falhas de atualização da fila são registradas nos logs sem corpo do e-mail, anexos ou chaves. Não há endpoint público de administração ou consulta aos relatórios.
- A retenção/limpeza automática e a notificação operacional de falhas ainda precisam ser implementadas. Monitore `blocked`, `needs_review` e `processing` parados antes de atender clientes.
- **Esta versão não envia o relatório por e-mail.** Entrega aos contatos verificados e controle Stripe são as próximas integrações.

## Validação realizada

132 testes automatizados aprovados, incluindo o armazenamento R2, além da compilação TypeScript e do carregamento do servidor compilado. PostgreSQL local validou migração, idempotência da fila, bloqueio de conta pausada e permissões. Docker não está instalado no ambiente de desenvolvimento; a imagem deve ser construída e conferida no EasyPanel. Nenhum acesso à VPS, alteração de DNS, aplicação da migração 003 no Supabase, envio de e-mail ou consumo de créditos foi feito nesta etapa.

## Fontes

- EasyPanel App: https://easypanel.io/docs/services/app
- Evento recebido: https://resend.com/docs/webhooks/emails/received
- Assinaturas: https://resend.com/docs/webhooks/verify-webhooks-requests
- Anexos: https://resend.com/docs/api-reference/emails/list-received-email-attachments
