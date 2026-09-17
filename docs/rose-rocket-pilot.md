# Rose Rocket Platform v2: preparação do piloto

Este repositório tem um cliente de API, um endpoint opcional de eventos, uma fila durável e uma camada de preparação em `src/tms/`. **A integração não está ativada**: não há cliente piloto, credenciais nem webhook registrado. Nenhum dado de Rose Rocket foi acessado e nenhum status foi escrito no TMS.

## O que está pronto

- Autenticação de *service account* com OAuth `client_credentials`, escopada por `org_id` e `user_id`.
- Leitura de registros por ID da Platform v2 e seus metadados de documentos; rejeição de registros de outra organização.
- Download limitado a PDFs em caminhos da própria API, sem redirecionamentos ou URLs arbitrárias. PDFs devem passar também pelo scanner existente antes de entrar na auditoria.
- PDFs gerados de contas a pagar (`bill`) e confirmações de tarifa (`manifest`) podem ser reconhecidos pelo caminho documentado. Uma `invoice` da Rose Rocket é uma conta a receber e não é presumida como fatura da transportadora.
- Interpretação de eventos de pedido como **sinal para consultar novamente a API**, nunca como dado auditável. Eventos de outra organização são rejeitados.
- Migração `034_rose_rocket_pilot_inbox.sql`: associação empresa↔organização desabilitada por padrão, fila sem payload bruto, deduplicação por `org_id` + `event_id`, limite diário, recuperação de jobs interrompidos e até cinco tentativas. O worker consulta o pedido novamente e grava apenas seus IDs de documento; `discovered` **não** significa auditado.
- Migração `035_rose_rocket_customer_connection.sql`: o proprietário ou administrador de cobrança pode fornecer uma conta de serviço pela seção Settings & billing após o aceite legal. O servidor autentica por `client_credentials`, confere `/api/v1/me` e cifra os quatro valores com AES-256-GCM antes de armazenar. Nenhuma credencial é devolvida ao navegador. A conexão fica `pending` e `enabled=false`, sem iniciar sincronização.
- Endpoint opcional `POST /webhooks/rose-rocket/<token>`: só existe com `ROSE_ROCKET_ENABLED=true`, token longo em segredo de implantação e `orgId` esperado. O aplicativo oculta o token de seus logs. `WORKER_ENABLED=true` também é necessário para consumir a fila.
- Produção de um status local `audited` ou `needs_review` a partir de um relatório Olympian. Não existe escrita automática no Rose Rocket.

## Limites verificados na documentação

- A [API Platform v2](https://roserocket.readme.io/docs/object-descriptions-and-operations) permite buscar objetos por ID; [documentos](https://roserocket.readme.io/docs/documents) podem estar vinculados a pedidos, faturas e contas a pagar. Documentos em URLs pré-assinadas externas ficam fora do primeiro piloto até confirmar seu host e política de segurança em uma conta real.
- A [documentação de webhooks v2](https://roserocket.readme.io/docs/webhooks-2) apresenta `Order Status Changed` como evento padrão. Não garante eventos de criação/alteração de faturas ou documentos. A URL de webhook é configurável, mas assinatura ou autenticação do envio não estão documentadas. O endpoint preparado usa um segredo na URL, que é um controle inferior a uma assinatura; **não o ative** antes de validar o risco, proteger/redigir os logs do proxy/CDN e definir reconciliação periódica para eventos perdidos.
- As APIs [v1 e v2 são para produtos diferentes](https://roserocket.readme.io/discuss/66c6498685d1ef005a5e3c20). Este código suporta apenas Platform v2.

## Para ativar com o primeiro cliente

### Preparar o cadastro opcional no portal

1. Aplicar a migração 035 **depois** da 034 no banco correto. Definir uma chave aleatória de 32 bytes em base64url em `ROSE_ROCKET_CREDENTIAL_KEY`; guardá-la no cofre de segredos e incluí-la no procedimento seguro de backup. Se a chave for perdida, as credenciais armazenadas não poderão ser recuperadas.
2. Definir `ROSE_ROCKET_CONNECT_ENABLED=true` somente quando a equipe estiver pronta para receber credenciais de clientes. Isso habilita a tela de verificação, **não** a sincronização nem o webhook. Deixar `ROSE_ROCKET_ENABLED=false`.
3. O cliente cria um aplicativo OAuth e uma conta de serviço na própria organização Rose Rocket, copia `org_id`, `user_id`, `client_id` e `client_secret` de *Request Details* e os envia exclusivamente pelo formulário autenticado. Nunca pedir senha pessoal nem segredos por e-mail. A conta de serviço pode iniciar com papel Manager; validar as permissões mínimas com Rose Rocket antes do piloto.
4. O portal mostra “Access verified · pilot pending”. O administrador pode desconectar, o que apaga o segredo cifrado e mantém os registros históricos. O sistema impede vincular outra organização à mesma empresa ou a mesma organização a empresas diferentes sem revisão.

O cadastro por conta de serviço é o caminho documentado disponível agora. Um botão OAuth de autorização direta entre várias organizações depende de confirmação da Rose Rocket sobre aplicativos parceiros multi-cliente e do formato confiável de identificação da organização no retorno; **não está implementado**. As credenciais salvas não são usadas pelo worker atual, que ainda opera apenas com a configuração manual de uma organização.

### Ativar processamento com o primeiro cliente

1. Confirmar que sua conta usa Platform v2 e autorizar o piloto com o cliente. Se o cadastro opcional do portal já foi feito, não reutilizar suas credenciais no worker atual sem implementar a seleção segura por empresa; esse worker ainda lê as variáveis globais `ROSE_ROCKET_*`.
2. Validar quais objetos e tipos de documentos reais representam fatura da transportadora, confirmação de tarifa e POD; confirmar o vínculo entre pedido, manifesto e conta a pagar. A seleção atual é conservadora e exige identificadores de registros conhecidos.
3. Aplicar a migração 034, cadastrar explicitamente a associação `tenant_id` ↔ `org_id` e habilitá-la somente após consentimento e revisão. Configurar as variáveis `ROSE_ROCKET_*` do `.env.example` no cofre de segredos para o piloto manual. A fila e o worker já existem; ainda falta a rotina de reconciliação periódica, pois o webhook padrão não cobre todas as alterações documentais.
4. Confirmar a segurança do webhook com Rose Rocket. Se o token na URL for aceito para o piloto, ocultá-lo também dos logs de proxy/CDN antes de definir `ROSE_ROCKET_ENABLED=true`; não reutilizar segredos de outros webhooks.
5. Com o cliente, mapear documentos e conectar PDFs validados ao scanner, armazenamento privado, contagem de uso e pipeline de auditoria. Escolher um campo **não financeiro** para devolver `audited`/`needs_review`, confirmar permissão de escrita e aprovar texto/links de evidência. Nada deve alterar status de pagamento, valores ou aprovação de cobrança automaticamente.
6. Validar tudo em homologação com documentos reais, duplicatas, falhas de rede, permissões negadas e eventos fora de ordem antes de liberar a conta.
