# Índice da documentação

Este diretório é a fonte de referência do Olympian Freight Audit. A documentação descreve o comportamento presente no código e nas migrações até `032_portal_read_performance.sql`.

## Visão geral

| Documento | Quando usar |
| --- | --- |
| [Referência funcional](product-reference.md) | Entender recursos, regras, jornadas e estados do produto. |
| [Runbook operacional](operations-runbook.md) | Configurar, implantar, testar, monitorar e diagnosticar. |
| [Portal do cliente](customer-portal.md) | Configurar autenticação, onboarding, permissões, CRM e administração. |
| [Preços e uso](pricing-and-usage.md) | Entender planos, limites, contagem e cobrança de excedentes. |
| [Confiança verificável](verifiable-confidence.md) | Operar o motor de evidências, QA e calibração. |

## Entrada e processamento

| Documento | Escopo |
| --- | --- |
| [Resend, EasyPanel e R2](easypanel-resend.md) | Recebimento por e-mail e implantação do backend. |
| [Auditoria gratuita](free-audit-webhook.md) | Formulário público, confirmação, resultado, follow-ups e checkout. |
| [Conciliação documental](document-reconciliation.md) | Invoice, rate confirmation, POD e regras de conciliação. |
| [Processamento de POD](pod-processing.md) | CLI de POD, formatos aceitos, consenso e limites. |

## Segurança, observabilidade e conformidade

| Documento | Escopo |
| --- | --- |
| [Segurança de produção](security-production.md) | Controles obrigatórios e gate de release. |
| [Logs de produção](production-logs.md) | Eventos estruturados, correlação, redação e retenção. |
| [Better Stack](better-stack.md) | Coleta e alertas no EasyPanel. |
| [Aceite contratual no portal](us-checkout-consent.md) | Clickwrap após login e evidência do aceite. |

## Regra de atualização

Toda mudança de comportamento deve atualizar, no mesmo PR:

1. a referência funcional ou o runbook;
2. o documento especializado afetado;
3. `.env.example`, quando existir variável nova;
4. migração e procedimento de rollback, quando o esquema mudar;
5. testes e checklist manual correspondentes.

Não registre segredos, URLs reais de webhook, conteúdo de documentos, dados bancários ou informações pessoais em exemplos.
