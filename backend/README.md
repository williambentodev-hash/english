# English Tutor — back-end

API em FastAPI que fica entre o app e o LLM. A chave do Groq mora só aqui; o navegador nunca a vê.

## O que ele faz

- **Autenticação**: valida o ID token do Firebase Auth (o mesmo login do front) em cada chamada.
- **Limite de uso**: por usuário (minuto e dia, com teto menor para convidados) e por IP.
- **Prompt no servidor**: o cliente manda só o nível e a conversa; o prompt de sistema não é controlável de fora.
- **Leitura do JSON do modelo**: valida campo a campo e devolve uma resposta limpa para o front.

- **Memória de erros (RAG)**: cada correção é guardada no PostgreSQL com o embedding da frase do aluno (pgvector). Antes de responder, o tutor recebe os erros antigos daquele aluno mais parecidos com a frase nova e avisa quando um se repete.

### Como a memória funciona

1. A frase nova do aluno vira um vetor de 384 dimensões (`all-MiniLM-L6-v2`, rodando no próprio servidor via ONNX — sem API externa).
2. O banco devolve até 3 erros antigos **do mesmo aluno** com distância de cosseno até 0,6.
3. Esses erros entram no prompt com a instrução de só serem citados se o aluno repetir o erro.
4. Se a resposta trouxer uma correção, ela é gravada depois que a resposta já foi enviada. A mesma frase errada de novo soma num contador em vez de duplicar.

A memória é um reforço: sem `DATABASE_URL`, ou com o banco fora do ar, a conversa segue normalmente sem ela.

| Rota | Descrição |
| --- | --- |
| `GET /health` | Verificação de vida (sem login) |
| `POST /api/chat` | Avalia a última frase do aluno e continua a conversa |
| `POST /api/translate` | Traduz um termo no contexto da frase |
| `DELETE /api/memory` | Apaga os erros guardados do usuário |

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

Os testes de integração da memória (PostgreSQL real e modelo de embeddings real) só rodam com as variáveis definidas; o CI roda os dois:

```bash
docker compose up -d db
set TEST_DATABASE_URL=postgresql://tutor:tutor@localhost:5432/tutor
set RUN_MODEL_TESTS=1
pytest
```

## Estrutura

```
app/
  main.py        rotas e CORS
  deps.py        usuário autenticado, limite de uso, cliente do LLM
  auth.py        validação do ID token do Firebase (JWT RS256 + JWKS)
  rate_limit.py  janela deslizante em memória
  llm.py         cliente do Groq
  memory.py      memória de erros: busca por similaridade e gravação (pgvector)
  embeddings.py  modelo de embeddings local
  prompts.py     prompt do tutor e do dicionário
  parsing.py     leitura do JSON devolvido pelo modelo
  schemas.py     contratos de entrada e saída
  tags.py        categorias de erro
```
