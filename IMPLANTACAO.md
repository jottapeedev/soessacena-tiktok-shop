# 🚀 Implantação — SóEssaCena TikTok Shop (Supabase + Vercel)

Guia completo, passo a passo. Tempo total: **~20 minutos**.
O site é 100% estático (HTML/CSS/JS) — o Vercel só entrega os arquivos;
os dados vivem no Supabase.

```
[ Navegador ]  ──HTTPS──▶  [ Vercel: site estático ]
     │
     └─────HTTPS (chave anon)────▶ [ Supabase: dados + funções RPC ]
```

---

## ETAPA 1 — Supabase (o banco de dados)

1. Acesse **supabase.com** → crie conta (pode entrar com GitHub/Google).
2. **New project**:
   - Name: `soessacena-tiktok-shop`
   - Database Password: crie e **anote** (não usa no dia a dia)
   - Region: `South America (São Paulo)` (mais rápida pra você)
3. Aguarde ~1 min o projeto subir.
4. **SQL Editor → New query** → cole o arquivo **`schema.sql`** INTEIRO → **Run**.
   Tem que aparecer **"Success"**. (Cria tabelas, funções e segurança RLS.)
5. **Project Settings → API Keys** → copie:
   - **Project URL** → algo como `https://xxxx.supabase.co`
   - chave **`anon` `public`** → a grandona que começa com `eyJ...`
   - ⚠️ NÃO use a `service_role` em hipótese nenhuma no site.

## ETAPA 2 — Ligar o site ao Supabase

Abra **`config.js`** (dentro da pasta de deploy) e preencha:

```js
const LOCAL_MODE = false;
const SUPABASE_URL = "https://xxxx.supabase.co";        // ← sua Project URL
const SUPABASE_ANON_KEY = "eyJhbGciOi...";              // ← sua chave anon
```

**Teste rápido antes de publicar:** abra o `index.html` no navegador
(duplo clique mesmo). Deve aparecer a tela de instalação → escolha
"dados de demonstração" ou comece do zero. Se funcionou localmente,
vai funcionar no Vercel.

> 💡 Dados do modo local antigo (localStorage) NÃO vão automaticamente
> para o Supabase — o projeto na nuvem começa limpo. Se quiser migrar o
> que você já tinha, me peça que eu adiciono uma função de migração.

## ETAPA 3 — Publicar no Vercel

### Método A (recomendado): GitHub + Vercel

Assim, toda vez que você atualizar o site, republica com 1 clique.

1. Crie conta no **github.com** (se não tiver) e no **vercel.com**
   (entre "com GitHub").
2. No GitHub: botão **+ → New repository** → nome `soessacena-tiktok-shop`
   → **Create repository**.
3. Envie os arquivos desta pasta (`index.html`, `styles.css`, `app.js`,
   `localdb.js`, `config.js`, `vercel.json`) para o repositório:
   - Jeito fácil: na página do repositório vazio, clique em
     **"importing an existing file" / "uploading an existing file"**
     e arraste os 6 arquivos → **Commit changes**.
   - Ou via git:
     ```bash
     cd pasta-do-site
     git init
     git add .
     git commit -m "SóEssaCena v1"
     git branch -M main
     git remote add origin https://github.com/SEU_USUARIO/soessacena-tiktok-shop.git
     git push -u origin main
     ```
4. No **vercel.com**: **Add New… → Project** → **Import** no repositório.
   - Framework Preset: deixe **Other**
   - Não mexa em Build/Output (é site estático)
   - Clique **Deploy**.
5. Em ~30 segundos você recebe a URL: `https://soessacena-tiktok-shop.vercel.app` 🎉

### Método B (alternativa): Vercel CLI no terminal

1. Instale o Node.js (nodejs.org) se não tiver.
2. Dentro da pasta do site:
   ```bash
   npm i -g vercel
   vercel login
   vercel --prod
   ```
3. Responda às perguntas (aceite os padrões) e pronto: URL no final.

## ETAPA 4 — Verificação final ✅

1. Abra a URL do Vercel → tela de instalação → instale (com ou sem demo).
2. Cadastre um produto de teste.
3. No Supabase → **Table Editor → produtos** → o registro está lá. ✅
4. Abra a mesma URL em **outro navegador** (ou aba anônima) → o produto
   aparece também. ✅ (prova que os dados estão na nuvem)
5. Exclua o produto de teste.

## Solução de problemas

| Sintoma | Causa | Solução |
|---|---|---|
| Página abre mas mostra "Supabase não configurado" | `config.js` sem URL/chave ou `LOCAL_MODE = true` | Preencha e faça novo commit/deploy |
| Erro ao instalar / "não respondeu" | `schema.sql` não foi executado | Rode no SQL Editor (Etapa 1.4) |
| Erro 401 / "permission denied" | Chave anon copiada incompleta | Copie a chave inteira (ela é longa) |
| Site antigo depois de mudar `config.js` | Cache do navegador | Ctrl+F5 (o `vercel.json` já evita cache agressivo) |
| Projeto Supabase "sumiu" | Projetos grátis pausam após 1 semana sem uso | Entre no painel do Supabase e clique em Restore |

## Extras (opcional)

- **Domínio próprio**: no painel do projeto Vercel → **Settings → Domains**.
- **Atualizar o site depois**: mande os novos arquivos pro GitHub (commit) —
  o Vercel republica sozinho; ou rode `vercel --prod` de novo no Método B.
- **Se o schema.sql mudar no futuro** (novas funções/tabelas): rode de novo
  no SQL Editor — é seguro, ele só adiciona o que falta.
