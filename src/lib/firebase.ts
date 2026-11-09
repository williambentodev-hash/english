// Inicialização do Firebase (Auth + Firestore) a partir das variáveis de ambiente do Vite.
// Sem as chaves obrigatórias, `firebaseEnabled` é false e o app usa só o localStorage.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore'

const env = import.meta.env

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
}

const hasValue = (v: unknown) => typeof v === 'string' && v.trim() !== ''

export const firebaseEnabled = hasValue(config.apiKey) && hasValue(config.authDomain) && hasValue(config.projectId)

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

if (firebaseEnabled) {
  try {
    app = initializeApp(config)
    auth = getAuth(app)
    // cache em IndexedDB: leituras offline e escritas enfileiradas até a conexão voltar
    let cache
    try {
      cache = persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    } catch {
      cache = memoryLocalCache()
    }
    db = initializeFirestore(app, { localCache: cache })
  } catch (e) {
    console.warn('[firebase] falha na inicialização; usando localStorage.', e)
    app = auth = db = null
  }
}

export { app, auth, db }

/** true quando o Firebase está configurado e inicializou sem erro. */
export const firebaseReady = () => auth !== null && db !== null
