"""Embeddings das frases do aluno, com um modelo pequeno rodando no próprio servidor.

all-MiniLM-L6-v2: 384 dimensões, ~150 MB de memória e ~15 ms por frase em CPU. É um modelo de
inglês, o que basta aqui: só as frases do aluno (em inglês) são vetorizadas.
"""
import threading

import anyio

EMBEDDING_DIM = 384


class FastEmbedEmbedder:
    def __init__(self, model_name: str):
        self._model_name = model_name
        self._model = None
        self._lock = threading.Lock()

    def _encode(self, text: str) -> list[float]:
        with self._lock:
            if self._model is None:
                # import tardio: carregar o onnxruntime custa memória e só é preciso com a memória ligada
                from fastembed import TextEmbedding

                self._model = TextEmbedding(self._model_name)
            vector = next(iter(self._model.embed([text])))
        return vector.tolist()

    async def embed(self, text: str) -> list[float]:
        # inferência é CPU pura: roda numa thread para não travar o event loop
        return await anyio.to_thread.run_sync(self._encode, text)

    async def warm_up(self) -> None:
        """Carrega o modelo antes da primeira conversa."""
        await self.embed("warm up")
