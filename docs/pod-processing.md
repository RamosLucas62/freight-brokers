# Processamento de comprovantes de entrega (POD)

O fluxo de POD é independente da auditoria de faturas. Ele aceita PDF, JPEG, PNG e WebP para leitura visual, além de CSV e XLSX para importação estruturada.

Execute `npm run pod:process -- arquivo.pdf` e leia o JSON emitido na saída padrão. CSV e Excel podem conter várias linhas; a primeira linha deve ser o cabeçalho. Cabeçalhos reconhecidos incluem `load_number`, `bol_number`, `delivery_date`, `delivery_time`, `receiver_name`, `delivery_location`, `signature_present`, `damage_or_shortage_noted` e `exception_notes`, além de aliases comuns em inglês.

Configure `POD_CONFIDENCE_THRESHOLD` (padrão `0.90`). Uma leitura abaixo do limite exige revisão. Para exigir consenso de duas leituras independentes, configure `POD_SECONDARY_OPENROUTER_MODEL` com um modelo diferente. Se os leitores discordarem, o campo fica nulo, com confiança zero, e nunca vira divergência automática.

`assessPod` usa três estados: `confirmed`, `divergent` e `unverifiable`. Uma divergência só é emitida quando o valor possui confiança suficiente. Documento ruim, campo ausente ou desacordo de OCR produz `unverifiable`. Identificação por load/BOL, data de entrega e presença/ausência de assinatura são evidências mínimas.

A detecção de assinatura confirma apenas a presença visual de uma marca. Ela não autentica a identidade de quem assinou. Precisão operacional deve ser calibrada com PODs reais rotulados; confiança fornecida pelo modelo não é, por si só, uma probabilidade calibrada.
