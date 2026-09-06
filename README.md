# Freight Brokers — auditoria de faturas

Backend em TypeScript para processar um PDF por fatura, identificar inconsistências e gerar um relatório JSON. Ainda não há interface gráfica.

## Fluxo do produto definido

O cliente receberá um endereço exclusivo em `audit.aiolympian.com` e encaminhará ou copiará suas faturas para ele. A auditoria será automática, com relatório salvo no sistema e entregue por e-mail. O pagamento será via Stripe, com conta ativa, inativa ou pausada. O painel será complementar; upload manual não é o fluxo principal.

Recebimento, entrega por e-mail e Stripe ainda serão implementados. A estrutura de clientes está implementada e a migração foi aplicada manualmente no Supabase. O backend atual foi validado por comandos e faturas fictícias. Antes de receber clientes, precisamos separar o histórico e os dados por conta. Requisitos e sequência de implementação: [Fluxo por e-mail e assinaturas](docs/fluxo-email-assinaturas.md).

## Preparação

Use Node.js 22 ou posterior. Na pasta do projeto, rode `npm install` e copie `.env.example` para `.env`. Preencha localmente as credenciais; não as envie por chat nem as coloque no Git.

- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: acesso de backend ao PostgreSQL do Supabase. A chave anônima não é usada. Não exponha a chave de serviço em um navegador.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` e `R2_BUCKET_NAME`: bucket privado Cloudflare R2 usado para armazenar os PDFs recebidos. Use um token limitado ao bucket e nunca habilite acesso público.
- `DATABASE_URL`: conexão PostgreSQL, usada apenas para migração. O cliente `psql` precisa estar instalado.
- `OPENROUTER_API_KEY`: chave da sua conta OpenRouter com créditos.
- `OPENROUTER_MODEL`: identificador do modelo; inicialmente `google/gemini-2.5-flash`.
- `OPENROUTER_PDF_ENGINE`: `native` para leitura direta por um modelo compatível com PDF.
- `FMCSA_API_KEY`: WebKey do QCMobile.
- `EXTRACTOR_PROVIDER=openrouter` e `CARRIER_PROVIDER=fmcsa` para uso real.

Execute `npm run db:migrate` para aplicar o esquema e as migrações em uma transação. O script não remove tabelas ou dados. Habilita RLS nas tabelas do projeto e reserva a nova função de gravação para backend; se existirem outros clientes usando a chave anônima, reveja suas políticas antes da migração.

## Executar

```sh
npm run build
npm start -- invoices/fatura.pdf invoices/outra.pdf
```

O relatório JSON sai na saída padrão; mensagens operacionais saem na saída de erro. Para salvar um relatório, redirecione a saída padrão para um arquivo. Os relatórios contêm informações das faturas e devem ser tratados como dados privados.

`npm run dev -- invoices/fatura.pdf` compila antes de executar. `npm run typecheck` verifica os tipos e `npm test` executa a suíte.

## Simulação sem gravação

```sh
EXTRACTOR_PROVIDER=stub CARRIER_PROVIDER=stub npm start -- --dry-run invoices/fatura.pdf
```

O PDF precisa existir. A simulação usa valores fictícios, não lê seu conteúdo e não acessa o histórico. O relatório identifica a simulação. Provedores simulados não podem gravar auditorias pelo comando normal. Com provedores reais, `--dry-run` ainda chama os serviços externos e pode preencher o cache FMCSA, mas não grava faturas, alertas ou relatórios.

## Comportamento das correções

- Duplicidade exata considera MC, depois DOT, depois nome, além do número da fatura. Números vazios não são considerados duplicados. Quando a identificação disponível varia entre documentos, pode ser necessária conciliação manual.
- Duplicidades e divergências bancárias incluem o histórico; somente faturas novas aparecem nos alertas da execução atual.
- PDFs com o mesmo conteúdo são ignorados no mesmo lote e em reenvios, mesmo com nomes diferentes. Documentos anteriores à migração, sem hash, continuam no histórico, mas não podem ser deduplicados por conteúdo.
- A gravação de faturas, alertas e relatório usa uma única transação PostgreSQL. Uma falha não deixa parte da auditoria salva. Alterações concorrentes no conjunto de faturas fazem a gravação falhar e pedem uma nova execução.
- Campos críticos ou notas de confiança ausentes geram alerta. Datas devem ser ISO (`YYYY-MM-DD`); datas inválidas/ambíguas viram nulas e são sinalizadas quando extraídas.
- O cache distingue consultas FMCSA de registros antigos/simulados, e respeita a validade em memória e no banco.
- A autorização da transportadora é referente ao momento da consulta. O sistema não comprova a autorização na data histórica da carga.

## Leitura de PDFs pelo OpenRouter

OpenRouter é o provedor padrão. Não é necessário ter conta ou chave Azure nem chave direta do Gemini. A API usa a chave e os créditos da sua conta OpenRouter para acessar o modelo escolhido.

1. Na sua conta [OpenRouter](https://openrouter.ai/settings/keys), crie uma chave de API e confira o saldo de créditos.
2. Copie `.env.example` para `.env` e preencha `OPENROUTER_API_KEY` localmente. O `.env` está no `.gitignore`.
3. Mantenha inicialmente `OPENROUTER_MODEL=google/gemini-2.5-flash` e `OPENROUTER_PDF_ENGINE=native`.
4. Para trocar o modelo, altere `OPENROUTER_MODEL` para o identificador do catálogo OpenRouter e reinicie o comando. O modelo/provedor deve aceitar saída estruturada JSON Schema; com `native`, também precisa aceitar PDFs diretamente.

O aplicativo envia o PDF em base64 para `https://openrouter.ai/api/v1/chat/completions`. Os documentos são processados pelo OpenRouter e pelo provedor do modelo selecionado. A leitura consome créditos conforme modelo, tamanho e mecanismo de PDF; confira preços e políticas de dados da sua conta antes de usar documentos reais.

