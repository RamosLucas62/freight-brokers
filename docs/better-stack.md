# Better Stack logs no Easypanel

Esta integração envia somente os logs JSON cujo campo `service` seja `freight-audit`. Requisições automáticas a `/healthz` e `/readyz` são descartadas antes do envio para reduzir consumo. O serviço Vector lê os streams dos containers pelo socket Docker e mantém um buffer local de 256 MiB para interrupções curtas do destino.

## 1. Criar a fonte

No Better Stack, abra **Telemetry → Sources → Connect source**, escolha **Docker** e crie uma fonte para produção. Copie separadamente:

- o **Source token**;
- o **Ingesting host**, somente o hostname, sem `https://` e sem barra final.

Não coloque nenhum desses valores no Git ou no arquivo `vector.yaml`.

## 2. Configurar no Easypanel

Crie um serviço **Docker Compose** separado no mesmo servidor usando `deploy/betterstack/docker-compose.yml`. Execute o Compose a partir da pasta `deploy/betterstack`, pois o arquivo monta `./vector.yaml`. Configure estas variáveis no ambiente do serviço:

```dotenv
BETTER_STACK_INGESTING_HOST=s000000.example.betterstackdata.com
BETTER_STACK_SOURCE_TOKEN=TOKEN_DA_FONTE
```

O bind mount `/var/run/docker.sock` permite ao coletor ler logs de todos os containers do host. Embora esteja marcado como somente leitura no sistema de arquivos, acesso ao socket Docker é altamente privilegiado e deve ser concedido apenas à imagem confiável do coletor. O Vector enxerga os streams, mas o filtro local envia somente eventos estruturados deste projeto.

Se o Easypanel não permitir montar o socket Docker no serviço Compose, instale o coletor no host via SSH seguindo o modo Docker Swarm oficial do Better Stack e aplique a mesma filtragem por `service == "freight-audit"` no painel da fonte.

## 3. Validar

Depois do deploy:

1. Abra `https://api.audit.aiolympian.com/healthz` para gerar atividade; esse check não será enviado.
2. Faça uma operação real de teste, como solicitar um magic link.
3. No Better Stack, abra **Live tail** e filtre por `service = freight-audit`.
4. Confirme que aparecem `event`, `level`, `request_id` e `timestamp` como campos separados.
5. Gere uma falha controlada em homologação e confirme a chegada de um evento com `level = error`.

Consultas úteis:

```text
service = "freight-audit" AND level = "error"
service = "freight-audit" AND request_id = "ID_DA_REQUISICAO"
service = "freight-audit" AND event = "free_audit.worker.failed"
```

## Alertas recomendados

Crie alertas para eventos `process.uncaught_exception`, `process.unhandled_rejection`, `stripe.webhook.enqueue_failed`, `free_audit.worker.failed`, `inbound.worker.failed` e `notification.delivery.failed`. Comece com notificação somente quando houver ocorrência; não envie alertas para cada resposta HTTP comum.

## Segurança e custo

- O logger já remove campos com nomes semelhantes a tokens, cookies, senhas, assinaturas, chaves, payloads e documentos.
- Não registre conteúdo de PDF, corpo de webhook, dados bancários ou endereços de e-mail.
- Restrinja o acesso ao Better Stack aos operadores necessários.
- Acompanhe o volume ingerido antes de aumentar a retenção.
- A imagem `latest-alpine` acompanha a recomendação simples do fornecedor; fixe uma versão ou digest após validar a primeira implantação para tornar atualizações previsíveis.
