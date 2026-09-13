# Painel do cliente

O servidor existente serve o painel em `/`, sem serviço de frontend separado. O Dockerfile inclui os arquivos de `public/`.

## Ativação

1. Aplicar as migrações com `npm run db:migrate`. A migração 004 cria as revisões; a 005 adiciona administradores globais, controle de acesso e histórico administrativo.
2. Configurar `PORTAL_URL` com a origem pública exata (exemplo: `https://painel.suaempresa.com`) e `SUPABASE_ANON_KEY` com a chave pública do mesmo projeto Supabase. A chave de serviço permanece exclusivamente no servidor.
3. No Supabase Auth, habilitar login por e-mail, configurar SMTP para entrega aos clientes e adicionar `PORTAL_URL/auth/callback` à lista de Redirect URLs. O template Magic Link deve usar `{{ .ConfirmationURL }}`. Referência: https://supabase.com/docs/guides/auth/auth-email-passwordless
4. Criar `ramos.lucas@aiolympian.com` no Supabase Auth e executar `node scripts/bootstrap-admin.cjs` com o ambiente de backend configurado. Esse é o e-mail administrativo padrão do utilitário; ainda é possível informar outro e-mail como argumento quando necessário. O comando atribui o primeiro administrador somente se nenhum administrador existir. Em seguida, o proprietário pode cadastrar clientes e usuários pelo painel. Não há promoção automática por domínio de e-mail.
5. Executar `npm run build` e `npm run start:server`, ou reconstruir a imagem Docker. Habilitar `WORKER_ENABLED=true` no serviço responsável pela fila para processar reenvios.

## Assinatura e onboarding

A contratação começa no resultado privado da auditoria gratuita, onde o cliente escolhe plano e período e abre o Stripe Payment Link correspondente. O portal é exclusivo para login e onboarding; não exibe planos. Após o Checkout ser concluído, o webhook cria uma entrega idempotente de boas-vindas. O e-mail contém um botão para `/onboarding?session_id=...`; o backend consulta novamente a sessão e a assinatura na Stripe antes de criar qualquer empresa ativa.

Configure também `STRIPE_RETENTION_COUPON_ID` com um cupom Stripe de **15% e duração `once`** e `STRIPE_PORTAL_CONFIGURATION_ID` com uma configuração dedicada do Customer Portal. Nessa configuração, habilite troca de forma de pagamento e histórico de faturas, mas deixe o cancelamento de assinatura desabilitado: o cancelamento deve passar pelo fluxo de retenção do próprio portal.

No endpoint Stripe `/webhooks/stripe`, assine pelo menos `checkout.session.completed`, `invoice.payment_failed`, `invoice.paid`, `customer.subscription.updated` e `customer.subscription.deleted`. Falha de pagamento inicia três dias de carência e depois pausa o processamento; pagamento confirmado reativa; assinatura encerrada inativa a conta e agenda a eliminação dos dados operacionais após 30 dias.

Convites de onboarding usam uma fila própria e são enviados pelo worker com chave idempotente baseada na Checkout Session. Entregas interrompidas ou indisponibilidade temporária do provedor são retomadas com backoff. A migration 019 também inclui checkouts anteriores que ainda não possuem workspace, evitando que uma compra confirmada antes do deploy fique sem convite.

Em **Settings & billing**, o responsável financeiro pode abrir o Customer Portal, receber o desconto único, pausar por 30 dias (uma vez a cada 12 meses) ou agendar o cancelamento para o fim do período pago. A exclusão definitiva remove PDFs do R2, faturas, exceções, relatórios, destinatários e acessos; permanece apenas um registro mínimo anonimizado de cobrança e da execução da exclusão.

No onboarding, o cliente informa nome da empresa, e-mail de acesso, destinatários dos relatórios e fuso horário. O backend cria ou reutiliza o usuário no Supabase Auth, cria a empresa ativa, vincula o usuário e retorna o endereço único de recebimento em `audit.aiolympian.com`. Em seguida envia um magic link para o e-mail informado. No primeiro acesso autenticado, um diálogo obrigatório apresenta links para os Termos e a Política de Privacidade; somente depois do aceite versionado o guia do produto é aberto. O navegador sugere o fuso, mas o cliente pode corrigi-lo; não dependemos de localização por IP.

Às 07:00 no fuso da empresa, o serviço envia um resumo de todos os riscos detectados no dia anterior, inclusive uma confirmação quando não houve ocorrências. No primeiro dia útil de cada mês, envia o fechamento do mês anterior. Ambos incluem PDF e planilha CSV. Duplicidade exata, alteração bancária e riscos a partir de US$ 5.000 também geram alerta imediato. O limite fica registrado por empresa.

“Perda evitada” só é somada depois que um usuário registra o desfecho da exceção no portal, informa o valor confirmado e descreve a correção, cancelamento ou bloqueio do pagamento. Casos apenas detectados continuam como valor sob análise e não inflam a economia mensal.

Configure no Stripe o webhook:

`https://portal.aiolympian.com/webhooks/stripe`

Eventos usados: `checkout.session.completed`, `customer.subscription.updated` e `customer.subscription.deleted`. Assinaturas vencidas pausam a empresa; cancelamentos inativam a empresa.

## Comportamento

