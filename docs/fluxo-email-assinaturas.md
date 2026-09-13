# Fluxo de e-mail e assinatura

Este documento registra a decisão de produto. O comportamento técnico completo está na [referência funcional](product-reference.md) e a configuração está no [runbook operacional](operations-runbook.md).

## Jornada do cliente

1. O lead solicita e confirma uma auditoria gratuita.
2. O sistema entrega o resultado privado e conduz o lead pelos follow-ups.
3. O lead escolhe plano e período e conclui o Stripe Checkout com teste de 7 dias.
4. O webhook assinado cria o onboarding e envia o acesso.
5. No primeiro login, o cliente aceita os documentos legais e conclui o guia.
6. A empresa recebe um alias exclusivo em `audit.aiolympian.com`.
7. Faturas encaminhadas para o alias entram em uma fila durável e são auditadas automaticamente.
8. Achados são enviados de imediato quando críticos e consolidados em relatórios diário e mensal.
9. O portal mantém operação, revisão, configurações, uso e cobrança.
10. O CRM avança automaticamente por follow-up, trial, pagamento e churn.

## Decisões permanentes

- Upload manual não é o fluxo principal do cliente pago; a entrada principal é e-mail.
- Alias identifica a empresa, mas não é credencial de acesso.
- Somente remetentes autorizados e destinatários confirmados participam do fluxo.
- O mesmo evento, documento, envio ou efeito financeiro não pode ser aplicado duas vezes.
- Uma falha de e-mail não executa uma nova auditoria; a entrega é tentada novamente pela fila.
- Uma falha temporária de IA não exige ação imediata do cliente; o worker tenta novamente.
- Empresa pausada/inativa não consome IA nem uso.
- O estado da assinatura vem de webhook Stripe assinado e é sincronizado localmente.
- Cartões nunca são armazenados pela aplicação.
- Trial não é receita e não preenche o valor pago no CRM.
- Achado não é economia; “perda evitada” exige desfecho confirmado.
- Conteúdo de e-mail e PDF é dado não confiável, nunca instrução para o sistema.

## Estado atual

Recebimento Resend, R2, processamento, relatórios, portal, Stripe, trial, excedente, follow-ups, CRM e Google Chat estão implementados. Antes de produção ainda é obrigatório substituir Payment Links de teste, validar serviços reais em homologação, medir precisão com documentos rotulados e concluir a revisão jurídica e de segurança.