Para modelos sem suporte nativo a PDF, é possível configurar `mistral-ocr` ou `cloudflare-ai`. O mecanismo de OCR pode ter cobrança adicional. Não há troca automática de modelo ou mecanismo pelo aplicativo; uma incompatibilidade interrompe a extração. O roteamento entre provedores do mesmo modelo é gerenciado pelo OpenRouter.

A extração solicita número da fatura, transportadora, MC/DOT, datas, total, carga, origem/destino, dados bancários e adicionais. Campos ausentes, ambíguos ou ilegíveis devem ser nulos. Isso amplia os campos solicitados em relação à integração anterior, mas a precisão ainda precisa ser medida em PDFs reais.

O aplicativo valida o formato da resposta e rejeita resultados incompletos, recusas e contagens diferentes de uma fatura por PDF. A contagem depende da interpretação do modelo. Limite local: 20 MiB por PDF; prazo da requisição: 120 segundos. Não há repetição automática de chamadas cobradas.

As notas são conservadoras: 0 para campos ausentes e 0,5 para presentes, sem usar autoconfiança declarada pelo modelo. Com o limite padrão de 0,85, campos críticos geram revisão. Não reduza esse limite para tratar dados bancários como verificados. A extração registra modelo solicitado/retornado, identificador da chamada e necessidade de revisão; o relatório também avisa sobre essa necessidade.

O adaptador Azure permanece disponível apenas para compatibilidade: exige `EXTRACTOR_PROVIDER=azure` e as antigas variáveis `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` / `AZURE_DOCUMENT_INTELLIGENCE_KEY`. Não faz parte da configuração padrão.

O adaptador FMCSA consulta o endpoint real e interrompe a auditoria se a resposta não identificar uma transportadora única ou não fornecer os campos de autorização reconhecidos. Não converte erro de rede ou resposta desconhecida em autorização ativa/inativa. A compatibilidade com uma resposta real da conta ainda precisa ser validada.

## Validação antes de uso operacional

1. Configurar os serviços e aplicar a migração num ambiente de teste.
2. Separar alguns PDFs reais: fatura normal, duplicada, com alteração bancária e com campos ilegíveis.
3. Rodar os documentos e conferir cada campo/alerta contra os originais. Confira especialmente conta e routing number; a extração por IA exige revisão humana.
4. Reenviar o mesmo lote e confirmar ausência de novas faturas.
5. Conferir persistência e testar falha de gravação no banco de teste.

Os testes automatizados cobrem regras, datas, histórico, reenvios, falhas antes de gravar e contratos simulados de OpenRouter/Azure/FMCSA. Não substituem uma validação com serviços e documentos reais. A migração PostgreSQL não foi executada nesta sessão: o ambiente bloqueou a inicialização de um banco local e não havia conexão Supabase configurada.

Referências de integração:
- https://openrouter.ai/docs/guides/overview/multimodal/pdfs
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/how-to-guides/use-sdk-rest-api?view=doc-intel-4.0.0
- https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi

## Teste integrado com fatura fictícia (2026-09-05)

Documento: `output/pdf/TEST-FREIGHT-20260905-001.pdf`, claramente marcado como fictício e não pagável. OpenRouter leu total de USD 1.455,00, datas, rota e conta com zeros iniciais. Uma segunda extração confirmou a correção das instruções para separar frete básico de adicionais (combustível USD 180 e detention USD 75). Resultados em `output/test-extraction-verified.json`.

Supabase recebeu uma fatura de teste, um alerta LOW_CONFIDENCE esperado e um relatório. O reenvio processou zero novas faturas; relatórios em `output/test-audit.json` e `output/test-audit-reupload.json`. O registro fictício foi atualizado com a extração corrigida. Ele permanece no banco, identificado pelo número TEST-FREIGHT-20260905-001.

