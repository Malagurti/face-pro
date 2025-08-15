# Face Pro Frontend

SDK React para prova de vida + aplicação de exemplo.

## 🚀 Setup Rápido (Primeira Vez)

Para rodar o projeto pela primeira vez, execute **UM** dos comandos abaixo:

### Opção 1: Setup completo (Recomendado)
```bash
# Na pasta frontend/
pnpm setup
```

### Opção 2: Manual
```bash
# Na pasta frontend/
pnpm install          # Instala dependências em todas as pastas
pnpm run build:sdk    # Constrói o SDK
```

### Opção 3: Direto do example
```bash
# Na pasta frontend/apps/example/
pnpm setup
```

## 🛠️ Desenvolvimento

### Rodar o exemplo
```bash
# Na pasta frontend/
pnpm dev:example
```

Ou se estiver na pasta do example:
```bash
# Na pasta frontend/apps/example/
pnpm dev:full
```

### Desenvolver o SDK com watch mode
```bash
# Na pasta frontend/packages/proof-of-life/
pnpm dev
```

E em outro terminal:
```bash
# Na pasta frontend/apps/example/
pnpm dev
```

## 📂 Estrutura do Projeto

```
frontend/
├── packages/
│   └── proof-of-life/          # SDK React
│       ├── src/
│       ├── dist/               # Build do SDK
│       └── package.json
├── apps/
│   └── example/                # App de exemplo
│       ├── src/
│       └── package.json
└── package.json                # Scripts principais
```

## 🔧 Scripts Disponíveis

### Scripts Principais (frontend/)
- `pnpm setup` - Setup completo (install + build SDK)
- `pnpm dev:example` - Roda o exemplo (com build do SDK)
- `pnpm build:sdk` - Constrói apenas o SDK
- `pnpm build` - Constrói tudo
- `pnpm clean` - Limpa builds

### Scripts do SDK (packages/proof-of-life/)
- `pnpm build` - Constrói o SDK
- `pnpm dev` - Constrói com watch mode
- `pnpm clean` - Limpa dist/
- `pnpm rebuild` - Limpa e reconstrói

### Scripts do Example (apps/example/)
- `pnpm dev` - Roda o exemplo (precisa do SDK já built)
- `pnpm setup` - Setup completo do workspace
- `pnpm dev:full` - Setup + roda exemplo
- `pnpm build:sdk` - Constrói apenas o SDK

## 🔄 Workflow de Desenvolvimento

### Primeira vez:
```bash
cd frontend/
pnpm setup
pnpm dev:example
```

### Dia a dia:
```bash
cd frontend/
pnpm dev:example
```

### Desenvolvendo o SDK:
```bash
# Terminal 1 - Watch do SDK
cd frontend/packages/proof-of-life/
pnpm dev

# Terminal 2 - App exemplo
cd frontend/apps/example/
pnpm dev
```

## 💡 Dicas

- **pnpm workspaces**: Gerencia dependências entre pacotes automaticamente
- **Mudanças no SDK**: Sempre rode `pnpm build:sdk` antes do example
- **Watch mode**: Use `pnpm dev` no SDK para rebuild automático
- **Problemas**: Tente `pnpm clean` e `pnpm setup`

## 🎯 Modo Bypass

Para testar o modo bypass no hackathon:

1. Rode o backend na porta 8080
2. Execute: `pnpm dev:example`
3. Acesse: http://localhost:5173
4. Marque: "Modo Bypass"
5. Crie sessão e inicie

Os dados brutos serão enviados via WebSocket para o backend processar.
