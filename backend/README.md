# English Tutor — back-end

API em FastAPI que fica entre o app e o LLM. A chave do Groq mora só aqui; o navegador nunca a vê.

## O que ele faz

- **Autenticação**: valida o ID token do Firebase Auth (o mesmo login do front) em cada chamada.
- **Limite de uso**: por usuário (minuto e dia, com teto menor para convidados) e por IP.
- **Prompt no servidor**: o cliente manda só o nível e a conversa; o prompt de sistema não é controlável de fora.
- **Leitura do JSON do modelo**: valida campo a campo e devolve uma resposta limpa para o front.

| Rota | Descrição |
| --- | --- |
| `GET /health` | Verificação de vida (sem login) |
| `POST /api/chat` | Avalia a última frase do aluno e continua a conversa |
| `POST /api/translate` | Traduz um termo no contexto da frase |

Com o servidor rodando, a documentação interativa fica em `http://localhost:8000/docs`.

## Rodando localmente

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
copy .env.example .env          # preencha GROQ_API_KEY e FIREBASE_PROJECT_ID
uvicorn app.main:app --reload
```

No front, aponte para o back-end em `.env.local` e rode `npm run dev`:

```
VITE_API_URL=http://localhost:8000
```

## Testes

```bash
pytest
```

Os testes não chamam o Groq nem o Firebase: o LLM é substituído por um falso e os tokens são assinados com uma chave gerada no próprio teste.

## Estrutura

```
app/
  main.py        rotas e CORS
  deps.py        usuário autenticado, limite de uso, cliente do LLM
  auth.py        validação do ID token do Firebase (JWT RS256 + JWKS)
  rate_limit.py  janela deslizante em memória
  llm.py         cliente do Groq
  prompts.py     prompt do tutor e do dicionário
  parsing.py     leitura do JSON devolvido pelo modelo
  schemas.py     contratos de entrada e saída
  tags.py        categorias de erro
```