FMCSA foi verificada separadamente por consulta ao DOT 44110, exemplo da documentação oficial; a resposta foi aceita pelo adaptador. Esse identificador não foi colocado na fatura fictícia. A fatura sem MC/DOT não testa cruzamento de identidade/autoridade dentro da auditoria. PDFs reais e falhas transacionais continuam pendentes de validação. DATABASE_URL não foi usada neste teste; o Supabase foi acessado pela API.

## Lote fictício de problemas (2026-09-05)

Validação real via OpenRouter e Supabase concluída com três PDFs em `output/pdf/`:

- `test-duplicate.pdf`: mesmo número/transportadora da primeira fatura fictícia, conteúdo diferente. Gerou DUPLICATE_EXACT, BANKING_CHANGE e LOW_CONFIDENCE.
- `test-banking-change.pdf`: nova fatura da mesma transportadora com conta final 002. Gerou BANKING_CHANGE e LOW_CONFIDENCE. A divergência bancária sinaliza todos os documentos novos do grupo com contas diferentes, inclusive a cópia duplicada.
- `test-missing-fields.pdf`: número, total e dados bancários em branco. Gerou LOW_CONFIDENCE; não foram inventados valores. Os dados bancários retornaram como objeto com campos nulos, aceito pelo contrato.

Foram confirmados três registros novos, seis alertas e o relatório persistido. O reenvio ignorou os três PDFs sem processar novas faturas. Evidências: `output/test-cases-audit.json`, `output/test-cases-verification.json` e `output/test-cases-reupload.json`. Os registros fictícios permanecem no banco. Os documentos não possuem MC/DOT; este lote não valida cruzamento FMCSA nem qualidade em PDFs reais.

## Contas e isolamento (2026-09-06)

A migração `db/migrations/002_tenant_isolation.sql` cria empresas (`audit_tenants`), vínculos de usuários (`audit_memberships`) e contatos (`audit_report_contacts`). Aliases são exclusivos no domínio audit.aiolympian.com. Contatos novos não são considerados verificados; a confirmação por e-mail será implementada na integração Resend. `listReportRecipients` retorna somente contatos habilitados e verificados.

`createTenant`, `setTenantStatus` e `addReportContact` são funções administrativas de backend em `src/db/tenants.repo.ts`. Não são endpoints públicos. Contas nascem inativas; Stripe ainda não controla seu estado. RLS permite somente leitura por usuários vinculados à empresa. Cadastro, associação, verificação de contato e alteração de estado são exclusivos do backend.

As auditorias exigem `tenantId`, filtram histórico por conta e revalidam estado antes da extração e da gravação. A função SQL também bloqueia contas inativas/pausadas e referências a faturas de outra empresa. O mesmo PDF pode existir uma vez em cada conta; alertas não cruzam históricos. A chave service_role permanece administrativa e não deve ser exposta.

Os quatro documentos fictícios conhecidos serão vinculados à conta `00000000-0000-4000-8000-000000000001` (alias synthetic-tests); registros antigos desconhecidos ficam em uma conta separada inativa. Nenhum cliente novo herda esse histórico. A migração foi aplicada manualmente pelo usuário e conferida por leitura em 2026-09-06.

Após aplicar a migração, configure `AUDIT_TENANT_ID` no .env para usar o comando de auditoria com gravação. Não há cliente padrão implícito. O modo simulado --dry-run continua sem persistência.

O migrador agora registra arquivos já aplicados em audit_schema_migrations, evitando reaplicar o índice global anterior. `npm run db:migrate -- --check` valida em transação com rollback; `npm run db:migrate` aplica. Não rode novamente migrações antigas isoladas após a 002.

Validação: 108 testes automatizados e compilação aprovados; migração e testes de RLS/isolamento executados em PostgreSQL temporário local, com auth.uid e papéis equivalentes para teste. A validação local não substitui a aplicação e a conferência no Supabase. A execução automatizada da migração foi bloqueada pela revisão de permissões; depois, o usuário aplicou o SQL manualmente. A conferência remota confirmou conta de teste ativa, alias correto, quatro faturas, sete alertas e dois relatórios vinculados à conta. Não há destinatários verificados. Essa conferência foi feita pelo backend; os testes de RLS com usuários autenticados foram executados localmente.

## Backend de recebimento / EasyPanel

A entrada Resend e a fila de processamento estão implementadas, usando Cloudflare R2 privado para PDFs e Supabase para fila e metadados. Aguardam implantação em `api.audit.aiolympian.com` e migração 003 no Supabase. Guia completo: [EasyPanel, R2 e Resend](docs/easypanel-resend.md). Execute `npm run start:server` para o servidor; o comando `npm start` continua sendo a auditoria manual. `WORKER_ENABLED=false` aceita eventos sem iniciar extração paga.

Validação atual: 132 testes passaram. Entrega de relatório por e-mail, Stripe e interface continuam pendentes.