- Link mágico sem senha; access e refresh tokens são validados no servidor e guardados em cookies HttpOnly, SameSite=Strict e Secure em HTTPS. O fragmento de autenticação é removido imediatamente da URL. O access token dura até uma hora e o refresh token, até sete dias; o servidor renova a sessão automaticamente enquanto o refresh for válido. Somente depois disso um novo link é solicitado.
- Toda consulta verifica o usuário no Supabase, seu acesso habilitado e seu papel no banco. Clientes precisam de vínculo; administradores globais podem selecionar qualquer empresa. Consultas operacionais sempre filtram a empresa no servidor. Não há acesso direto do navegador ao banco.
- Faturas, relatórios, exceções e histórico têm paginação de 50 registros. Busca, status e indicadores são da página atual, conforme indicado na tela.
- Atualização a cada 30 segundos com aba visível; o modal de revisão suspende atualização para preservar a leitura. Navegação usa cache curto de 15 segundos, prefetch e cancelamento de chamadas obsoletas. Dados de cobrança vêm do banco sincronizado pelos webhooks, sem chamada Stripe bloqueando a abertura da seção.
- `completed` significa processamento concluído, podendo conter exceções — inclusive a validação de identidade da transportadora quando a FMCSA não retorna uma correspondência única. `needs_review` significa falha permanente ou falha temporária ainda presente depois das retentativas automáticas. `blocked` e `ignored` também são apresentados para não esconder registros existentes.
- Revisar registra uma observação sem apagar exceções nem alterar automaticamente o status. Reenviar é permitido somente para `needs_review` ou `blocked` de empresa ativa. A operação verifica o estado com bloqueio de linha e registra a ação na mesma transação. O worker reutiliza extrações e relatórios já salvos.
- Relatórios podem ser inspecionados e baixados em JSON. Os PDFs originais continuam privados no armazenamento; download de PDF não faz parte desta versão.
- O limite adicional de pedidos de link é por endereço de conexão, em memória por instância. Em proxy reverso, compartilha o limite entre clientes; configurar rate limiting de borda antes de escala. O Supabase também aplica seus limites de envio.

## Verificação

`npm run typecheck`, `npm test`, `npm run build`. Os testes do painel verificam sessão, isolamento entre empresas, CSRF, cookie, paginação, notas obrigatórias e conflitos. Para banco real, executar a migração e os testes SQL transacionais em ambiente de homologação antes de ativar clientes.

## Idioma e acesso administrativo

O painel administrativo usa português do Brasil (`pt-BR`). O portal do cliente, os e-mails operacionais e os documentos continuam em inglês americano, com valores em USD. Os horários seguem o fuso do navegador. As notas digitadas e os documentos dos clientes preservam seu conteúdo original. O template de e-mail do Supabase também deve ser configurado em inglês na ativação.

O papel de administrador global está implementado em `audit_admins`, com escrita reservada ao backend. Não usa metadados editáveis do usuário. As verificações são refeitas a cada solicitação; desabilitar o acesso invalida o uso de uma sessão já existente na próxima solicitação. A restrição também vale para as políticas RLS de leitura dos clientes.

## Administração

- **Companies:** listar, cadastrar, editar nome, ativar, pausar ou desativar e abrir a operação do cliente. Empresas novas começam inativas; o alias de recebimento é definido na criação e preservado na edição.
- **Users & access:** listar apenas usuários vinculados a este produto, cadastrar por e-mail, conceder/remover acesso a empresas, habilitar/desabilitar acesso ao painel e atribuir/remover o papel de administrador global.
- **Admin activity:** histórico de mudanças com autor, data, empresa/usuário afetado e dados da ação. O histórico não tem operação de edição ou exclusão no painel.
- **Operação do cliente:** o administrador usa seu próprio login. Um aviso identifica a empresa e o acesso administrativo. Revisões e reenvios registram e-mail, ID e papel do autor, visíveis no histórico de revisões do cliente.
- Nenhum e-mail é enviado ao clicar em Add user. O backend cria/reutiliza a identidade no Supabase Auth e atribui o acesso. O usuário solicita o link mágico na tela de login. Configure em inglês os templates Magic Link e Confirm Signup do Supabase.
- A criação da identidade Auth e a atribuição de acesso são duas operações. Se a segunda falhar, a identidade fica sem o novo vínculo. Repetir com o mesmo e-mail completa o cadastro sem recriar a identidade. Nenhum acesso é concedido antes da transação de vínculo.
- Não há exclusão permanente de empresas ou usuários; use status da empresa ou bloqueio de acesso para preservar documentos e histórico. Bloquear um usuário afeta este painel, sem modificar sua conta em outros produtos que compartilhem o projeto Supabase.
- Um administrador não pode desabilitar a própria conta nem remover o próprio papel administrativo. As alterações administrativas são serializadas no banco para proteger essas regras.
- As listagens têm páginas de 50 registros. A lista de empresas na gestão de usuários carrega todas as páginas para não ocultar empresas além da primeira página.

## Demonstrações locais

`node scripts/preview-portal.cjs` abre o cliente em `http://127.0.0.1:3101`.

`node scripts/preview-portal.cjs --admin` abre a administração em `http://127.0.0.1:3102`.

Ambas usam dados fictícios em memória, escutam apenas em loopback e não acessam banco, e-mail ou serviços de processamento. Alterações desaparecem ao reiniciar.

## Testes de banco isolado

`node scripts/check-db-isolated.cjs` cria um PostgreSQL temporário, aplica todas as migrações e executa os testes de isolamento, painel e administração. Precisa dos executáveis PostgreSQL instalados; `AUDIT_PG_BIN` pode indicar o diretório. O teste usa uma estrutura mínima de Supabase Auth para validar o SQL e não substitui o teste de entrega de link mágico no Supabase real. Ao finalizar, encerra o servidor temporário e remove os dados.
