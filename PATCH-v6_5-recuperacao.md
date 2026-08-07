# PATCH v6.5 — Código de recuperação deixou de ficar em texto claro

## A falha

O e-mail sintético que ancorava a recuperação era derivado do próprio
código:

```
código:  6W1H8VSS1P8KXTW8
e-mail:  fd-6w1h8vss1p8kxtw8@device.fieldo.app
```

O código estava **legível em `auth.users.email`**. Qualquer pessoa com
leitura do banco — painel do Supabase, backup vazado, futuro funcionário
— assumia qualquer conta.

E eu documentei **três vezes**, em três patches diferentes, que *"o
servidor nunca vê o código em texto claro"*. Era falso. Escrevi a
garantia sem verificar se o desenho a sustentava.

Só apareceu quando inspecionei o `auth.users` restante durante a
auditoria — não por revisão de código.

## A correção

O e-mail passa a carregar o **SHA-256 do código**, não o código:

```
código:  6W1H8VSS1P8KXTW8
e-mail:  fd-d841d46df75a50c97172449fcad92880@device.fieldo.app
```

O servidor guarda:

| Armazenado | Reversível? |
|---|---|
| `email` = hash do código | não |
| `encrypted_password` = bcrypt do código | não |

Nenhum dos dois permite reconstruir o código.

**A recuperação continua exigindo apenas o código.** O próprio aparelho
calcula o hash para descobrir o e-mail — o profissional nunca precisa
saber uuid nem e-mail.

Prefixo de domínio (`fieldo-recovery-v1:`) antes do hash, para o mesmo
código nunca colidir com outro uso futuro.

## Sem migração

O banco foi limpo antes desta mudança, então não havia conta no formato
antigo. Se houvesse, seria necessário um caminho de transição — contas
antigas não conseguiriam recuperar com o novo cálculo.

**Se você tinha um código anotado de antes desta versão, ele não serve
mais.** Gere conta nova e guarde o novo.

## Um risco que a correção introduziu, e foi tratado

`crypto.subtle` só existe em **contexto seguro** (HTTPS ou localhost). Em
`http://` comum a conta seria criada **sem recuperação possível** — e o
usuário só descobriria ao trocar de celular, quando já fosse tarde.

Agora falha com mensagem clara: *"Abra o app por HTTPS. Sem isso não dá
para criar o código de recuperação."*

Falhar alto é melhor que criar uma conta irrecuperável em silêncio.

## Teste: `test/recuperacao.js`

| Verifica | |
|---|---|
| e-mail **não** contém o código | ✓ |
| formato é hash hexadecimal | ✓ |
| mesmo código → mesmo e-mail | ✓ |
| códigos diferentes → e-mails diferentes | ✓ |
| minúsculas produzem o mesmo e-mail | ✓ |
| senha enviada é o código (vira bcrypt) | ✓ |

Verificado que reprova a regressão:

```
--- com a falha reintroduzida ---
  ✗ e-mail NÃO contém o código (era a falha: fd-6w1h8vss1p8kxtw8@...)
  ✗ formato é hash hexadecimal, não o código
```

## Documentação corrigida

Os comentários no `entrar.html` que afirmavam a garantia falsa foram
reescritos, com registro do que era antes. Deixar a afirmação errada no
código seria pior que o bug: alguém confiaria nela de novo.

## Suíte

```
node test/all.js
```

6 suítes: `smoke`, `outputs`, `offline`, `criar-offline`, `timeout`,
`recuperacao`.
