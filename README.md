# Olympian Freight Audit

Plataforma multiempresa para receber documentos de frete, auditar faturas, entregar alertas e relatórios e acompanhar clientes desde a auditoria gratuita até a assinatura.

## O que está implementado

- recebimento de faturas por e-mail com Resend, fila durável no PostgreSQL e arquivos privados no Cloudflare R2;
- leitura estruturada por OpenRouter, validação de transportadora pela FMCSA e motor determinístico de confiança;
- detecção de duplicidades, mudança bancária, divergência de transportadora, autoridade inativa e problemas de evidência;
- classificação e conciliação de invoice, rate confirmation e POD por load number;
- alertas imediatos, resumo diário, fechamento mensal e anexos PDF/CSV;
- auditoria gratuita com confirmação de e-mail, resultado privado, cinco follow-ups e oferta de planos;
- Stripe Checkout, teste de 7 dias, assinatura, cobrança de excedentes, retenção, pausa e cancelamento;
- portal do cliente com login por magic link, aceite contratual, onboarding, configurações, revisão e histórico;
- administração global em português e CRM automático do funil comercial;
- base desativada para piloto Rose Rocket Platform v2 (leitura, fila idempotente e descoberta de eventos; sem cliente conectado, auditoria automática ou escrita no TMS);
- notificações comerciais e operacionais em canais separados do Google Chat;
- isolamento por empresa, RLS, rate limiting, Turnstile, scanner privado de PDF, logs estruturados e métricas.

## Documentação

Comece pelo [índice da documentação](docs/README.md).

- [Referência funcional do produto](docs/product-reference.md): o que cada recurso faz e como os fluxos se conectam.
- [Operação e implantação](docs/operations-runbook.md): configuração, workers, migrações, deploy, testes e diagnóstico.
- [Preços e cobrança por uso](docs/pricing-and-usage.md): planos, contagem de faturas e excedentes.
- [Confiança verificável](docs/verifiable-confidence.md): evidências, estados, amostragem e calibração.
- [Portal do cliente e administração](docs/customer-portal.md): autenticação, onboarding, permissões e CRM.
- [Segurança de produção](docs/security-production.md): controles obrigatórios e gate de lançamento.
- [Piloto Rose Rocket](docs/rose-rocket-pilot.md): capacidades preparadas, limites da API e etapas para ativar com um cliente autorizado.

## Requisitos locais

- Node.js 24;
- npm;
- PostgreSQL/`psql` para executar ou validar migrações;
- credenciais dos provedores descritas em `.env.example`.

Nunca envie `.env`, chaves, webhooks ou documentos de clientes ao Git. O arquivo `.env.example` contém apenas nomes e exemplos não funcionais.

## Início rápido

```sh
npm install
cp .env.example .env
npm run build
npm test
```

Para executar a auditoria manual:

```sh
npm start -- invoices/fatura.pdf
```

Para simular sem gravar e sem chamar provedores reais:

```sh
EXTRACTOR_PROVIDER=stub CARRIER_PROVIDER=stub npm start -- --dry-run invoices/fatura.pdf
```

Para iniciar o servidor HTTP, portal e workers:

```sh
npm run build
npm run start:server
```

Em produção, o servidor valida todas as variáveis obrigatórias e encerra imediatamente se a configuração estiver incompleta. `WORKER_ENABLED=false` mantém os endpoints ativos sem consumir as filas; use `true` somente depois de aplicar todas as migrações e validar os provedores.

## Banco de dados

As migrações ficam em `db/migrations/` e devem ser aplicadas em ordem numérica:

```sh
npm run db:migrate -- --check
npm run db:migrate
```

`--check` executa tudo em uma transação com rollback. O migrador registra arquivos aplicados em `audit_schema_migrations`; não execute novamente uma migração antiga isoladamente.

## Verificação antes de publicar

```sh
npm run typecheck
npm test
npm run build
node scripts/check-db-isolated.cjs
```

Além da automação, valide em homologação: Resend inbound/outbound, PDFs reais rotulados, FMCSA, R2, scanner de PDF, Stripe em modo de teste, magic link, aceite legal, relatórios, Google Chat e cobrança de excedente. O checklist completo está no [runbook operacional](docs/operations-runbook.md).

## Princípios do produto

- Conteúdo de documentos é evidência não confiável; nunca é tratado como instrução.
- O modelo extrai dados, mas não decide sozinho se eles são verdadeiros.
- Incerteza não vira acusação: campos ausentes ou ambíguos ficam como `unverifiable` ou `review`.
- Uma falha temporária é tentada novamente automaticamente antes de exigir trabalho humano.
- Apenas faturas aceitas e deduplicadas contam para uso; PODs e rate confirmations não contam.
- “Perda evitada” só existe depois da confirmação explícita do cliente.
- Toda consulta operacional é isolada por empresa e todo efeito financeiro é idempotente.
