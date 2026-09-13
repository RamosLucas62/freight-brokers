# Preços e cobrança por uso

O produto tem três planos em USD. Growth é a recomendação padrão.

| Plano | Incluídas por mês | Mensal | 6 meses pré-pagos | Anual pré-pago | Fatura adicional |
| --- | ---: | ---: | ---: | ---: | ---: |
| Core | 500 | US$497 | US$2,682 | US$4,970 | US$0.75 |
| Growth (Recommended) | 1,500 | US$997 | US$5,382 | US$9,970 | US$0.50 |
| Scale | 3,000 | US$1,497 | US$8,082 | US$14,970 | US$0.50 |

A franquia reinicia a cada mês civil no fuso configurado da empresa, inclusive em contratos pré-pagos. O excedente fecha depois do fim do mês e é cobrado automaticamente em uma fatura Stripe separada usando o método salvo. Os nove preços-base permanecem como catálogo; um invoice item idempotente registra o excedente mensal.

## O que conta

- Um PDF aceito contendo exatamente uma invoice extraída conta uma vez.
- O mesmo hash para a mesma empresa nunca conta duas vezes, inclusive em retry de job interrompido.
- Arquivos rejeitados antes da extração não contam.
- Um documento corrigido, com bytes e hash diferentes, conta como nova invoice.
- PDF com zero ou múltiplas invoices é rejeitado e não conta.
- POD e rate confirmation não contam.
- Documentos recebidos com a conta suspensa são bloqueados antes da extração e não contam.

## Recursos por plano

Core inclui um fluxo de entrada, até três usuários/destinatários, regras automáticas, relatórios por e-mail, histórico no portal e suporte por e-mail. Growth e Scale incluem múltiplos fluxos, histórico administrativo, reprocessamento de exceções, suporte prioritário e resumos mensais. Usuários e destinatários são comercialmente ilimitados nesses dois planos, com teto técnico de 500 entradas por categoria.

Conciliação com rate confirmation e POD, validação de accessorial e identificação conservadora de receita não faturada estão implementadas. Isso não significa recuperação automática de dinheiro: todo achado continua sob revisão e somente um valor confirmado pelo cliente entra em “perda evitada”.

## Exemplo

Uma empresa Growth com 2.000 invoices em um mês usa 1.500 da franquia e 500 adicionais. O excedente é `500 × US$ 0,50 = US$ 250,00`, cobrado além da assinatura-base.

## Configuração Stripe

Crie nove preços recorrentes e configure seus IDs em `STRIPE_PRICE_CORE_*`, `STRIPE_PRICE_GROWTH_*` e `STRIPE_PRICE_SCALE_*`. Use intervalos de 1 mês, 6 meses e 1 ano.

Os botões usam os nove Payment Links declarados em `src/billing/plans.ts`. Os Price IDs continuam obrigatórios para mapear Checkout Session, plano e período. Os links atuais são de teste e devem ser substituídos por links live antes do primeiro cliente real.

Depois de `checkout.session.completed`, o backend coloca o onboarding em uma fila idempotente. O link carrega somente o ID da Checkout Session; o endpoint consulta Stripe, valida e-mail e estado ativo/trial e só então provisiona o workspace.

Mantenha o Customer Portal limitado a forma de pagamento, histórico de faturas e troca de plano no fim do período. O cancelamento fica no fluxo de retenção do produto. Os metadados precisam preservar `plan_code` e `billing_period`; webhooks sincronizam esses valores no banco local.

A renovação é automática. O cancelamento interrompe a próxima renovação sem reembolso proporcional. Falha de pagamento inicia três dias de carência; depois disso novas auditorias são suspensas. Uma fatura paga reativa a conta. O cancelamento definitivo inicia a janela de 30 dias para exclusão.

Aplique todas as migrações em ordem, atualmente até `032_portal_read_performance.sql`. Consulte o [runbook operacional](operations-runbook.md).
